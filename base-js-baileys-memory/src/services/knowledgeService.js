import { supabase } from './supabaseClient.js'

/**
 * Servicio para consultar la base de conocimientos (RAG) en Supabase.
 */

/**
 * Busca fragmentos de conocimiento relevantes en Supabase basados en un embedding.
 * @param {number[]} embedding - El vector del mensaje del usuario.
 * @param {number} threshold - Umbral de similitud (0 a 1).
 * @param {number} count - Cantidad de fragmentos a recuperar.
 * @returns {Promise<string>} - Texto con el contexto recuperado.
 */
export async function getRAGContext(embedding, threshold = 0.3, count = 3) {
    try {
        const { data, error } = await supabase.rpc('match_documents', {
            query_embedding: embedding,
            match_threshold: threshold,
            match_count: count,
        });

        if (error) {
            console.error('[KnowledgeService] Error RPC match_documents:', error);
            return "";
        }

        if (!data || data.length === 0) return "";

        // Unir los fragmentos encontrados en un solo bloque de texto
        return "Información adicional encontrada:\n" + data.map(d => `- ${d.content}`).join('\n');
    } catch (e) {
        console.error('[KnowledgeService] Error al obtener RAG:', e);
        return "";
    }
}
