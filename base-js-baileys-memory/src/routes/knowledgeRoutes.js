import { withAdminAuth, sendJsonResponse } from '../services/httpAuthMiddleware.js';

/**
 * Rutas de Gestión de Conocimiento (RAG, Unresolved Queries y Cache Semántico)
 * Protegidas mediante autenticación Bearer del Dashboard.
 */
export function registerKnowledgeRoutes(server, { supabase, getEmbedding, verifyToken, writeAudit }) {
    const auth = (handler) => withAdminAuth(verifyToken, handler);

    // 1. Listar Dudas Pendientes (Feedback Loop)
    server.get('/bot/unresolved', auth(async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('unresolved_queries')
                .select('*')
                .eq('resolved', false)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return sendJsonResponse(res, 200, data);
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 2. Resolver una duda: Mover a Knowledge Base y marcar como resuelta
    server.post('/bot/resolve', auth(async (req, res) => {
        try {
            const { id, content } = req.body || {};
            if (!id || !content || typeof content !== 'string') {
                return sendJsonResponse(res, 400, { error: 'ID y contenido válido son requeridos' });
            }

            const cleanContent = content.trim();
            console.log(`[RAG Admin] Resolviendo duda ${id} -> Entrenando bot...`);
            const embedding = await getEmbedding(cleanContent);

            const { error: insertError } = await supabase
                .from('knowledge_base')
                .insert({ content: cleanContent, embedding });

            if (insertError) throw insertError;

            const { error: updateError } = await supabase
                .from('unresolved_queries')
                .update({ resolved: true })
                .eq('id', id);

            if (updateError) throw updateError;

            if (typeof writeAudit === 'function') {
                await writeAudit({
                    actorId: req.adminUser?.id || null,
                    actorUsername: req.adminUser?.username || 'admin',
                    action: 'resolve_query',
                    targetType: 'unresolved_query',
                    targetId: String(id),
                    details: { preview: cleanContent.slice(0, 100) }
                });
            }

            return sendJsonResponse(res, 200, { success: true });
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 3. Listar Base de Conocimientos
    server.get('/bot/knowledge', auth(async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('knowledge_base')
                .select('id, content, metadata, created_at')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return sendJsonResponse(res, 200, data);
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 4. Agregar nuevo fragmento con embedding
    server.post('/bot/knowledge', auth(async (req, res) => {
        try {
            const { content, metadata } = req.body || {};
            if (!content || typeof content !== 'string') {
                return sendJsonResponse(res, 400, { error: 'El contenido es requerido' });
            }

            const cleanContent = content.trim();
            console.log(`[RAG Admin] Generando embedding para nuevo fragmento...`);
            const embedding = await getEmbedding(cleanContent);

            const { data, error } = await supabase
                .from('knowledge_base')
                .insert({
                    content: cleanContent,
                    metadata: metadata && typeof metadata === 'object' ? metadata : {},
                    embedding
                })
                .select();

            if (error) throw error;

            if (typeof writeAudit === 'function') {
                await writeAudit({
                    actorId: req.adminUser?.id || null,
                    actorUsername: req.adminUser?.username || 'admin',
                    action: 'create_knowledge',
                    targetType: 'knowledge',
                    targetId: String(data?.[0]?.id || ''),
                    details: { preview: cleanContent.slice(0, 100) }
                });
            }

            return sendJsonResponse(res, 200, { success: true, data: data[0] });
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 5. Actualizar fragmento y su embedding
    server.put('/bot/knowledge/:id', auth(async (req, res) => {
        try {
            const { id } = req.params;
            const { content, metadata } = req.body || {};
            if (!content || typeof content !== 'string') {
                return sendJsonResponse(res, 400, { error: 'El contenido es requerido' });
            }

            const cleanContent = content.trim();
            console.log(`[RAG Admin] Actualizando fragmento ID ${id}...`);
            const embedding = await getEmbedding(cleanContent);

            const { data, error } = await supabase
                .from('knowledge_base')
                .update({
                    content: cleanContent,
                    metadata: metadata && typeof metadata === 'object' ? metadata : {},
                    embedding
                })
                .eq('id', id)
                .select();

            if (error) throw error;

            if (typeof writeAudit === 'function') {
                await writeAudit({
                    actorId: req.adminUser?.id || null,
                    actorUsername: req.adminUser?.username || 'admin',
                    action: 'edit_knowledge',
                    targetType: 'knowledge',
                    targetId: String(id),
                    details: { preview: cleanContent.slice(0, 100) }
                });
            }

            return sendJsonResponse(res, 200, { success: true, data: data[0] });
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 6. Eliminar fragmento
    server.delete('/bot/knowledge/:id', auth(async (req, res) => {
        try {
            const { id } = req.params;
            const { error } = await supabase
                .from('knowledge_base')
                .delete()
                .eq('id', id);

            if (error) throw error;

            if (typeof writeAudit === 'function') {
                await writeAudit({
                    actorId: req.adminUser?.id || null,
                    actorUsername: req.adminUser?.username || 'admin',
                    action: 'delete_knowledge',
                    targetType: 'knowledge',
                    targetId: String(id)
                });
            }

            return sendJsonResponse(res, 200, { success: true, message: 'Fragmento eliminado' });
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));

    // 7. Listar Memoria Semántica (Caché)
    server.get('/bot/cache', auth(async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('semantic_cache')
                .select('id, question, answer, created_at')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return sendJsonResponse(res, 200, data);
        } catch (e) {
            return sendJsonResponse(res, 500, { error: e.message });
        }
    }));

    // 8. Actualizar respuesta en memoria semántica
    server.put('/bot/cache/:id', auth(async (req, res) => {
        try {
            const { id } = req.params;
            const { answer } = req.body || {};
            if (!answer || typeof answer !== 'string') {
                return sendJsonResponse(res, 400, { error: 'La respuesta es requerida' });
            }

            const { error } = await supabase
                .from('semantic_cache')
                .update({ answer: answer.trim() })
                .eq('id', id);

            if (error) throw error;
            return sendJsonResponse(res, 200, { success: true });
        } catch (e) {
            return sendJsonResponse(res, 500, { error: e.message });
        }
    }));

    // 9. Eliminar entrada de memoria semántica (o limpiar todo si id === 'all')
    server.delete('/bot/cache/:id', auth(async (req, res) => {
        try {
            const { id } = req.params;
            if (id === 'all') {
                if (req.adminUser?.role !== 'superadmin') {
                    return sendJsonResponse(res, 403, { error: 'Solo un Super Administrador puede vaciar toda la memoria semántica' });
                }

                const { error } = await supabase
                    .from('semantic_cache')
                    .delete()
                    .neq('id', '00000000-0000-0000-0000-000000000000');

                if (error) throw error;

                if (typeof writeAudit === 'function') {
                    await writeAudit({
                        actorId: req.adminUser?.id || null,
                        actorUsername: req.adminUser?.username || 'admin',
                        action: 'clear_semantic_cache',
                        targetType: 'semantic_cache',
                        targetId: 'all'
                    });
                }

                return sendJsonResponse(res, 200, { success: true, message: 'Memoria limpiada totalmente' });
            }

            const { error } = await supabase
                .from('semantic_cache')
                .delete()
                .eq('id', id);

            if (error) throw error;
            return sendJsonResponse(res, 200, { success: true });
        } catch (e) {
            return sendJsonResponse(res, 500, { error: e.message });
        }
    }));

    // 10. Simulador de Consulta RAG 2.0 (Testing y Diagnóstico en Tiempo Real)
    server.post('/bot/simulate', auth(async (req, res) => {
        try {
            const { query, filter_meta, threshold } = req.body || {};
            if (!query || typeof query !== 'string') {
                return sendJsonResponse(res, 400, { error: 'La consulta (query) es requerida' });
            }

            const embedding = await getEmbedding(query.trim());
            const matchThreshold = threshold !== undefined ? parseFloat(threshold) : 0.45;

            const { data: cacheMatches, error: cacheErr } = await supabase.rpc('match_semantic_cache', {
                query_embedding: embedding,
                match_threshold: 0.90,
            });

            const { data: ragDocuments, error: ragErr } = await supabase.rpc('match_documents_filtered', {
                query_embedding: embedding,
                match_threshold: matchThreshold,
                match_count: 5,
                filter_meta: filter_meta && typeof filter_meta === 'object' ? filter_meta : {}
            });

            if (cacheErr) console.warn('[Simulate] Error cache:', cacheErr.message);
            if (ragErr) console.warn('[Simulate] Error RAG:', ragErr.message);

            return sendJsonResponse(res, 200, {
                query,
                calibrated_threshold: matchThreshold,
                semantic_cache_hit: cacheMatches?.[0] || null,
                rag_matches: ragDocuments || [],
                top_confidence: ragDocuments?.[0]?.similarity || null
            });
        } catch (err) {
            return sendJsonResponse(res, 500, { error: err.message });
        }
    }));
}
