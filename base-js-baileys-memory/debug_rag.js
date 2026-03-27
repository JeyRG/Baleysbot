import 'dotenv/config'
import { getEmbedding } from './src/services/embeddingService.js'
import { getRAGContext } from './src/services/knowledgeService.js'

async function debugRAG() {
    const query = "cuanto es el costo de la maestría";
    console.log(`🔍 Probando RAG para: "${query}"`);
    
    try {
        const embedding = await getEmbedding(query);
        console.log('✅ Embedding generado.');
        
        // Probar con diferentes umbrales
        const thresholds = [0.75, 0.6, 0.5, 0.4];
        
        for (const t of thresholds) {
            console.log(`\n--- Probando con umbral: ${t} ---`);
            const context = await getRAGContext(embedding, t);
            if (context) {
                console.log('📄 Contexto encontrado:');
                console.log(context);
            } else {
                console.log('❌ No se encontró nada.');
            }
        }
        
    } catch (e) {
        console.error('❌ Error:', e.message);
    }
}

debugRAG();
