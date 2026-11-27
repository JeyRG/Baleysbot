import axios from 'axios';
import fs from 'fs';
import path from 'path';

const TOKEN_USAGE_PATH = path.join(process.cwd(), 'token_usage.json');
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-120b';

// --- Configuración de Circuit Breaker por Modelo ---
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

const modelCircuits = new Map(); // model -> { failures, openedAt }

export function isCircuitOpen(model) {
    const state = modelCircuits.get(model);
    if (!state || !state.openedAt) return false;
    if (Date.now() - state.openedAt >= CIRCUIT_COOLDOWN_MS) {
        // Half-open: permitir un nuevo intento tras enfriamiento
        state.openedAt = null;
        state.failures = Math.max(0, state.failures - 1);
        return false;
    }
    return true;
}

export function recordModelSuccess(model) {
    modelCircuits.set(model, { failures: 0, openedAt: null });
}

export function recordModelFailure(model) {
    const state = modelCircuits.get(model) || { failures: 0, openedAt: null };
    state.failures += 1;
    if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
        state.openedAt = Date.now();
        console.warn(`[Grok CircuitBreaker] ⚡ Circuito ABIERTO para ${model} durante ${CIRCUIT_COOLDOWN_MS / 1000}s tras ${state.failures} fallos seguidos.`);
    }
    modelCircuits.set(model, state);
}

export function resetCircuitsForTest() {
    modelCircuits.clear();
}

// --- Contabilidad de Tokens en Memoria con Flush Asíncrono ---
let tokenStoreCache = null;
let tokenFlushTimer = null;
let tokenDirty = false;

function ensureTokenStore() {
    if (tokenStoreCache) return tokenStoreCache;
    try {
        if (fs.existsSync(TOKEN_USAGE_PATH)) {
            tokenStoreCache = JSON.parse(fs.readFileSync(TOKEN_USAGE_PATH, 'utf8'));
            return tokenStoreCache;
        }
    } catch (error) {
        console.error('[Grok] Error leyendo token_usage.json:', error.message);
    }
    tokenStoreCache = {
        total: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 },
        days: {}
    };
    return tokenStoreCache;
}

function scheduleTokenFlush() {
    tokenDirty = true;
    if (tokenFlushTimer) return;
    tokenFlushTimer = setTimeout(async () => {
        tokenFlushTimer = null;
        if (!tokenDirty || !tokenStoreCache) return;
        tokenDirty = false;
        try {
            await fs.promises.writeFile(TOKEN_USAGE_PATH, JSON.stringify(tokenStoreCache, null, 2), 'utf8');
        } catch (error) {
            console.error('[Grok] Error guardando token_usage.json:', error.message);
        }
    }, 1500);
    tokenFlushTimer.unref?.();
}

export function flushTokenUsageSync() {
    if (!tokenDirty || !tokenStoreCache) return;
    try {
        if (tokenFlushTimer) {
            clearTimeout(tokenFlushTimer);
            tokenFlushTimer = null;
        }
        fs.writeFileSync(TOKEN_USAGE_PATH, JSON.stringify(tokenStoreCache, null, 2), 'utf8');
        tokenDirty = false;
    } catch (error) {
        console.error('[Grok] Error en flush síncrono de token_usage.json:', error.message);
    }
}

function recordTokenUsage(usage, model) {
    if (!usage) return;

    const today = new Date().toISOString().split('T')[0];
    const store = ensureTokenStore();
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

    scheduleTokenFlush();
    console.log(`[Grok] Tokens usados (${model}) -> prompt: ${usage.prompt_tokens || 0}, completion: ${usage.completion_tokens || 0}, total: ${usage.total_tokens || 0}`);
}

export function getTokenUsageSummary() {
    return ensureTokenStore();
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
    const apiKey = options.apiKey || process.env.GROQ_API_KEY;
    const httpPost = options._httpPost || axios.post;
    const payload = {
        model: targetModel,
        messages: compactMessages(messages),
        temperature: options.temperature ?? 0.2,
        max_tokens: Math.min(options.maxTokens ?? 600, 1024),
    };

    if (process.env.DEBUG_GROQ_PAYLOAD === 'true') {
        fs.promises.writeFile('last_payload.json', JSON.stringify(payload, null, 2), 'utf8').catch(() => {});
    }

    const response = await httpPost(
        'https://api.groq.com/openai/v1/chat/completions',
        payload,
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
        }
    );

    if (response.data?.usage) {
        recordTokenUsage(response.data.usage, payload.model);
    }
    return response.data;
}

export async function getGrokCompletion(messages, options = {}) {
    const apiKey = options.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.error('[Grok] GROQ_API_KEY no está definido');
        throw new Error('GROQ_API_KEY no está definido');
    }

    const primaryModel = options.model || DEFAULT_MODEL;
    const fallbackModel = options.fallbackModel || FALLBACK_MODEL;
    const candidates = primaryModel === fallbackModel
        ? [primaryModel]
        : [primaryModel, fallbackModel];

    let lastError = null;

    for (const candidateModel of candidates) {
        if (isCircuitOpen(candidateModel)) {
            console.warn(`[Grok] Saltando modelo ${candidateModel} (Circuito abierto).`);
            continue;
        }

        try {
            console.log(`[Grok] Consultando modelo: ${candidateModel}`);
            const data = await executeGroqRequest(candidateModel, messages, options);
            recordModelSuccess(candidateModel);
            return data;
        } catch (err) {
            recordModelFailure(candidateModel);
            lastError = err;
            console.warn(`[Grok] ⚠️ Fallo en ${candidateModel}:`, err.response?.data?.error?.message || err.message);
        }
    }

    throw lastError || new Error('Circuitos de inferencia Groq temporalmente abiertos por fallos recientes');
}
