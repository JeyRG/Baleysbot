import { supabaseData as defaultSupabaseData } from '../services/supabaseClient.js';

/**
 * Rutas de Mensajería Externa y Gestión de Leads (/v1)
 */
export function registerMessagingRoutes(server, { 
    handleCtx, 
    supabase, 
    supabaseData = defaultSupabaseData,
    getLeadsCounter, 
    incrementLeadsCounter, 
    apiQueue, 
    processApiQueue, 
    adapterProvider 
}) {
    // 1. Envío directo de mensajes
    server.post('/v1/messages', handleCtx(async (bot, req, res) => {
        try {
            const { number, message, urlMedia } = req.body || {};
            if (!number || (!message && !urlMedia)) {
                res.statusCode = 400;
                return res.end('Faltan parametros requeridos');
            }
            await bot.sendMessage(number, message, { media: urlMedia ?? null });
            return res.end('sended');
        } catch (err) {
            res.statusCode = 500;
            return res.end(err.message);
        }
    }));

    // 2. Recepción de leads y encolamiento controlado (máx 50/día)
    server.post('/v1/enviar-datos', handleCtx(async (bot, req, res) => {
        try {
            let { wa_id, nombre, facultad, programa, dni, telefono } = req.body || {};
            let targetNumber = wa_id || telefono;

            if (!targetNumber || !dni) {
                res.writeHead(400);
                return res.end(JSON.stringify({ error: 'Faltan wa_id/telefono o dni' }));
            }

            const cleanDni = String(dni).trim().replace(/\D/g, '');
            const cleanPhone = String(telefono || targetNumber).trim().replace(/\D/g, '');
            const cleanNombre = typeof nombre === 'string' ? nombre.trim() : '';

            // Formato normalizado WhatsApp para envío de mensajes
            targetNumber = targetNumber.includes('@') ? targetNumber : `${cleanPhone}@s.whatsapp.net`;
            console.log(`[API v1] Petición recibida para ${cleanNombre} (DNI: ${cleanDni}).`);

            // 1. Guardar o actualizar registro en 'students' con condición 'postulante'
            const { error: studentErr } = await supabase.from('students').upsert({
                wa_id: cleanPhone,
                full_name: cleanNombre,
                document_id: cleanDni,
                phone_number: cleanPhone,
                student_condition: 'postulante',
                updated_at: new Date().toISOString()
            }, { onConflict: 'wa_id' });

            if (studentErr) {
                console.error('[API v1] Error upsert en students:', studentErr.message);
            }

            // 1.1 Sincronización en la tabla 'postulantes' de supabaseData
            const clientData = supabaseData || defaultSupabaseData;
            if (clientData) {
                try {
                    const idPostulante = `POS-LEAD-${cleanDni}`;
                    await clientData.from('postulantes').upsert({
                        id_postulante: idPostulante,
                        mensaje_estado: 'Lead registrado desde formulario web',
                        fecha_registro: new Date().toISOString(),
                        ultima_actualizacion: new Date().toISOString(),
                        expediente_json: {
                            tipo: 'lead_web',
                            dni: cleanDni,
                            nombre: cleanNombre,
                            telefono: cleanPhone,
                            facultad: facultad || null,
                            programa: programa || null,
                            origen: '/v1/enviar-datos'
                        },
                        nota_admin: 'Lead captado vía API /v1/enviar-datos'
                    }, { onConflict: 'id_postulante' });
                } catch (dataErr) {
                    console.error('[API v1] Advertencia al sincronizar en tabla postulantes:', dataErr.message);
                }
            }

            // 2. Validar límite diario (50)
            const currentCounter = getLeadsCounter();
            if (currentCounter.count >= 50) {
                console.log(`[API v1] ❌ Límite diario de 50 alcanzado.`);
                res.writeHead(403);
                return res.end('Limite diario alcanzado');
            }

            // 3. Incrementar contador y añadir a cola
            incrementLeadsCounter(50);
            apiQueue.push({ targetNumber, nombre: cleanNombre, facultad, programa });
            processApiQueue(adapterProvider);

            return res.end('Lead encolado para procesamiento.');
        } catch (err) {
            res.writeHead(500);
            return res.end(err.message);
        }
    }));
}
