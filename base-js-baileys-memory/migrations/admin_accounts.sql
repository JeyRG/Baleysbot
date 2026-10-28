-- =========================================================================
-- SISTEMA DE CUENTAS: SUPERADMIN + AGENTES + AUDITORÍA
-- Migración para BOT2703. Ejecutar en Supabase (SQL Editor).
-- =========================================================================

-- 1) Tabla de usuarios del panel (superadmin y agentes)
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('superadmin', 'agent')),
    active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2) Tabla de auditoría (qué hace cada usuario)
CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
    actor_username TEXT,
    action TEXT NOT NULL,                 -- login, login_failed, create_user, update_user, delete_user, send_message, resolve_query, edit_knowledge, ...
    target_type TEXT,                     -- user, message, knowledge, conversation ...
    target_id TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3) Trazabilidad en mensajes: quién respondió cada mensaje del panel
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS sent_by_name TEXT;

-- 4) Sesiones (tokens opacos). El login crea una; logout/expiración la invalida.
CREATE TABLE IF NOT EXISTS public.admin_sessions (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON public.admin_users(username);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON public.admin_users(role);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action);
CREATE INDEX IF NOT EXISTS idx_messages_sent_by ON public.messages(sent_by);
-- Índice para métricas por día (mensajes respondidos por el panel)
CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON public.messages(sender_type, created_at DESC);

-- =========================================================================
-- SEGURIDAD (RLS): estas tablas SOLO las toca el backend del bot
-- (que usa la service key). El navegador con anon key NO debe poder
-- leer contraseñas ni auditoría. Negamos todo por defecto.
-- =========================================================================
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

-- Trigger para actualizar updated_at en admin_users
CREATE OR REPLACE FUNCTION touch_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at
    BEFORE UPDATE ON public.admin_users
    FOR EACH ROW
    EXECUTE FUNCTION touch_admin_users_updated_at();

-- =========================================================================
-- VISTA de métricas: mensajes respondidos por día y por agente
-- (para el reporte "qué mensajes está respondiendo cada uno por día")
-- =========================================================================
CREATE OR REPLACE VIEW public.agent_daily_stats AS
SELECT
    date_trunc('day', m.created_at)                          AS day,
    COALESCE(m.sent_by_name, 'Sin asignar')                  AS agent_name,
    m.sent_by                                                AS agent_id,
    COUNT(*)                                                 AS messages_sent
FROM public.messages m
WHERE m.sender_type IN ('dashboard', 'mobile')
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;
