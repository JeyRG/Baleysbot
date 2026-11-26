import crypto from 'crypto';
import {
    checkWebhookIpRateLimit,
    sendJsonResponse
} from '../services/httpAuthMiddleware.js';
import {
    findPrograms,
    findFaculty,
    findCategory,
    getContextForFaculty,
    getContextForCategory,
    getEnrichedContextForGrok,
    getCatalog
} from '../services/catalogService.js';
import { getBotSettings, buildInstitutionalContextSummary } from '../services/settingsService.js';

/**
 * Rutas especializadas para el Chat Web del Postulante (/v1/chat)
 * Permite identificación de visitante persistente, retención de contexto,
 * respuestas automáticas de Grok y entrega en tiempo real de asesores humanos.
 */
export function registerWebChatRoutes(server, {
    supabase,
    getGrokCompletion,
    getEmbedding
}) {
    /**
     * Helper para generar un ID seguro de visitante web
     */
    function generateWebSessionId() {
        const randomPart = crypto.randomBytes(4).toString('hex');
        return `web_${Date.now()}_${randomPart}`;
    }

    /**
     * 1. Inicialización o recuperación de sesión web
     * POST /v1/chat/session
     * Body: { visitorId }
     */
    server.post('/v1/chat/session', async (req, res) => {
        try {
            if (!checkWebhookIpRateLimit(req, 40)) {
                return sendJsonResponse(res, 429, { error: 'Demasiadas solicitudes' });
            }

            const { visitorId } = req.body || {};
            let activeVisitorId = typeof visitorId === 'string' && visitorId.startsWith('web_') ? visitorId.trim() : null;

            if (activeVisitorId) {
                // Verificar si existe la conversación previa
                const { data: conv } = await supabase
                    .from('conversations')
                    .select('id, wa_id, status, updated_at, metadata')
                    .eq('wa_id', activeVisitorId)
                    .maybeSingle();

                if (conv) {
                    // Verificar si la sesión tiene menos de 24 horas
                    const lastUpdated = new Date(conv.updated_at).getTime();
                    const hoursPassed = (Date.now() - lastUpdated) / (1000 * 60 * 60);

                    if (hoursPassed < 24) {
                        // Sesión válida: recuperar últimos 30 mensajes
                        const { data: messages } = await supabase
                            .from('messages')
                            .select('id, text, sender_type, created_at, media_url')
                            .eq('wa_id', activeVisitorId)
                            .order('created_at', { ascending: true })
                            .limit(30);

                        return sendJsonResponse(res, 200, {
                            session_id: activeVisitorId,
                            is_new: false,
                            status: conv.status || 'bot',
                            metadata: conv.metadata || {},
                            messages: messages || []
                        });
                    }
                }
            }

            // Crear una nueva sesión
            activeVisitorId = generateWebSessionId();
            const now = new Date().toISOString();

            await supabase.from('conversations').upsert({
                wa_id: activeVisitorId,
                status: 'bot',
                bot_enabled: true,
                channel: 'web',
                metadata: { channel: 'web', created_via: 'web-widget' },
                updated_at: now
            }, { onConflict: 'wa_id' });

            const welcomeText = '¡Hola! 👋 Soy el Asesor Virtual de Posgrado de la UNAC. ¿En qué maestría, doctorado o programa estás interesado hoy?';

            // Guardar mensaje de bienvenida inicial
            await supabase.from('messages').insert({
                wa_id: activeVisitorId,
                text: welcomeText,
                sender_type: 'bot',
                created_at: now
            });

            return sendJsonResponse(res, 200, {
                session_id: activeVisitorId,
                is_new: true,
                status: 'bot',
                metadata: { channel: 'web' },
                messages: [{
                    text: welcomeText,
                    sender_type: 'bot',
                    created_at: now
                }]
            });
        } catch (err) {
            console.error('[WebChat] Error en /v1/chat/session:', err);
            return sendJsonResponse(res, 500, { error: 'Error inicializando sesión web' });
        }
    });

    /**
     * 2. Obtener historial de mensajes de la sesión
     * GET /v1/chat/history?visitorId=web_...
     */
    server.get('/v1/chat/history', async (req, res) => {
        try {
            const visitorId = req.query?.visitorId;
            if (!visitorId || typeof visitorId !== 'string' || !visitorId.startsWith('web_')) {
                return sendJsonResponse(res, 400, { error: 'visitorId requerido con formato web_...' });
            }

            const cleanId = visitorId.trim();

            const [convRes, msgsRes] = await Promise.all([
                supabase.from('conversations').select('status, metadata').eq('wa_id', cleanId).maybeSingle(),
                supabase.from('messages').select('id, text, sender_type, created_at, media_url').eq('wa_id', cleanId).order('created_at', { ascending: true }).limit(50)
            ]);

            return sendJsonResponse(res, 200, {
                session_id: cleanId,
                status: convRes.data?.status || 'bot',
                metadata: convRes.data?.metadata || {},
                messages: msgsRes.data || []
            });
        } catch (err) {
            console.error('[WebChat] Error en /v1/chat/history:', err);
            return sendJsonResponse(res, 500, { error: 'Error recuperando historial' });
        }
    });

    /**
     * 3. Envío de mensaje desde el widget web
     * POST /v1/chat/message
     * Body: { visitorId, text }
     */
    server.post('/v1/chat/message', async (req, res) => {
        try {
            if (!checkWebhookIpRateLimit(req, 30)) {
                return sendJsonResponse(res, 429, { error: 'Demasiadas solicitudes por minuto' });
            }

            const { visitorId, text } = req.body || {};
            const cleanText = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
            const cleanId = typeof visitorId === 'string' && visitorId.startsWith('web_') ? visitorId.trim() : null;

            if (!cleanId || !cleanText) {
                return sendJsonResponse(res, 400, { error: 'visitorId y text son requeridos' });
            }

            const now = new Date().toISOString();

            // 1. Guardar mensaje del usuario en la base de datos
            await supabase.from('messages').insert({
                wa_id: cleanId,
                text: cleanText,
                sender_type: 'user',
                created_at: now
            });

            // Actualizar timestamp de la conversación
            await supabase.from('conversations').upsert({
                wa_id: cleanId,
                updated_at: now,
                channel: 'web'
            }, { onConflict: 'wa_id' });

            // 2. Comprobar si la conversación está tomada por un asesor humano
            const { data: conv } = await supabase
                .from('conversations')
                .select('status, metadata')
                .eq('wa_id', cleanId)
                .maybeSingle();

            if (conv?.status === 'human_active') {
                return sendJsonResponse(res, 200, {
                    session_id: cleanId,
                    status: 'human_active',
                    message: null,
                    notice: 'Tu mensaje fue recibido por un asesor humano. Te responderá en breve.'
                });
            }

            // 3. Procesar consulta con catálogo institucional y Grok RAG
            let dynamicContext = '';
            const lowerText = cleanText.toLowerCase();

            const programsMatch = findPrograms(lowerText);
            const facultyMatch = findFaculty(lowerText);
            const categoryMatch = findCategory(lowerText);

            if (programsMatch && programsMatch.length > 0) {
                dynamicContext = programsMatch.map(p => `Programa: ${p.nombre}. Info: ${p.descripcion || ''}.`).join('\n');
            } else if (facultyMatch) {
                dynamicContext = getContextForFaculty(facultyMatch);
            } else if (categoryMatch) {
                const catCtx = getContextForCategory(categoryMatch);
                dynamicContext = (typeof catCtx === 'object' && catCtx !== null) ? (catCtx.text || '') : (catCtx || '');
                const enriched = getEnrichedContextForGrok(categoryMatch);
                if (enriched) dynamicContext += '\n' + (enriched || '');
            } else {
                const catalog = getCatalog();
                const numFacultades = catalog ? Object.keys(catalog).length : 0;
                const nombresFacultades = catalog ? Object.values(catalog).map(f => f.nombre).join(', ') : '';
                dynamicContext = `Contamos con Maestrías, Doctorados y Segundas Especialidades en ${numFacultades} facultades: ${nombresFacultades}.`;
                const enrichedM = getEnrichedContextForGrok('maestrias');
                const enrichedD = getEnrichedContextForGrok('doctorados');
                if (enrichedM || enrichedD) {
                    dynamicContext += '\nProgramas destacados:\n' + (enrichedM || '') + (enrichedD || '');
                }
            }

            // Opcional: RAG vectorial si existe función
            if (getEmbedding) {
                try {
                    const embedding = await getEmbedding(cleanText);
                    if (embedding) {
                        const { data: documents } = await supabase.rpc('match_documents_filtered', {
                            query_embedding: embedding,
                            match_threshold: 0.45,
                            match_count: 2,
                            filter_meta: {}
                        });
                        if (documents && documents.length > 0) {
                            dynamicContext += '\n\n' + documents.map(d => d.content).join('\n\n');
                        }
                    }
                } catch (embErr) {
                    // Ignorar fallback silenciosamente
                }
            }

            // Historial reciente para dar coherencia
            const { data: recentMsgs } = await supabase
                .from('messages')
                .select('text, sender_type')
                .eq('wa_id', cleanId)
                .order('created_at', { ascending: false })
                .limit(6);

            const historyTurns = (recentMsgs || [])
                .filter(m => m && typeof m.text === 'string')
                .reverse()
                .map(m => ({
                    role: m.sender_type === 'user' ? 'user' : 'assistant',
                    content: m.text
                }));

            const userName = conv?.metadata?.name || 'Visitante Web';
            let botReply = await getGrokCompletion(userName, cleanText, dynamicContext, {
                maxTokens: 200,
                historyTurns
            });

            // Manejo de transferencia a asesor si Grok responde [SOLICITUD_ASESOR]
            let updatedStatus = 'bot';
            if (!botReply || botReply.includes('[SOLICITUD_ASESOR]')) {
                updatedStatus = 'human_active';
                botReply = 'Para brindarte información detallada y exacta sobre ese punto, he derivado tu consulta a un asesor académico. En breve responderemos aquí mismo.';

                await supabase.from('conversations').update({
                    status: 'human_active',
                    updated_at: new Date().toISOString()
                }).eq('wa_id', cleanId);
            }

            // Guardar respuesta del bot en base de datos
            await supabase.from('messages').insert({
                wa_id: cleanId,
                text: botReply,
                sender_type: 'bot',
                created_at: new Date().toISOString()
            });

            return sendJsonResponse(res, 200, {
                session_id: cleanId,
                status: updatedStatus,
                reply: botReply
            });
        } catch (err) {
            console.error('[WebChat] Error en /v1/chat/message:', err);
            return sendJsonResponse(res, 500, { error: 'Error procesando mensaje' });
        }
    });

    /**
     * 4. Registro progresivo de lead desde el chat web
     * POST /v1/chat/lead
     * Body: { visitorId, nombre, telefono, email, programa }
     */
    server.post('/v1/chat/lead', async (req, res) => {
        try {
            const { visitorId, nombre, telefono, email, programa } = req.body || {};
            const cleanId = typeof visitorId === 'string' && visitorId.startsWith('web_') ? visitorId.trim() : null;

            if (!cleanId) {
                return sendJsonResponse(res, 400, { error: 'visitorId inválido' });
            }

            const cleanNombre = typeof nombre === 'string' ? nombre.trim().slice(0, 120) : null;
            const cleanPhone = typeof telefono === 'string' ? telefono.replace(/\D/g, '').slice(0, 15) : null;
            const cleanEmail = typeof email === 'string' ? email.trim().slice(0, 100) : null;
            const cleanPrograma = typeof programa === 'string' ? programa.trim().slice(0, 150) : null;

            // Actualizar metadata de la conversación
            const metadataUpdates = {
                name: cleanNombre,
                phone: cleanPhone,
                email: cleanEmail,
                interested_program: cleanPrograma,
                lead_captured_at: new Date().toISOString()
            };

            await supabase.from('conversations').update({
                metadata: metadataUpdates,
                updated_at: new Date().toISOString()
            }).eq('wa_id', cleanId);

            // Si hay teléfono o nombre, guardar en students
            if (cleanPhone || cleanNombre) {
                await supabase.from('students').upsert({
                    wa_id: cleanPhone || cleanId,
                    full_name: cleanNombre,
                    phone_number: cleanPhone,
                    student_condition: 'postulante',
                    updated_at: new Date().toISOString()
                }, { onConflict: 'wa_id' });
            }

            return sendJsonResponse(res, 200, { ok: true, metadata: metadataUpdates });
        } catch (err) {
            console.error('[WebChat] Error en /v1/chat/lead:', err);
            return sendJsonResponse(res, 500, { error: 'Error registrando datos de lead' });
        }
    });

    /**
     * 5. Reinicio explícito de conversación ("Nueva consulta")
     * POST /v1/chat/reset
     * Body: { visitorId }
     */
    server.post('/v1/chat/reset', async (req, res) => {
        try {
            const newSessionId = generateWebSessionId();
            const now = new Date().toISOString();

            await supabase.from('conversations').upsert({
                wa_id: newSessionId,
                status: 'bot',
                bot_enabled: true,
                channel: 'web',
                metadata: { channel: 'web', reset_from: req.body?.visitorId || null },
                updated_at: now
            }, { onConflict: 'wa_id' });

            const welcomeText = 'Conversación reiniciada. ¿En qué programa de Posgrado UNAC te gustaría consultar hoy?';

            await supabase.from('messages').insert({
                wa_id: newSessionId,
                text: welcomeText,
                sender_type: 'bot',
                created_at: now
            });

            return sendJsonResponse(res, 200, {
                session_id: newSessionId,
                is_new: true,
                status: 'bot',
                messages: [{
                    text: welcomeText,
                    sender_type: 'bot',
                    created_at: now
                }]
            });
        } catch (err) {
            console.error('[WebChat] Error en /v1/chat/reset:', err);
            return sendJsonResponse(res, 500, { error: 'Error reiniciando sesión' });
        }
    });
}
