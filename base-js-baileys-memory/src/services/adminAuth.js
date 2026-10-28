import crypto from 'crypto';
import { supabase } from './supabaseClient.js';

// ---------------------------------------------------------------------------
// Servicio de cuentas del panel (superadmin + agentes)
// Usa la service key del bot (bypass RLS). El navegador nunca ve los hashes.
// ---------------------------------------------------------------------------

// Hash de contraseña con scrypt (nativo de Node, sin dependencias).
// Formato almacenado: "scrypt$N$saltHex$hashHex"
const SCRYPT_N = 16384;

export function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(String(password), salt, 64, { N: SCRYPT_N });
    return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
    try {
        const [algo, nStr, saltHex, hashHex] = String(stored).split('$');
        if (algo !== 'scrypt') return false;
        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(hashHex, 'hex');
        const derived = crypto.scryptSync(String(password), salt, expected.length, { N: Number(nStr) });
        return crypto.timingSafeEqual(derived, expected);
    } catch (e) {
        return false;
    }
}

function newToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Nunca exponer el hash
function sanitizeUser(u) {
    const { password_hash, ...rest } = u;
    return rest;
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------
export async function writeAudit({ actorId, actorUsername, action, targetType = null, targetId = null, details = {} }) {
    try {
        await supabase.from('audit_log').insert({
            actor_id: actorId || null,
            actor_username: actorUsername || null,
            action,
            target_type: targetType,
            target_id: targetId != null ? String(targetId) : null,
            details,
        });
    } catch (e) {
        console.error('[Audit] Error escribiendo auditoría:', e.message);
    }
}

// ---------------------------------------------------------------------------
// Login / Sesiones
// ---------------------------------------------------------------------------
export async function login(username, password, { ip = null } = {}) {
    const { data: user, error } = await supabase
        .from('admin_users')
        .select('*')
        .eq('username', username)
        .single();

    if (error || !user) {
        await writeAudit({ actorUsername: username, action: 'login_failed', details: { reason: 'usuario_no_existe', ip } });
        return { ok: false, status: 401, error: 'Credenciales inválidas' };
    }
    if (!user.active) {
        await writeAudit({ actorId: user.id, actorUsername: user.username, action: 'login_failed', details: { reason: 'inactivo', ip } });
        return { ok: false, status: 403, error: 'Cuenta desactivada' };
    }
    if (!verifyPassword(password, user.password_hash)) {
        await writeAudit({ actorId: user.id, actorUsername: user.username, action: 'login_failed', details: { reason: 'password_invalida', ip } });
        return { ok: false, status: 401, error: 'Credenciales inválidas' };
    }

    // Crear sesión (48 horas)
    const token = newToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { error: sessErr } = await supabase.from('admin_sessions').insert({
        token,
        user_id: user.id,
        expires_at: expiresAt,
    });
    if (sessErr) {
        return { ok: false, status: 500, error: 'No se pudo crear la sesión' };
    }

    await supabase.from('admin_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
    await writeAudit({ actorId: user.id, actorUsername: user.username, action: 'login', details: { ip } });

    return { ok: true, token, user: sanitizeUser(user) };
}

// Valida un token de sesión; devuelve el usuario o null
export async function verifyToken(token) {
    if (!token) return null;
    const { data: sess } = await supabase
        .from('admin_sessions')
        .select('user_id, expires_at')
        .eq('token', token)
        .single();
    if (!sess) return null;
    if (new Date(sess.expires_at).getTime() < Date.now()) {
        await supabase.from('admin_sessions').delete().eq('token', token);
        return null;
    }
    const { data: user } = await supabase.from('admin_users').select('*').eq('id', sess.user_id).single();
    if (!user || !user.active) return null;
    return sanitizeUser(user);
}

export async function logout(token) {
    if (!token) return;
    const user = await verifyToken(token);
    if (user) await writeAudit({ actorId: user.id, actorUsername: user.username, action: 'logout' });
    await supabase.from('admin_sessions').delete().eq('token', token);
}

// ---------------------------------------------------------------------------
// CRUD de usuarios (protegido: requiere sesión válida)
// ---------------------------------------------------------------------------
async function requireActor(token) {
    return verifyToken(token); // null si no válido
}

export async function listUsers(token) {
    const actor = await requireActor(token);
    if (!actor) return { ok: false, status: 401, error: 'No autorizado' };
    const { data, error } = await supabase
        .from('admin_users')
        .select('id, username, full_name, role, active, last_login_at, created_at, updated_at')
        .order('created_at', { ascending: true });
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, users: data };
}

export async function createUser(token, { username, password, full_name, role }) {
    const actor = await requireActor(token);
    if (!actor) return { ok: false, status: 401, error: 'No autorizado' };
    if (actor.role !== 'superadmin') return { ok: false, status: 403, error: 'Solo el superadmin puede crear cuentas' };
    if (!username || !password) return { ok: false, status: 400, error: 'Usuario y contraseña son requeridos' };
    if (String(password).length < 6) return { ok: false, status: 400, error: 'La contraseña debe tener al menos 6 caracteres' };
    const finalRole = role === 'superadmin' ? 'superadmin' : 'agent';

    const { data, error } = await supabase
        .from('admin_users')
        .insert({ username, password_hash: hashPassword(password), full_name: full_name || null, role: finalRole })
        .select('id, username, full_name, role, active, created_at')
        .single();
    if (error) {
        const msg = /duplicate|unique/i.test(error.message) ? 'Ese usuario ya existe' : error.message;
        return { ok: false, status: 400, error: msg };
    }
    await writeAudit({ actorId: actor.id, actorUsername: actor.username, action: 'create_user', targetType: 'user', targetId: data.id, details: { username, role: finalRole } });
    return { ok: true, user: data };
}

export async function updateUser(token, id, { full_name, role, active, password }) {
    const actor = await requireActor(token);
    if (!actor) return { ok: false, status: 401, error: 'No autorizado' };
    if (actor.role !== 'superadmin') return { ok: false, status: 403, error: 'Solo el superadmin puede modificar cuentas' };

    const patch = {};
    if (full_name !== undefined) patch.full_name = full_name;
    if (role !== undefined) patch.role = role === 'superadmin' ? 'superadmin' : 'agent';
    if (active !== undefined) patch.active = !!active;
    if (password) {
        if (String(password).length < 6) return { ok: false, status: 400, error: 'La contraseña debe tener al menos 6 caracteres' };
        patch.password_hash = hashPassword(password);
    }

    // Evitar que el superadmin se desactive a sí mismo
    if (actor.id === id && patch.active === false) {
        return { ok: false, status: 400, error: 'No puedes desactivarte a ti mismo' };
    }

    const { data, error } = await supabase
        .from('admin_users')
        .update(patch)
        .eq('id', id)
        .select('id, username, full_name, role, active')
        .single();
    if (error) return { ok: false, status: 500, error: error.message };

    // Si se cambió la contraseña o se desactivó, cerrar sus sesiones
    if (patch.password_hash || patch.active === false) {
        await supabase.from('admin_sessions').delete().eq('user_id', id);
    }
    await writeAudit({ actorId: actor.id, actorUsername: actor.username, action: 'update_user', targetType: 'user', targetId: id, details: { changed: Object.keys(patch).map(k => k === 'password_hash' ? 'password' : k) } });
    return { ok: true, user: data };
}

export async function deleteUser(token, id) {
    const actor = await requireActor(token);
    if (!actor) return { ok: false, status: 401, error: 'No autorizado' };
    if (actor.role !== 'superadmin') return { ok: false, status: 403, error: 'Solo el superadmin puede eliminar cuentas' };
    if (actor.id === id) return { ok: false, status: 400, error: 'No puedes eliminarte a ti mismo' };

    const { error } = await supabase.from('admin_users').delete().eq('id', id);
    if (error) return { ok: false, status: 500, error: error.message };
    await supabase.from('admin_sessions').delete().eq('user_id', id);
    await writeAudit({ actorId: actor.id, actorUsername: actor.username, action: 'delete_user', targetType: 'user', targetId: id });
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Reportes: auditoría y métricas por día/agente
// ---------------------------------------------------------------------------
export async function getAudit(token, { limit = 100 } = {}) {
    const actor = await requireActor(token);
    if (!actor) return { ok: false, status: 401, error: 'No autorizado' };
    const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(Math.min(Number(limit) || 100, 500));
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, logs: data };
}

export async function getAgentStats(token) {
    const actor = await requireActor(token);
    if (!actor) return { ok: false, status: 401, error: 'No autorizado' };
    const { data, error } = await supabase
        .from('agent_daily_stats')
        .select('*')
        .order('day', { ascending: false })
        .limit(500);
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, rows: data };
}

