import crypto from 'crypto';
import {
    checkWebhookIpRateLimit,
    sendJsonResponse
} from '../services/httpAuthMiddleware.js';
import {
    findPrograms,
    findFaculty,
    findThematicMatch,
    findCategory,
    getContextForFaculty,
    getContextForCategory,
    getEnrichedContextForGrok,
    getCatalog
} from '../services/catalogService.js';
import { getBotSettings, buildInstitutionalContextSummary } from '../services/settingsService.js';

const VALID_CONDITIONS = ['postulante', 'estudiante', 'egresado'];

function normalizeCondition(raw) {
    if (!raw || typeof raw !== 'string') return 'postulante';
    const clean = raw.toLowerCase().trim();
    if (clean.includes('estudiante') || clean.includes('alumno')) return 'estudiante';
    if (clean.includes('egresado') || clean.includes('graduado')) return 'egresado';
    if (VALID_CONDITIONS.includes(clean)) return clean;
    return 'postulante';
}

/**
 * Filtra mensajes consecutivos idénticos generados por sesiones antiguas con duplicación
 */
function deduplicateMessagesList(messages = []) {
    const result = [];
    for (const msg of messages) {
        const prev = result[result.length - 1];
        if (
            prev &&
            prev.sender_type === msg.sender_type &&
            (prev.text || '').trim() === (msg.text || '').trim()
        ) {
            const t1 = prev.created_at ? new Date(prev.created_at).getTime() : 0;
            const t2 = msg.created_at ? new Date(msg.created_at).getTime() : 0;
            if (Math.abs(t2 - t1) < 15000) {
                continue;
            }
        }
        result.push(msg);
    }
    return result;
}

/**
 * Rutas especializadas para el Chat Web del Postulante (/v1/chat)
 * Permite identificación de visitante persistente, captura obligatoria de lead
 * (nombre, celular, condición: postulante/estudiante/egresado), retención de contexto,
 * registro en chatbot_interactions y entrega en tiempo real de asesores humanos.
 */
export function registerWebChatRoutes(server, {
    supabase,
    getGrokCompletion,
    getEmbedding
}) {
    function generateWebSessionId() {
        const randomPart = crypto.randomBytes(4).toString('hex');
        return `web_${Date.now()}_${randomPart}`;
    }

    /**
     * Sincroniza los datos del lead web en conversations, students y devuelve la metadata consolidada
     */
    async function syncWebVisitorProfile(waId, existingMeta = {}, profileInput = {}) {
        const now = new Date().toISOString();
        const cleanNombre = typeof profileInput.nombre === 'string' && profileInput.nombre.trim()
            ? profileInput.nombre.trim().slice(0, 120)
            : (existingMeta.name || existingMeta.full_name || null);

        const cleanPhone = typeof profileInput.telefono === 'string' && profileInput.telefono.trim()
            ? profileInput.telefono.replace(/\D/g, '').slice(0, 15)
            : (existingMeta.phone || null);

        const rawCond = profileInput.condicion || existingMeta.user_condition || existingMeta.user_role || null;
        const cleanCondicion = rawCond ? normalizeCondition(rawCond) : null;

        const cleanEmail = typeof profileInput.email === 'string' && profileInput.email.trim()
            ? profileInput.email.trim().slice(0, 100)
            : (existingMeta.email || null);

        const cleanPrograma = typeof profileInput.programa === 'string' && profileInput.programa.trim()
            ? profileInput.programa.trim().slice(0, 150)
            : (existingMeta.interested_program || null);

        const mergedMeta = {
            ...existingMeta,
            channel: 'web',
            name: cleanNombre,
            full_name: cleanNombre,
            phone: cleanPhone,
            user_condition: cleanCondicion,
            user_role: cleanCondicion,
            email: cleanEmail,
            interested_program: cleanPrograma,
            lead_captured_at: existingMeta.lead_captured_at || (cleanNombre && cleanPhone ? now : null)
        };

        let studentId = null;
        if (cleanNombre || cleanPhone || cleanCondicion) {
            try {
                const { data: stData } = await supabase
                    .from('students')
                    .upsert({
                        wa_id: waId,
                        full_name: cleanNombre,
                        phone_number: cleanPhone,
                        student_condition: cleanCondicion || 'postulante',
                        updated_at: now
                    }, { onConflict: 'wa_id' })
                    .select('id')
                    .maybeSingle();

                studentId = stData?.id || null;
            } catch (stErr) {
                console.error('[WebChat] Error sincronizando tabla students:', stErr.message);
            }
        }

        const convUpdate = {
            wa_id: waId,
            channel: 'web',
            metadata: mergedMeta,
            updated_at: now
        };
        if (studentId) {
            convUpdate.student_id = studentId;
        }

        await supabase
            .from('conversations')
            .upsert(convUpdate, { onConflict: 'wa_id' });

        return mergedMeta;
    }

    /**
     * 1. Inicialización o recuperación de sesión web
     * POST /v1/chat/session
     * Body: { visitorId, userProfile? }
     */
    server.post('/v1/chat/session', async (req, res) => {
        try {
            if (!checkWebhookIpRateLimit(req, 40)) {
                return sendJsonResponse(res, 429, { error: 'Demasiadas solicitudes' });
            }

            const { visitorId, userProfile } = req.body || {};
            let activeVisitorId = typeof visitorId === 'string' && visitorId.startsWith('web_') ? visitorId.trim() : null;

            if (activeVisitorId) {
                const { data: conv } = await supabase
                    .from('conversations')
                    .select('id, wa_id, status, updated_at, metadata')
                    .eq('wa_id', activeVisitorId)
                    .maybeSingle();

                if (conv) {
                    const lastUpdated = new Date(conv.updated_at).getTime();
                    const hoursPassed = (Date.now() - lastUpdated) / (1000 * 60 * 60);

                    if (hoursPassed < 24) {
                        let currentMeta = conv.metadata || {};
                        if (userProfile && (userProfile.nombre || userProfile.telefono || userProfile.condicion)) {
                            currentMeta = await syncWebVisitorProfile(activeVisitorId, currentMeta, userProfile);
                        }

                        const { data: messages } = await supabase
                            .from('messages')
                            .select('id, text, sender_type, created_at, media_url')
                            .eq('wa_id', activeVisitorId)
                            .order('created_at', { ascending: true })
                            .limit(40);

                        return sendJsonResponse(res, 200, {
                            session_id: activeVisitorId,
                            is_new: false,
                            status: conv.status || 'bot',
                            metadata: currentMeta,
                            messages: deduplicateMessagesList(messages || [])
                        });
                    }
                }
            }

            // Crear una nueva sesión
            activeVisitorId = generateWebSessionId();
            const now = new Date().toISOString();

            const initialMeta = await syncWebVisitorProfile(
                activeVisitorId,
                { channel: 'web', created_via: 'web-widget' },
                userProfile || {}
            );

            await supabase.from('conversations').upsert({
                wa_id: activeVisitorId,
                status: 'bot',
                bot_enabled: true,
                channel: 'web',
                metadata: initialMeta,
                updated_at: now
            }, { onConflict: 'wa_id' });

            const welcomeText = '¡Hola! 👋 Soy el Asesor Virtual de la Escuela de Posgrado de la UNAC. ¿En qué maestría, doctorado o trámite académico puedo ayudarte hoy?';

            const { data: insertedWelcome } = await supabase
                .from('messages')
                .insert({
                    wa_id: activeVisitorId,
                    text: welcomeText,
                    sender_type: 'bot',
                    created_at: now
                })
                .select('id, text, sender_type, created_at')
                .maybeSingle();

            return sendJsonResponse(res, 200, {
                session_id: activeVisitorId,
                is_new: true,
                status: 'bot',
                metadata: initialMeta,
                messages: [insertedWelcome || {
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
                messages: deduplicateMessagesList(msgsRes.data || [])
            });
        } catch (err) {
            console.error('[WebChat] Error en /v1/chat/history:', err);
            return sendJsonResponse(res, 500, { error: 'Error recuperando historial' });
        }
    });

    /**
     * 3. Envío de mensaje desde el widget web
     * POST /v1/chat/message
     * Body: { visitorId, text, userProfile?: { nombre, telefono, condicion } }
     */
    server.post('/v1/chat/message', async (req, res) => {
        try {
            if (!checkWebhookIpRateLimit(req, 30)) {
                return sendJsonResponse(res, 429, { error: 'Demasiadas solicitudes por minuto' });
            }

            const { visitorId, text, userProfile } = req.body || {};
            const cleanText = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
            const cleanId = typeof visitorId === 'string' && visitorId.startsWith('web_') ? visitorId.trim() : null;

            if (!cleanId || !cleanText) {
                return sendJsonResponse(res, 400, { error: 'visitorId y text son requeridos' });
            }

            const now = new Date().toISOString();

            // 1. Obtener estado y metadata actual de la conversación
            const { data: conv } = await supabase
                .from('conversations')
                .select('status, metadata')
                .eq('wa_id', cleanId)
                .maybeSingle();

            // 2. Sincronizar perfil (nombre, celular, condición) en cada interacción
            const activeMeta = await syncWebVisitorProfile(cleanId, conv?.metadata || {}, userProfile || {});
            const userName = activeMeta.name || activeMeta.full_name || 'Visitante Web';
            const userPhone = activeMeta.phone || null;
            const userCondition = activeMeta.user_condition || 'postulante';

            // 3. Guardar mensaje del usuario en la base de datos y obtener su ID real
            const { data: insertedUserMsg } = await supabase
                .from('messages')
                .insert({
                    wa_id: cleanId,
                    text: cleanText,
                    sender_type: 'user',
                    created_at: now
                })
                .select('id, text, sender_type, created_at')
                .maybeSingle();

            // Actualizar último mensaje en la conversación
            await supabase
                .from('conversations')
                .update({
                    last_message: cleanText,
                    updated_at: now
                })
                .eq('wa_id', cleanId);

            // 4. Comprobar si la conversación está tomada por un asesor humano
            if (conv?.status === 'human_active') {
                return sendJsonResponse(res, 200, {
                    session_id: cleanId,
                    status: 'human_active',
                    user_message: insertedUserMsg || null,
                    message: null,
                    notice: 'Tu mensaje fue recibido por un asesor académico. Te responderá en breve.'
                });
            }

            // 5. Procesar consulta con catálogo institucional y Grok RAG
            let dynamicContext = `Perfil del consultante: Nombre: ${userName} | Celular: ${userPhone || 'No registrado'} | Condición académica: ${userCondition.toUpperCase()}.\n`;
            const lowerText = cleanText.toLowerCase();

            const thematicMatch = findThematicMatch(lowerText);
            const programsMatch = findPrograms(lowerText);
            const facultyMatch = findFaculty(lowerText);
            const categoryMatch = findCategory(lowerText);

            if (thematicMatch) {
                dynamicContext += `\nORIENTACIÓN TEMÁTICA EXACTA:\n${thematicMatch.explicacion}\nFacultad vinculada: ${thematicMatch.facultadNombre}\nProgramas afines: ${thematicMatch.programas.join(', ')}.\n`;
                if (thematicMatch.facultadNombre) {
                    const facFromTheme = findFaculty(thematicMatch.facultadNombre);
                    if (facFromTheme) dynamicContext += '\n' + getContextForFaculty(facFromTheme);
                }
            } else if (facultyMatch) {
                dynamicContext += getContextForFaculty(facultyMatch);
            } else if (programsMatch && programsMatch.length > 0) {
                dynamicContext += programsMatch.map(p => `Programa: ${p.nombre}. Info: ${p.descripcion || ''}.`).join('\n');
            } else if (categoryMatch) {
                const catCtx = getContextForCategory(categoryMatch);
                dynamicContext += (typeof catCtx === 'object' && catCtx !== null) ? (catCtx.text || '') : (catCtx || '');
                const enriched = getEnrichedContextForGrok(categoryMatch);
                if (enriched) dynamicContext += '\n' + (enriched || '');
            } else {
                const catalog = getCatalog();
                const numFacultades = catalog ? Object.keys(catalog).length : 0;
                const nombresFacultades = catalog ? Object.values(catalog).map(f => f.nombre).join(', ') : '';
                dynamicContext += `Contamos con Maestrías, Doctorados y Segundas Especialidades en ${numFacultades} facultades: ${nombresFacultades}.`;
                const enrichedM = getEnrichedContextForGrok('maestrias');
                const enrichedD = getEnrichedContextForGrok('doctorados');
                if (enrichedM || enrichedD) {
                    dynamicContext += '\nProgramas destacados:\n' + (enrichedM || '') + (enrichedD || '');
                }
            }

            let queryEmbedding = null;
            if (getEmbedding) {
                try {
                    queryEmbedding = await getEmbedding(cleanText);
                    if (queryEmbedding) {
                        const { data: documents } = await supabase.rpc('match_documents_filtered', {
                            query_embedding: queryEmbedding,
                            match_threshold: 0.45,
                            match_count: 2,
                            filter_meta: {}
                        });
                        if (documents && documents.length > 0) {
                            dynamicContext += '\n\n' + documents.map(d => d.content).join('\n\n');
                        }
                    }
                } catch (embErr) {
                    // Fallback silencioso
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

            let botReply = await getGrokCompletion(userName, cleanText, dynamicContext, {
                maxTokens: 250,
                historyTurns
            });

            // Manejo de transferencia a asesor SOLO si Grok responde [SOLICITUD_ASESOR]
            // o si el usuario pide explícitamente hablar con un asesor humano
            let updatedStatus = 'bot';
            const isExplicitAdvisorRequest = /\b(asesor|humano|persona|hablar con alguien|atencion humana)\b/i.test(cleanText);

            if ((botReply && botReply.includes('[SOLICITUD_ASESOR]')) || isExplicitAdvisorRequest) {
                updatedStatus = 'human_active';
                botReply = `Estimado(a) ${userName}, he derivado tu solicitud a un asesor académico de la Escuela de Posgrado. Se comunicará contigo por este medio o al celular ${userPhone || ''} en breve.`;

                await supabase.from('conversations').update({
                    status: 'human_active',
                    updated_at: new Date().toISOString()
                }).eq('wa_id', cleanId);
            } else if (!botReply) {
                botReply = `Estimado(a) ${userName}, en la Escuela de Posgrado de la UNAC contamos con diversas Maestrías y Doctorados en ingeniería, gestión y ciencias de la salud. ¿Te gustaría conocer los programas de alguna facultad en específico?`;
            }

            const replyTime = new Date().toISOString();

            // 6. Guardar respuesta del bot en base de datos y devolver su ID real
            const { data: insertedBotMsg } = await supabase
                .from('messages')
                .insert({
                    wa_id: cleanId,
                    text: botReply,
                    sender_type: 'bot',
                    created_at: replyTime
                })
                .select('id, text, sender_type, created_at')
                .maybeSingle();

            // 7. Guardar registro de la interacción con Nombre, Celular y Condición en chatbot_interactions
            try {
                const displayUserName = userPhone && userName !== 'Visitante Web'
                    ? `${userName} (${userPhone})`
                    : userName;

                await supabase.from('chatbot_interactions').insert({
                    wa_id: cleanId,
                    user_name: displayUserName,
                    user_condition: userCondition,
                    user_query: cleanText,
                    bot_response: botReply || '',
                    embedding: queryEmbedding || null,
                    source: 'web_widget'
                });
            } catch (logErr) {
                console.error('[WebChat] Error guardando en chatbot_interactions:', logErr.message);
            }

            return sendJsonResponse(res, 200, {
                session_id: cleanId,
                status: updatedStatus,
                reply: botReply,
                user_message: insertedUserMsg || null,
                bot_message: insertedBotMsg || null,
                metadata: activeMeta
            });
        } catch (err) {
            console.error('[WebChat] Error en /v1/chat/message:', err);
            return sendJsonResponse(res, 500, { error: 'Error procesando mensaje' });
        }
    });

    /**
     * 4. Registro de lead y condición académica desde el chat web
     * POST /v1/chat/lead
     * Body: { visitorId, nombre, telefono, condicion, email, programa }
     */
    server.post('/v1/chat/lead', async (req, res) => {
        try {
            const { visitorId, nombre, telefono, condicion, email, programa } = req.body || {};
            const cleanId = typeof visitorId === 'string' && visitorId.startsWith('web_') ? visitorId.trim() : null;

            if (!cleanId) {
                return sendJsonResponse(res, 400, { error: 'visitorId inválido' });
            }

            const { data: existingConv } = await supabase
                .from('conversations')
                .select('metadata')
                .eq('wa_id', cleanId)
                .maybeSingle();

            const updatedMetadata = await syncWebVisitorProfile(
                cleanId,
                existingConv?.metadata || {},
                { nombre, telefono, condicion, email, programa }
            );

            return sendJsonResponse(res, 200, {
                ok: true,
                metadata: updatedMetadata
            });
        } catch (err) {
            console.error('[WebChat] Error en /v1/chat/lead:', err);
            return sendJsonResponse(res, 500, { error: 'Error registrando datos de lead' });
        }
    });

    /**
     * 5. Reinicio explícito de conversación ("Nueva consulta")
     * POST /v1/chat/reset
     * Body: { visitorId, userProfile? }
     */
    server.post('/v1/chat/reset', async (req, res) => {
        try {
            const newSessionId = generateWebSessionId();
            const now = new Date().toISOString();
            const { userProfile } = req.body || {};

            const initialMeta = await syncWebVisitorProfile(
                newSessionId,
                { channel: 'web', reset_from: req.body?.visitorId || null },
                userProfile || {}
            );

            await supabase.from('conversations').upsert({
                wa_id: newSessionId,
                status: 'bot',
                bot_enabled: true,
                channel: 'web',
                metadata: initialMeta,
                updated_at: now
            }, { onConflict: 'wa_id' });

            const welcomeText = initialMeta.name
                ? `Hola **${initialMeta.name}**, hemos iniciado una nueva consulta. ¿En qué programa o trámite de Posgrado UNAC puedo ayudarte hoy?`
                : 'Conversación reiniciada. ¿En qué programa de Posgrado UNAC te gustaría consultar hoy?';

            const { data: insertedWelcome } = await supabase
                .from('messages')
                .insert({
                    wa_id: newSessionId,
                    text: welcomeText,
                    sender_type: 'bot',
                    created_at: now
                })
                .select('id, text, sender_type, created_at')
                .maybeSingle();

            return sendJsonResponse(res, 200, {
                session_id: newSessionId,
                is_new: true,
                status: 'bot',
                metadata: initialMeta,
                messages: [insertedWelcome || {
                    text: welcomeText,
                    sender_type: 'bot',
                    created_at: now
                }]
            });
        } catch (e) {
            console.error('[WebChat] Error en /v1/chat/reset:', e);
            return sendJsonResponse(res, 500, { error: 'Error reiniciando sesión' });
        }
    });
}
