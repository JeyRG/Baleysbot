import { pipeline } from '@xenova/transformers'

let extractor = null

/**
 * Genera un embedding de 384 dimensiones usando all-MiniLM-L6-v2 localmente.
 * @param {string} text - El texto a convertir en vector.
 * @returns {Promise<number[]>} - El vector del embedding.
 */
export async function getEmbedding(text) {
    try {
        if (!extractor) {
            console.log('[Embedding] Cargando modelo local (solo la primera vez)...')
            extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
        }

        const output = await extractor(text, { pooling: 'mean', normalize: true })
        // Convertir el Tensor a un array plano de JavaScript
        return Array.from(output.data)
    } catch (error) {
        console.error('[Embedding] Error al generar vector local:', error.message)
        throw error
    }
}
