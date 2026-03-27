import 'dotenv/config'
import fs from 'fs'
import { getEmbedding } from './src/services/embeddingService.js'
import { getRAGContext } from './src/services/knowledgeService.js'
import { getGrokCompletion } from './src/grokClient.js'

async function simulateBotResponse() {
    const userName = "Jeyson";
    const userMessage = "cuanto es el costo de las maestrías";

    console.log(`💬 USUARIO: "${userMessage}"`);
    console.log('---');

    try {
        // 1. Generar Vector
        const vector = await getEmbedding(userMessage);

        // 2. Recuperar Contexto RAG
        console.log('🔍 Buscando en la base de conocimientos...');
        const ragContext = await getRAGContext(vector);

        if (ragContext) {
            console.log('✅ Conocimiento encontrado:');
            console.log(ragContext);
        } else {
            console.warn('⚠️ No se encontró conocimiento específico.');
        }

        // 3. Preparar Prompt para Grok
        const systemPrompt = `Usa EXCLUSIVAMENTE el siguiente contexto para responder al usuario.
Contexto: ${ragContext || 'No hay información.'}`;

        const messages = [
            {
                role: 'user',
                content: `Eres el Asesor de Posgrado UNAC. Usa el contexto para responder.\n\nCONTEXTO:\n${ragContext}\n\nPREGUNTA: ${userMessage}`
            }
        ];

        // 4. Llamar a Grok
        console.log('🤖 Consultando a la IA (Grok)...');
        const grokResponse = await getGrokCompletion(messages);
        const finalAnswer = grokResponse.choices?.[0]?.message?.content;

        console.log('\n--- 🤖 RESPUESTA DEL BOT ---');
        console.log(finalAnswer);
        console.log('---------------------------');

        // Guardar resultado para inspección
        fs.writeFileSync('test_result.txt', `USUARIO: ${userMessage}\n\n🤖 BOT:\n${finalAnswer}`, 'utf8');
        console.log('📝 Resultado guardado en test_result.txt');

    } catch (e) {
        console.error('❌ ERROR DURANTE LA PRUEBA:', e.message);
    }
}

simulateBotResponse();
