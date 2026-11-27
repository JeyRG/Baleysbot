// Cliente para hablar con el backend del bot (autenticación, configuración y admin).
// El token de sesión se guarda en cookies y se envía como Bearer.

export function getBotUrl(): string {
    if (typeof window !== 'undefined') {
        if (window.location.protocol === 'https:' || window.location.hostname === 'posgradounac.edu.pe') {
            return `${window.location.origin}/chatbot/api`;
        }
        if (window.location.hostname) {
            return `http://${window.location.hostname}:3000`;
        }
    }
    return process.env.NEXT_PUBLIC_BOT_URL || 'http://localhost:3000';
}

export interface AdminUser {
    id: string;
    username: string;
    full_name: string | null;
    role: 'superadmin' | 'agent';
    active: boolean;
    last_login_at: string | null;
    created_at: string;
}

export interface BotSettings {
    admision: {
        proceso_actual: string;
        cierre_inscripciones: string;
        fecha_examen: string;
        fecha_entrevistas: string;
        inicio_clases: string;
        nota_evaluacion: string;
    };
    pagos: {
        banco: string;
        cuenta_general: string;
        cci_general: string;
        cuenta_especialidad: string;
        cci_especialidad: string;
        inscripcion_maestria: string;
        matricula_maestria: string;
        semestre_maestria: string;
        duracion_maestria: string;
        inscripcion_doctorado: string;
        matricula_doctorado: string;
        semestre_doctorado: string;
        duracion_doctorado: string;
        inscripcion_especialidad: string;
        matricula_especialidad: string;
        semestre_especialidad: string;
        duracion_especialidad: string;
    };
    modalidad_atencion: {
        modalidad_titulo: string;
        modalidad_resumen: string;
        horario_ged: string;
        telefono_soporte: string;
        limite_leads_diario: number;
    };
    enlaces: {
        whatsapp_admision_general: string;
        portal_inscripcion: string;
        portal_ged: string;
        portal_ged_login: string;
        portal_requisitos: string;
        portal_sga: string;
    };
    mensaje_api: {
        saludo_bienvenida: string;
        titulo_detalles: string;
        requisitos_texto: string;
        aviso_brochure: string;
        aviso_sin_brochure: string;
        pasos_inscripcion: string;
    };
}

export interface BotSettingsResponse {
    ok: boolean;
    settings: BotSettings;
    defaults?: BotSettings;
    meta?: {
        updated_at: string | null;
        updated_by_name: string | null;
        source: string;
    };
    catalog_summary?: {
        faculties: number;
        maestrias: number;
        doctorados: number;
        especialidades: number;
        total_programs: number;
        with_brochure: number;
    };
    persisted_in_db?: boolean;
    warning?: string | null;
    error?: string;
}

export function getToken(): string | null {
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

/**
 * Wrapper de fetch que inyecta automáticamente Authorization: Bearer <admin_token>
 * para llamadas hacia /bot/* o /admin/*.
 */
export async function authFetch(urlOrPath: string, options: RequestInit = {}): Promise<Response> {
    const token = getToken();
    const targetUrl = /^https?:\/\//i.test(urlOrPath)
        ? urlOrPath
        : `${getBotUrl()}${urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`}`;

    const headers = new Headers(options.headers || {});
    if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    return fetch(targetUrl, {
        ...options,
        headers,
    });
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await authFetch(path, options);
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

    setHandoff: (waId: string, status: 'bot' | 'human_active') =>
        request<{ ok: boolean; status: string; error?: string }>(
            '/admin/conversations/handoff',
            { method: 'POST', body: JSON.stringify({ wa_id: waId, status }) }
        ),

    getBotSettings: () =>
        request<BotSettingsResponse>('/bot/settings'),

    updateBotSettings: (settings: BotSettings) =>
        request<BotSettingsResponse>('/bot/settings', {
            method: 'PUT',
            body: JSON.stringify({ settings })
        }),

    syncCatalog: () =>
        request<{ ok: boolean; message?: string; error?: string }>('/bot/settings/sync-catalog', {
            method: 'POST'
        }),
};
