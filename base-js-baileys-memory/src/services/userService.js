import fs from 'fs';
import path from 'path';

const USER_DATA_PATH = path.join(process.cwd(), 'user_data.json');
const COUNTER_PATH = path.join(process.cwd(), 'leads_counter.json');

let usersCache = null;
let flushTimer = null;
let isDirty = false;

function ensureLoaded() {
    if (usersCache !== null) return usersCache;
    try {
        if (fs.existsSync(USER_DATA_PATH)) {
            usersCache = JSON.parse(fs.readFileSync(USER_DATA_PATH, 'utf8')) || {};
        } else {
            usersCache = {};
        }
    } catch (e) {
        console.error('[UserService] Error inicializando user_data.json:', e.message);
        usersCache = {};
    }
    return usersCache;
}

function scheduleAsyncFlush() {
    isDirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(async () => {
        flushTimer = null;
        if (!isDirty || !usersCache) return;
        isDirty = false;
        try {
            const payload = JSON.stringify(usersCache, null, 2);
            await fs.promises.writeFile(USER_DATA_PATH, payload, 'utf8');
        } catch (e) {
            console.error('[UserService] Error en persistencia asíncrona de user_data:', e.message);
        }
    }, 800);
    flushTimer.unref?.();
}

export const flushUsersSync = () => {
    if (!isDirty || !usersCache) return;
    try {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        fs.writeFileSync(USER_DATA_PATH, JSON.stringify(usersCache, null, 2), 'utf8');
        isDirty = false;
    } catch (e) {
        console.error('[UserService] Error en flush síncrono de cierre:', e.message);
    }
};

export const loadUsers = () => ensureLoaded();

export const saveUser = (id, data) => {
    const store = ensureLoaded();
    store[id] = { ...(store[id] || {}), ...data };
    scheduleAsyncFlush();
};

export const loadUserData = (id) => {
    const store = ensureLoaded();
    return store[id] ? { ...store[id] } : {};
};

export const resetUserData = (id) => {
    const store = ensureLoaded();
    delete store[id];
    scheduleAsyncFlush();
};

// Contador local de respaldo (usado solo si outbound_lead_queue en Supabase no está accesible)
let counterCache = null;

export const getLeadsCounter = () => {
    const today = new Date().toISOString().split('T')[0];
    if (counterCache && counterCache.date === today) {
        return { ...counterCache };
    }
    try {
        if (fs.existsSync(COUNTER_PATH)) {
            const data = JSON.parse(fs.readFileSync(COUNTER_PATH, 'utf8'));
            if (data.date === today) {
                counterCache = data;
                return { ...counterCache };
            }
        }
    } catch {
        // Ignorar archivo corrupto y reiniciar contador del día
    }
    counterCache = { date: today, count: 0 };
    return { ...counterCache };
};

export const incrementLeadsCounter = (limit = 50) => {
    const current = getLeadsCounter();
    if (current.count >= limit) return -1;
    current.count += 1;
    counterCache = current;
    fs.promises.writeFile(COUNTER_PATH, JSON.stringify(current), 'utf8').catch((err) => {
        console.warn('[UserService] Advertencia guardando leads_counter:', err.message);
    });
    return current.count;
};
