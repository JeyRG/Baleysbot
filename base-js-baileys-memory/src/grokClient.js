import axios from 'axios';

const apiKey = process.env.GROQ_API_KEY;

export async function getGrokCompletion(messages) {
    console.log('[Grok] Enviando mensajes a Grok:', JSON.stringify(messages));
    try {
        if (!apiKey) {
            console.error('[Grok] GROQ_API_KEY no está definido');
            throw new Error('GROQ_API_KEY no está definido');
        }
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages,
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log('[Grok] Respuesta recibida:', JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        console.error('[Grok] Error al consultar Grok:', error);
        throw error;
    }
}
