import axios from 'axios';
import fs from 'fs';
import path from 'path';

const apiKey = process.env.GROQ_API_KEY;
const TOKEN_USAGE_PATH = path.join(process.cwd(), 'token_usage.json');
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-120b';

function readTokenUsageFile() {
    try {
        if (!fs.existsSync(TOKEN_USAGE_PATH)) {
            return { total: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 }, days: {} };
        }
        return JSON.parse(fs.readFileSync(TOKEN_USAGE_PATH, 'utf8'));
    } catch (error) {
        console.error('[Grok] Error leyendo token_usage.json:', error);
        return { total: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 }, days: {} };
    }
}

function writeTokenUsageFile(data) {
    try {
        fs.writeFileSync(TOKEN_USAGE_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('[Grok] Error guardando token_usage.json:', error);
    }
}

function recordTokenUsage(usage, model) {
    if (!usage) return;

    const today = new Date().toISOString().split('T')[0];
    const store = readTokenUsageFile();
    const day = store.days[today] || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, models: {} };

    day.prompt_tokens += usage.prompt_tokens || 0;
    day.completion_tokens += usage.completion_tokens || 0;
    day.total_tokens += usage.total_tokens || 0;
    day.requests += 1;
    if (model) {
        day.models[model] = (day.models[model] || 0) + 1;
    }

    store.days[today] = day;
    store.total.prompt_tokens += usage.prompt_tokens || 0;
    store.total.completion_tokens += usage.completion_tokens || 0;
    store.total.total_tokens += usage.total_tokens || 0;
    store.total.requests += 1;

    writeTokenUsageFile(store);
    console.log(`[Grok] Tokens usados -> prompt: ${usage.prompt_tokens || 0}, completion: ${usage.completion_tokens || 0}, total: ${usage.total_tokens || 0}`);
}

export function getTokenUsageSummary() {
    return readTokenUsageFile();
}

function compactMessages(messages) {
    return messages.map(message => ({
        ...message,
        content: typeof message.content === 'string'
            ? message.content.replace(/\s+/g, ' ').trim()
            : message.content,
    }));
}

async function executeGroqRequest(targetModel, messages, options = {}) {
    const payload = {
        model: targetModel,
        messages: compactMessages(messages),
        temperature: options.temperature ?? 0.2,
        max_tokens: Math.min(options.maxTokens ?? 180, 250),
    };
    fs.writeFileSync('last_payload.json', JSON.stringify(payload, null, 2), 'utf8');
    const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        payload,
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        }
    );
    if (response.data?.usage) {
        recordTokenUsage(response.data.usage, payload.model);
    }
    return response.data;
}

export async function getGrokCompletion(messages, options = {}) {
    if (!apiKey) {
        console.error('[Grok] GROQ_API_KEY no está definido');
        throw new Error('GROQ_API_KEY no está definido');
    }

    const primaryModel = options.model || DEFAULT_MODEL;

    try {
        console.log(`[Grok] Consultando modelo primario: ${primaryModel}`);
        const data = await executeGroqRequest(primaryModel, messages, options);
        console.log('[Grok] Respuesta recibida con éxito');
        return data;
    } catch (primaryError) {
        console.warn(`[Grok] ⚠️ Fallo en modelo primario (${primaryModel}):`, primaryError.response?.data?.error?.message || primaryError.message);
        
        // Si falló el primario y no es ya el fallback, intentar fallback automático
        if (primaryModel !== FALLBACK_MODEL) {
            try {
                console.log(`[Grok] 🔄 Intentando fallback con modelo secundario: ${FALLBACK_MODEL}`);
                const fallbackData = await executeGroqRequest(FALLBACK_MODEL, messages, options);
                console.log('[Grok] ✅ Fallback completado exitosamente con:', FALLBACK_MODEL);
                return fallbackData;
            } catch (fallbackError) {
                console.error(`[Grok] ❌ Fallback (${FALLBACK_MODEL}) también falló:`, fallbackError.response?.data?.error?.message || fallbackError.message);
                throw fallbackError;
            }
        }
        throw primaryError;
    }
}
