import { supabaseData as defaultSupabaseData } from '../services/supabaseClient.js';
import {
    authorizeWebhookRequest,
    checkWebhookIpRateLimit,
    sendJsonResponse
} from '../services/httpAuthMiddleware.js';
import { getBotSettings } from '../services/settingsService.js';
import {
    getTodayLeadQuotaCount,
    enqueueLeadJob,
    triggerLeadQueueWorker
} from '../services/leadQueueService.js';

/**
 * Rutas de Mensajería Externa y Gestión de Leads (/v1)
 * Protegidas con API Key / Sesión Bearer, sanitización de payload y cola durable en Supabase.
 */
export function registerMessagingRoutes(server, {
    handleCtx,
    supabase,
    supabaseData = defaultSupabaseData,
    verifyToken,
    dispatchLeadFn,
    onLeadSent,
    adapterProvider
}) {
    // 1. Envío directo de mensajes (Exige WEBHOOK_API_KEY o sesión Bearer de Admin)
    server.post('/v1/messages', handleCtx(async (bot, req, res) => {
        try {
            if (!checkWebhookIpRateLimit(req, 30)) {
                return sendJsonResponse(res, 429, { error: 'Demasiadas solicitudes' });
            }

            const authResult = await authorizeWebhookRequest(req, verifyToken, {
                allowLegacyWhenUnconfigured: false
            });
            if (!authResult.ok) {
                return sendJsonResponse(res, 401, { error: 'No autorizado. Proporcione X-API-Key o Bearer token válido.' });
            }

            const { number, message, urlMedia } = req.body || {};
            const cleanNumber = String(number || '').trim().replace(/[^\d@a-zA-Z.-]/g, '');
            const cleanMessage = typeof message === 'string' ? message.trim().slice(0, 4000) : '';
            const cleanMedia = typeof urlMedia === 'string' && /^https?:\/\//i.test(urlMedia.trim())
                ? urlMedia.trim()
                : null;

            if (!cleanNumber || (!cleanMessage && !cleanMedia)) {
                return sendJsonResponse(res, 400, { error: 'Faltan parametros requeridos válidos' });
            }

            await bot.sendMessage(cleanNumber, cleanMessage, { media: cleanMedia });
            res.statusCode = 200;
            return res.end('sended');
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 2. Recepción de leads y encolamiento controlado durable
    server.post('/v1/enviar-datos', handleCtx(async (bot, req, res) => {
        try {
            if (!checkWebhookIpRateLimit(req, 20)) {
                return sendJsonResponse(res, 429, { error: 'Demasiadas solicitudes desde esta IP' });
            }

            const authResult = await authorizeWebhookRequest(req, verifyToken, {
                allowLegacyWhenUnconfigured: true
            });
            if (!authResult.ok) {
                return sendJsonResponse(res, 401, { error: 'API Key inválida' });
            }

            let { wa_id, nombre, facultad, programa, dni, telefono } = req.body || {};
            let targetNumber = wa_id || telefono;

            if (!targetNumber || !dni) {
                return sendJsonResponse(res, 400, { error: 'Faltan wa_id/telefono o dni' });
            }

            const cleanDni = String(dni).trim().replace(/\D/g, '').slice(0, 15);
            const cleanPhone = String(telefono || targetNumber).trim().replace(/\D/g, '').slice(0, 18);
            const cleanNombre = typeof nombre === 'string' ? nombre.trim().slice(0, 120) : '';
            const cleanFacultad = typeof facultad === 'string' ? facultad.trim().slice(0, 150) : null;
            const cleanPrograma = typeof programa === 'string' ? programa.trim().slice(0, 200) : null;

            if (cleanDni.length < 8 || cleanPhone.length < 8) {
                return sendJsonResponse(res, 400, { error: 'DNI o teléfono con formato inválido' });
            }

            targetNumber = String(targetNumber).includes('@') ? `${cleanPhone}@s.whatsapp.net` : `${cleanPhone}@s.whatsapp.net`;
            console.log(`[API v1] Lead recibido para ${cleanNombre} (DNI: ${cleanDni}).`);

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
                            facultad: cleanFacultad,
                            programa: cleanPrograma,
                            origen: '/v1/enviar-datos'
                        },
                        nota_admin: 'Lead captado vía API /v1/enviar-datos'
                    }, { onConflict: 'id_postulante' });
                } catch (dataErr) {
                    console.error('[API v1] Advertencia al sincronizar en tabla postulantes:', dataErr.message);
                }
            }

            // 2. Validar límite diario dinámico desde configuración del Dashboard
            const dailyLimit = getBotSettings().modalidad_atencion.limite_leads_diario || 50;
            const currentCount = await getTodayLeadQuotaCount();
            if (currentCount >= dailyLimit) {
                console.log(`[API v1] ❌ Límite diario de ${dailyLimit} leads alcanzado.`);
                return sendJsonResponse(res, 403, { error: 'Limite diario alcanzado', limit: dailyLimit });
            }

            // 3. Encolar en outbound_lead_queue (durable ante reinicios) y disparar worker
            await enqueueLeadJob({
                targetNumber,
                dni: cleanDni,
                nombre: cleanNombre,
                facultad: cleanFacultad,
                programa: cleanPrograma
            });

            triggerLeadQueueWorker(adapterProvider, dispatchLeadFn, onLeadSent);

            res.statusCode = 200;
            return res.end('Lead encolado para procesamiento.');
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));
}
