import { supabase } from './supabaseClient.js';

// --- 1. Rate Limiting con limpieza automática de memoria ---
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 30_000;
const MAX_MESSAGES_PER_WINDOW = 5;

export function checkRateLimit(userId) {
    const now = Date.now();
    const userLimit = rateLimits.get(userId) || { count: 0, startTime: now, warned: false };

    if (now - userLimit.startTime > RATE_LIMIT_WINDOW_MS) {
        userLimit.count = 1;
        userLimit.startTime = now;
        userLimit.warned = false;
    } else {
        userLimit.count += 1;
    }

    rateLimits.set(userId, userLimit);

    if (userLimit.count > MAX_MESSAGES_PER_WINDOW) {
        const shouldWarn = !userLimit.warned;
        userLimit.warned = true;
        return { isSpam: true, shouldWarn };
    }
    return { isSpam: false, shouldWarn: false };
}

export function resetRateLimitsForTest() {
    rateLimits.clear();
}

// --- 2. Caché corto + Fail-Safe para Control de Handover Humano ---
const handoffCache = new Map(); // waId -> { status, expiresAt, lastKnownStatus }
const HANDOFF_CACHE_TTL_MS = 4_000;

export function normalizeWaId(waId = '') {
    return String(waId).includes('@') ? String(waId).split('@')[0] : String(waId).trim();
}

export function setConversationStatusCache(waId, status) {
    const cleanId = normalizeWaId(waId);
    if (!cleanId) return;
    handoffCache.set(cleanId, {
        status,
        lastKnownStatus: status,
        expiresAt: Date.now() + HANDOFF_CACHE_TTL_MS
    });
}

export async function isConversationHumanActive(waId, dbClient = supabase) {
    const cleanId = normalizeWaId(waId);
    if (!cleanId) return false;

    const now = Date.now();
    const cached = handoffCache.get(cleanId);
    if (cached && cached.expiresAt > now) {
        return cached.status === 'human_active';
    }

    try {
        const { data, error } = await dbClient
            .from('conversations')
            .select('status')
            .eq('wa_id', cleanId)
            .maybeSingle();

        if (error) {
            console.warn(`[HandoffGuard] Error consultando Supabase para ${cleanId}: ${error.message}`);
            // Fail-safe: si el último estado conocido era human_active, bloquear respuesta automática;
            // si además el error es crítico y no conocemos el estado, evitar pisar una posible conversación activa
            if (cached?.lastKnownStatus === 'human_active') return true;
            return true;
        }

        const currentStatus = data?.status || 'bot';
        handoffCache.set(cleanId, {
            status: currentStatus,
            lastKnownStatus: currentStatus,
            expiresAt: now + HANDOFF_CACHE_TTL_MS
        });
        return currentStatus === 'human_active';
    } catch (err) {
        console.warn(`[HandoffGuard] Excepción de red verificando handoff para ${cleanId}:`, err.message);
        return true; // Fail-closed: nunca interrumpir ante caída de base de datos
    }
}

/**
 * Guarda unificada para todos los flujos automáticos (welcomeFlow y flujos satélite).
 * Devuelve true si el flujo debe detenerse inmediatamente.
 */
export async function shouldBlockAutomatedFlow(userId, flowDynamic, dbClient = supabase) {
    const rateResult = checkRateLimit(userId);
    if (rateResult.isSpam) {
        if (rateResult.shouldWarn && typeof flowDynamic === 'function') {
            await flowDynamic('⚠️ *Por favor, no envíes mensajes tan rápido.* Espera unos segundos e intenta nuevamente.');
        }
        return { blocked: true, reason: 'rate_limit' };
    }

    const humanActive = await isConversationHumanActive(userId, dbClient);
    if (humanActive) {
        console.log(`[HandoffGuard] Modo Manual activo (o protección fail-safe) para ${userId}. Silenciando flujo automático.`);
        return { blocked: true, reason: 'human_active' };
    }

    return { blocked: false, reason: null };
}

// --- 3. Validador estricto de nombres reales (evita guardar preguntas como nombre) ---
const NON_NAME_WORDS = new Set([
    'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'inicio', 'comenzar', 'menu',
    'quiero', 'quisiera', 'necesito', 'deseo', 'solicito', 'puedo', 'podria', 'saber',
    'informacion', 'info', 'precio', 'precios', 'costo', 'costos', 'cuanto', 'cuesta',
    'cuando', 'donde', 'como', 'cual', 'cuales', 'que', 'quien', 'requisitos', 'requisito',
    'maestria', 'maestrias', 'doctorado', 'doctorados', 'especialidad', 'especialidades',
    'posgrado', 'programa', 'programas', 'inscripcion', 'inscribirme', 'admision', 'examen',
    'expediente', 'matricula', 'horario', 'horarios', 'modalidad', 'virtual', 'presencial',
    'beca', 'descuento', 'banco', 'scotiabank', 'cuenta', 'asesor', 'humano', 'ayuda',
    'postulante', 'estudiante', 'egresado', 'gracias', 'porfavor', 'favor', 'consulta', 'duda'
]);

export function isValidHumanName(rawText) {
    if (!rawText || typeof rawText !== 'string') return false;
    const trimmed = rawText.trim();
    if (trimmed.length < 3 || trimmed.length > 60) return false;
    if (/[0-9?¿!¡@#$%^&*()_=+[\]{};:"\\|<>\/]/.test(trimmed)) return false;

    if (!/^[a-záéíóúñüA-ZÁÉÍÓÚÑÜ\s'.-]+$/.test(trimmed)) return false;

    const normalized = trimmed
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z\s]/g, ' ')
        .trim();

    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 6) return false;

    if (words.some(w => NON_NAME_WORDS.has(w))) return false;
    return true;
}

// --- 4. Ventana deslizante de memoria conversacional corta (para contexto en Groq) ---
const conversationMemory = new Map(); // waId -> { turns: [{ role, content }], updatedAt }
const MAX_MEMORY_TURNS = 4; // 2 intercambios recientes (user + assistant)
const MEMORY_TTL_MS = 30 * 60_000; // 30 minutos

export function appendConversationTurn(waId, role, content) {
    const cleanId = normalizeWaId(waId);
    if (!cleanId || !content || typeof content !== 'string') return;

    const now = Date.now();
    const existing = conversationMemory.get(cleanId);
    const turns = existing && (now - existing.updatedAt <= MEMORY_TTL_MS)
        ? [...existing.turns]
        : [];

    turns.push({ role, content: content.trim().slice(0, 450) });
    while (turns.length > MAX_MEMORY_TURNS) {
        turns.shift();
    }

    conversationMemory.set(cleanId, { turns, updatedAt: now });
}

export function getRecentConversationTurns(waId) {
    const cleanId = normalizeWaId(waId);
    const entry = conversationMemory.get(cleanId);
    if (!entry) return [];
    if (Date.now() - entry.updatedAt > MEMORY_TTL_MS) {
        conversationMemory.delete(cleanId);
        return [];
    }
    return [...entry.turns];
}

export function clearConversationMemory(waId) {
    conversationMemory.delete(normalizeWaId(waId));
}

// Limpieza periódica de mapas en memoria (evita memory leaks)
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimits) {
        if (now - v.startTime > RATE_LIMIT_WINDOW_MS * 2) rateLimits.delete(k);
    }
    for (const [k, v] of handoffCache) {
        if (now - v.expiresAt > 10 * 60_000) handoffCache.delete(k);
    }
    for (const [k, v] of conversationMemory) {
        if (now - v.updatedAt > MEMORY_TTL_MS) conversationMemory.delete(k);
    }
}, 5 * 60_000).unref?.();
