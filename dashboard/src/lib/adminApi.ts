// Cliente para hablar con el backend del bot (autenticación y admin).
// El token de sesión se guarda en cookies y se envía como Bearer.

const BOT_URL = process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';

export interface AdminUser {
    id: string;
    username: string;
    full_name: string | null;
    role: 'superadmin' | 'agent';
    active: boolean;
    last_login_at: string | null;
    created_at: string;
}

function getToken(): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

export function setSession(token: string, user: AdminUser) {
    const maxAge = 60 * 60 * 48; // 48h
    document.cookie = `admin_token=${encodeURIComponent(token)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    document.cookie = `admin_user=${encodeURIComponent(JSON.stringify(user))}; path=/; max-age=${maxAge}; SameSite=Lax`;
    document.cookie = `auth_token=valid; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function clearSession() {
    document.cookie = 'admin_token=; path=/; max-age=0';
    document.cookie = 'admin_user=; path=/; max-age=0';
    document.cookie = 'auth_token=; path=/; max-age=0';
}

export function getUser(): AdminUser | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(/(?:^|;\s*)admin_user=([^;]+)/);
    if (!match) return null;
    try {
        return JSON.parse(decodeURIComponent(match[1]));
    } catch {
        return null;
    }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = getToken();
    const res = await fetch(`${BOT_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        },
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* respuesta vacía */ }
    if (!res.ok && data?.error) {
        throw new Error(data.error);
    }
    return data as T;
}

export const adminApi = {
    login: (username: string, password: string) =>
        request<{ ok: boolean; token?: string; user?: AdminUser; error?: string; status?: number }>(
            '/admin/login',
            { method: 'POST', body: JSON.stringify({ username, password }) }
        ),

    logout: () => request<{ ok: boolean }>('/admin/logout', { method: 'POST' }),

    me: () => request<{ ok: boolean; user?: AdminUser }>('/admin/me'),

    listUsers: () => request<{ ok: boolean; users?: AdminUser[]; error?: string; status?: number }>('/admin/users'),

    createUser: (payload: { username: string; password: string; full_name?: string; role?: string }) =>
        request<{ ok: boolean; user?: AdminUser; error?: string; status?: number }>(
            '/admin/users',
            { method: 'POST', body: JSON.stringify(payload) }
        ),

    updateUser: (id: string, payload: { full_name?: string; role?: string; active?: boolean; password?: string }) =>
        request<{ ok: boolean; user?: AdminUser; error?: string; status?: number }>(
            `/admin/users/${id}`,
            { method: 'PUT', body: JSON.stringify(payload) }
        ),

    deleteUser: (id: string) =>
        request<{ ok: boolean; error?: string; status?: number }>(`/admin/users/${id}`, { method: 'DELETE' }),

    audit: (limit = 200) =>
        request<{ ok: boolean; logs?: any[]; error?: string }>(`/admin/audit?limit=${limit}`),

    agentStats: () =>
        request<{ ok: boolean; rows?: any[]; error?: string }>('/admin/agent-stats'),
};
