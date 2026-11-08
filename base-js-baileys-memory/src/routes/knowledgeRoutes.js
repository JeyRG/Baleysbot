/**
 * Rutas de Gestión de Conocimiento (RAG, Unresolved Queries y Cache Semántico)
 */
export function registerKnowledgeRoutes(server, { supabase, getEmbedding }) {
    // 1. Listar Dudas Pendientes (Feedback Loop)
    server.get('/bot/unresolved', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('unresolved_queries')
                .select('*')
                .eq('resolved', false)
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // 2. Resolver una duda: Mover a Knowledge Base y marcar como resuelta
    server.post('/bot/resolve', async (req, res) => {
        try {
            const { id, content } = req.body || {};
            if (!id || !content) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'ID y contenido son requeridos' }));
            }

            console.log(`[RAG Admin] Resolviendo duda ${id} -> Entrenando bot...`);
            const embedding = await getEmbedding(content);

            const { error: insertError } = await supabase
                .from('knowledge_base')
                .insert({ content, embedding });

            if (insertError) throw insertError;

            const { error: updateError } = await supabase
                .from('unresolved_queries')
                .update({ resolved: true })
                .eq('id', id);

            if (updateError) throw updateError;

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // 3. Listar Base de Conocimientos
    server.get('/bot/knowledge', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('knowledge_base')
                .select('id, content, metadata, created_at')
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // 4. Agregar nuevo fragmento con embedding
    server.post('/bot/knowledge', async (req, res) => {
        try {
            const { content, metadata } = req.body || {};
            if (!content) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'El contenido es requerido' }));
            }

            console.log(`[RAG Admin] Generando embedding para nuevo fragmento...`);
            const embedding = await getEmbedding(content);

            const { data, error } = await supabase
                .from('knowledge_base')
                .insert({
                    content,
                    metadata: metadata || {},
                    embedding
                })
                .select();

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, data: data[0] }));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // 5. Actualizar fragmento y su embedding
    server.put('/bot/knowledge/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { content, metadata } = req.body || {};
            if (!content) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'El contenido es requerido' }));
            }

            console.log(`[RAG Admin] Actualizando fragmento ID ${id}...`);
            const embedding = await getEmbedding(content);

            const { data, error } = await supabase
                .from('knowledge_base')
                .update({
                    content,
                    metadata: metadata || {},
                    embedding
                })
                .eq('id', id)
                .select();

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, data: data[0] }));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // 6. Eliminar fragmento
    server.delete('/bot/knowledge/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { error } = await supabase
                .from('knowledge_base')
                .delete()
                .eq('id', id);

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Fragmento eliminado' }));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // 7. Listar Memoria Semántica (Caché)
    server.get('/bot/cache', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('semantic_cache')
                .select('id, question, answer, created_at')
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
        }
    });

    // 8. Actualizar respuesta en memoria semántica
    server.put('/bot/cache/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { answer } = req.body || {};
            if (!answer) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'La respuesta es requerida' }));
            }

            const { error } = await supabase
                .from('semantic_cache')
                .update({ answer })
                .eq('id', id);

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
        }
    });

    // 9. Eliminar entrada de memoria semántica (o limpiar todo si id === 'all')
    server.delete('/bot/cache/:id', async (req, res) => {
        try {
            const { id } = req.params;
            if (id === 'all') {
                const { error } = await supabase
                    .from('semantic_cache')
                    .delete()
                    .neq('id', '00000000-0000-0000-0000-000000000000');

                if (error) throw error;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ success: true, message: 'Memoria limpiada totalmente' }));
            }

            const { error } = await supabase
                .from('semantic_cache')
                .delete()
                .eq('id', id);

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
        }
    });

    // 10. Simulador de Consulta RAG 2.0 (Testing y Diagnóstico en Tiempo Real)
    server.post('/bot/simulate', async (req, res) => {
        try {
            const { query, filter_meta, threshold } = req.body || {};
            if (!query) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'La consulta (query) es requerida' }));
            }

            const embedding = await getEmbedding(query);
            const matchThreshold = threshold !== undefined ? parseFloat(threshold) : 0.45;

            // 1. Similitud con Cache Semántico
            const { data: cacheMatches, error: cacheErr } = await supabase.rpc('match_semantic_cache', {
                query_embedding: embedding,
                match_threshold: 0.90,
            });

            // 2. Similitud con Base de Conocimientos
            const { data: ragDocuments, error: ragErr } = await supabase.rpc('match_documents_filtered', {
                query_embedding: embedding,
                match_threshold: matchThreshold,
                match_count: 5,
                filter_meta: filter_meta || {}
            });

            if (cacheErr) console.warn('[Simulate] Error cache:', cacheErr.message);
            if (ragErr) console.warn('[Simulate] Error RAG:', ragErr.message);

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                query,
                calibrated_threshold: matchThreshold,
                semantic_cache_hit: cacheMatches?.[0] || null,
                rag_matches: ragDocuments || [],
                top_confidence: ragDocuments?.[0]?.similarity || null
            }));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}

