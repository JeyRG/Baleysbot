/**
 * Rutas de Revisión y Feedback Loop de Respuestas del Bot
 */
export function registerReviewRoutes(server, { supabase, getEmbedding }) {
    // 1. Listar interacciones pendientes de revisión
    server.get('/bot/responses-review', async (req, res) => {
        try {
            const reviewed = req.query?.reviewed;
            const source = req.query?.source;
            const limit = parseInt(req.query?.limit) || 50;

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

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // 2. Aprobar una respuesta como correcta → guardar en semantic_cache
    server.post('/bot/responses-review/:id/approve', async (req, res) => {
        try {
            const { id } = req.params;

            const { data: interaction, error: fetchErr } = await supabase
                .from('chatbot_interactions')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchErr || !interaction) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Interacción no encontrada' }));
            }

            let embeddingToSave = interaction.embedding;
            if (!embeddingToSave) {
                embeddingToSave = await getEmbedding(interaction.user_query);
            }

            if (embeddingToSave) {
                await supabase.from('semantic_cache').insert({
                    question: interaction.user_query,
                    answer: interaction.bot_response,
                    embedding: embeddingToSave,
                });
            }

            await supabase
                .from('chatbot_interactions')
                .update({ reviewed: true, is_correct: true })
                .eq('id', id);

            console.log(`[Review] ✅ Interacción ${id} aprobada y guardada en caché.`);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Respuesta aprobada y guardada en caché semántico' }));
        } catch (err) {
            console.error('[Review] Error al aprobar:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // 3. Corregir una respuesta incorrecta → guardar corrección en cache + knowledge_base
    server.post('/bot/responses-review/:id/correct', async (req, res) => {
        try {
            const { id } = req.params;
            const { corrected_response } = req.body || {};

            if (!corrected_response) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Se requiere corrected_response en el body' }));
            }

            const { data: interaction, error: fetchErr } = await supabase
                .from('chatbot_interactions')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchErr || !interaction) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Interacción no encontrada' }));
            }

            let embeddingToSave = interaction.embedding;
            if (!embeddingToSave) {
                embeddingToSave = await getEmbedding(interaction.user_query);
            }

            if (embeddingToSave) {
                await supabase.from('semantic_cache').insert({
                    question: interaction.user_query,
                    answer: corrected_response,
                    embedding: embeddingToSave,
                });
            }

            const kbEmbedding = await getEmbedding(corrected_response);
            if (kbEmbedding) {
                await supabase.from('knowledge_base').insert({
                    content: `Pregunta: ${interaction.user_query}\nRespuesta correcta: ${corrected_response}`,
                    embedding: kbEmbedding,
                    metadata: { corrected_from: id, original_response: interaction.bot_response },
                });
            }

            await supabase
                .from('chatbot_interactions')
                .update({
                    reviewed: true,
                    is_correct: false,
                    corrected_response: corrected_response,
                })
                .eq('id', id);

            console.log(`[Review] ✏️ Interacción ${id} corregida. Guardada en caché + knowledge_base.`);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Respuesta corregida y guardada en caché semántico + base de conocimientos' }));
        } catch (err) {
            console.error('[Review] Error al corregir:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // 4. Estadísticas de revisión
    server.get('/bot/responses-review/stats', async (req, res) => {
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

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(stats));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}
