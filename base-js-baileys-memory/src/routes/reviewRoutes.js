import { withAdminAuth, sendJsonResponse } from '../services/httpAuthMiddleware.js';

/**
 * Rutas de Revisión y Feedback Loop de Respuestas del Bot
 * Única puerta autorizada para insertar respuestas aprendidas en semantic_cache.
 */
export function registerReviewRoutes(server, { supabase, getEmbedding, verifyToken, writeAudit }) {
    const auth = (handler) => withAdminAuth(verifyToken, handler);

    // 1. Listar interacciones pendientes de revisión
    server.get('/bot/responses-review', auth(async (req, res) => {
        try {
            const reviewed = req.query?.reviewed;
            const source = req.query?.source;
            const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);

            let query = supabase
                .from('chatbot_interactions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (reviewed === 'false') {
                query = query.eq('reviewed', false);
            } else if (reviewed === 'true') {
                query = query.eq('reviewed', true);
            }

            if (source) {
                query = query.eq('source', source);
            }

            const { data, error } = await query;
            if (error) throw error;

            return sendJsonResponse(res, 200, data);
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 2. Aprobar una respuesta como correcta → guardar en semantic_cache
    server.post('/bot/responses-review/:id/approve', auth(async (req, res) => {
        try {
            const { id } = req.params;

            const { data: interaction, error: fetchErr } = await supabase
                .from('chatbot_interactions')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchErr || !interaction) {
                return sendJsonResponse(res, 404, { error: 'Interacción no encontrada' });
            }

            let embeddingToSave = interaction.embedding;
            if (!embeddingToSave && interaction.user_query) {
                embeddingToSave = await getEmbedding(interaction.user_query);
            }

            if (embeddingToSave && interaction.user_query && interaction.bot_response) {
                await supabase.from('semantic_cache').insert({
                    question: interaction.user_query.trim(),
                    answer: interaction.bot_response.trim(),
                    embedding: embeddingToSave,
                });
            }

            await supabase
                .from('chatbot_interactions')
                .update({ reviewed: true, is_correct: true })
                .eq('id', id);

            if (typeof writeAudit === 'function') {
                await writeAudit({
                    actorId: req.adminUser?.id || null,
                    actorUsername: req.adminUser?.username || 'admin',
                    action: 'approve_interaction',
                    targetType: 'chatbot_interaction',
                    targetId: String(id),
                    details: { query: (interaction.user_query || '').slice(0, 80) }
                });
            }

            console.log(`[Review] ✅ Interacción ${id} aprobada por ${req.adminUser?.username} y guardada en caché.`);
            return sendJsonResponse(res, 200, { success: true, message: 'Respuesta aprobada y guardada en caché semántico' });
        } catch (err) {
            console.error('[Review] Error al aprobar:', err);
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 3. Corregir una respuesta incorrecta → guardar corrección en cache + knowledge_base
    server.post('/bot/responses-review/:id/correct', auth(async (req, res) => {
        try {
            const { id } = req.params;
            const { corrected_response } = req.body || {};

            if (!corrected_response || typeof corrected_response !== 'string' || !corrected_response.trim()) {
                return sendJsonResponse(res, 400, { error: 'Se requiere corrected_response válido en el body' });
            }

            const cleanCorrection = corrected_response.trim();

            const { data: interaction, error: fetchErr } = await supabase
                .from('chatbot_interactions')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchErr || !interaction) {
                return sendJsonResponse(res, 404, { error: 'Interacción no encontrada' });
            }

            let embeddingToSave = interaction.embedding;
            if (!embeddingToSave && interaction.user_query) {
                embeddingToSave = await getEmbedding(interaction.user_query);
            }

            if (embeddingToSave && interaction.user_query) {
                await supabase.from('semantic_cache').insert({
                    question: interaction.user_query.trim(),
                    answer: cleanCorrection,
                    embedding: embeddingToSave,
                });
            }

            const kbEmbedding = await getEmbedding(cleanCorrection);
            if (kbEmbedding) {
                await supabase.from('knowledge_base').insert({
                    content: `Pregunta: ${interaction.user_query}\nRespuesta correcta: ${cleanCorrection}`,
                    embedding: kbEmbedding,
                    metadata: { corrected_from: id, original_response: interaction.bot_response },
                });
            }

            await supabase
                .from('chatbot_interactions')
                .update({
                    reviewed: true,
                    is_correct: false,
                    corrected_response: cleanCorrection,
                })
                .eq('id', id);

            if (typeof writeAudit === 'function') {
                await writeAudit({
                    actorId: req.adminUser?.id || null,
                    actorUsername: req.adminUser?.username || 'admin',
                    action: 'correct_interaction',
                    targetType: 'chatbot_interaction',
                    targetId: String(id),
                    details: { query: (interaction.user_query || '').slice(0, 80) }
                });
            }

            console.log(`[Review] ✏️ Interacción ${id} corregida por ${req.adminUser?.username}. Guardada en caché + knowledge_base.`);
            return sendJsonResponse(res, 200, { success: true, message: 'Respuesta corregida y guardada en caché semántico + base de conocimientos' });
        } catch (err) {
            console.error('[Review] Error al corregir:', err);
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 4. Estadísticas de revisión
    server.get('/bot/responses-review/stats', auth(async (req, res) => {
        try {
            const { data: allData, error } = await supabase
                .from('chatbot_interactions')
                .select('reviewed, is_correct, source');

            if (error) throw error;

            const stats = {
                total: allData.length,
                pending: allData.filter(d => !d.reviewed).length,
                approved: allData.filter(d => d.reviewed && d.is_correct === true).length,
                corrected: allData.filter(d => d.reviewed && d.is_correct === false).length,
                by_source: {},
            };

            allData.forEach(d => {
                stats.by_source[d.source] = (stats.by_source[d.source] || 0) + 1;
            });

            return sendJsonResponse(res, 200, stats);
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));
}
