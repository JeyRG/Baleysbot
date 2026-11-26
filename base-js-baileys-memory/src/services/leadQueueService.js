import { supabase } from './supabaseClient.js';
import { getLeadsCounter, incrementLeadsCounter } from './userService.js';

const MAX_ATTEMPTS = 3;
let workerRunning = false;
let stopRequested = false;
let activeTimer = null;
let fallbackMemoryQueue = [];
let dbQueueAvailable = true;

function waitCancelable(ms) {
    return new Promise((resolve) => {
        activeTimer = setTimeout(() => {
            activeTimer = null;
            resolve();
        }, ms);
    });
}

/**
 * Obtiene cuántos leads han sido enviados o encolados hoy.
 */
export async function getTodayLeadQuotaCount() {
    if (dbQueueAvailable) {
        try {
            const startOfDay = new Date();
            startOfDay.setUTCHours(0, 0, 0, 0);

            const { count, error } = await supabase
                .from('outbound_lead_queue')
                .select('id', { count: 'exact', head: true })
                .in('status', ['pending', 'processing', 'sent'])
                .gte('created_at', startOfDay.toISOString());

            if (!error && typeof count === 'number') {
                return count;
            }
            if (error) {
                dbQueueAvailable = false;
                console.warn('[LeadQueue] Tabla outbound_lead_queue no disponible, usando contador local de respaldo:', error.message);
            }
        } catch (err) {
            dbQueueAvailable = false;
            console.warn('[LeadQueue] Fallback a contador local:', err.message);
        }
    }

    return getLeadsCounter().count;
}

/**
 * Encola un lead de forma durable en Supabase (con fallback automático a memoria si la tabla no existe).
 */
export async function enqueueLeadJob({ targetNumber, dni, nombre, facultad, programa }) {
    if (dbQueueAvailable) {
        try {
            const { data, error } = await supabase
                .from('outbound_lead_queue')
                .insert({
                    wa_id: targetNumber,
                    dni: dni || null,
                    nombre: nombre || null,
                    facultad: facultad || null,
                    programa: programa || null,
                    status: 'pending',
                    attempts: 0,
                    scheduled_at: new Date().toISOString()
                })
                .select('id')
                .single();

            if (!error && data) {
                return { queued: true, durable: true, id: data.id };
            }

            dbQueueAvailable = false;
            console.warn('[LeadQueue] Fallback a cola en memoria:', error?.message);
        } catch (err) {
            dbQueueAvailable = false;
            console.warn('[LeadQueue] Excepción insertando en outbound_lead_queue:', err.message);
        }
    }

    incrementLeadsCounter(5000);
    fallbackMemoryQueue.push({
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        wa_id: targetNumber,
        dni,
        nombre,
        facultad,
        programa,
        attempts: 0
    });
    return { queued: true, durable: false };
}

/**
 * Al iniciar el servidor, recupera tareas que quedaron en 'processing' por un reinicio abrupto.
 */
export async function recoverStuckLeadJobs() {
    if (!dbQueueAvailable) return;
    try {
        const { error } = await supabase
            .from('outbound_lead_queue')
            .update({
                status: 'pending',
                last_error: 'Recuperado tras reinicio del proceso'
            })
            .eq('status', 'processing');

        if (error) {
            dbQueueAvailable = false;
        }
    } catch {
        dbQueueAvailable = false;
    }
}

async function claimNextJob() {
    if (dbQueueAvailable) {
        try {
            const nowIso = new Date().toISOString();
            const { data: rows, error } = await supabase
                .from('outbound_lead_queue')
                .select('*')
                .eq('status', 'pending')
                .lte('scheduled_at', nowIso)
                .order('scheduled_at', { ascending: true })
                .limit(1);

            if (error) {
                dbQueueAvailable = false;
            } else if (rows && rows.length > 0) {
                const job = rows[0];
                await supabase
                    .from('outbound_lead_queue')
                    .update({ status: 'processing', attempts: (job.attempts || 0) + 1 })
                    .eq('id', job.id);
                return { ...job, attempts: (job.attempts || 0) + 1, _durable: true };
            }
        } catch {
            dbQueueAvailable = false;
        }
    }

    if (fallbackMemoryQueue.length > 0) {
        const job = fallbackMemoryQueue.shift();
        return { ...job, attempts: (job.attempts || 0) + 1, _durable: false };
    }

    return null;
}

/**
 * Ejecuta el consumidor secuencial con jitter anti-ban (120s-180s) y reintentos con backoff.
 */
export async function triggerLeadQueueWorker(provider, dispatchLeadFn, onSentCallback = null) {
    if (workerRunning || stopRequested) return;
    workerRunning = true;

    try {
        while (!stopRequested) {
            const job = await claimNextJob();
            if (!job) break;

            const targetNumber = job.wa_id;
            console.log(`[LeadQueue] Procesando envío (${job.attempts}/${MAX_ATTEMPTS}) para ${job.nombre || targetNumber}...`);

            try {
                await dispatchLeadFn(targetNumber, job.nombre || 'Postulante', job.facultad || '', job.programa || '', provider);

                if (job._durable) {
                    await supabase
                        .from('outbound_lead_queue')
                        .update({
                            status: 'sent',
                            sent_at: new Date().toISOString(),
                            last_error: null
                        })
                        .eq('id', job.id);
                }

                if (typeof onSentCallback === 'function') {
                    onSentCallback(targetNumber);
                }
                console.log(`[LeadQueue] ✅ Envío completado a ${targetNumber}.`);
            } catch (err) {
                const errMsg = err?.message || String(err);
                console.error(`[LeadQueue] ❌ Fallo enviando a ${targetNumber}:`, errMsg);

                if (job.attempts < MAX_ATTEMPTS) {
                    const retryDelayMs = job.attempts * 60_000;
                    if (job._durable) {
                        await supabase
                            .from('outbound_lead_queue')
                            .update({
                                status: 'pending',
                                last_error: errMsg,
                                scheduled_at: new Date(Date.now() + retryDelayMs).toISOString()
                            })
                            .eq('id', job.id);
                    } else {
                        fallbackMemoryQueue.push(job);
                    }
                } else if (job._durable) {
                    await supabase
                        .from('outbound_lead_queue')
                        .update({
                            status: 'failed',
                            last_error: errMsg
                        })
                        .eq('id', job.id);
                }
            }

            if (stopRequested) break;

            // Jitter anti-bloqueo entre envíos (120s - 180s) solo si quedan más tareas inmediatas
            const waitTime = Math.floor(Math.random() * (180_000 - 120_000 + 1)) + 120_000;
            console.log(`[LeadQueue] Pausa anti-spam de ${Math.round(waitTime / 1000)}s antes de verificar siguiente lead...`);
            await waitCancelable(waitTime);
        }
    } finally {
        workerRunning = false;
    }
}

export function stopLeadQueueWorker() {
    stopRequested = true;
    if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = null;
    }
}
