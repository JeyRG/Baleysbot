-- =========================================================================
-- SPRINT 10-13: CONFIGURACIÓN DINÁMICA DEL BOT, COLA DURABLE Y TRAZABILIDAD DE ENTREGA
-- Migración idempotente para BOT2703 (Supabase PostgreSQL)
-- =========================================================================

-- 1) Tabla de parámetros institucionales dinámicos del Bot (editables desde Dashboard)
CREATE TABLE IF NOT EXISTS public.bot_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
    updated_by_name TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;

-- 2) Cola durable de envíos de pre-inscripción / leads (/v1/enviar-datos)
CREATE TABLE IF NOT EXISTS public.outbound_lead_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_id TEXT NOT NULL,
    dni TEXT,
    nombre TEXT,
    facultad TEXT,
    programa TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_outbound_lead_queue_status_sched
    ON public.outbound_lead_queue(status, scheduled_at ASC);

CREATE INDEX IF NOT EXISTS idx_outbound_lead_queue_created
    ON public.outbound_lead_queue(created_at DESC);

ALTER TABLE public.outbound_lead_queue ENABLE ROW LEVEL SECURITY;

-- 3) Estado de entrega real en WhatsApp para mensajes enviados desde el Dashboard
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'sent',
    ADD COLUMN IF NOT EXISTS delivery_error TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_delivery_status
    ON public.messages(delivery_status)
    WHERE delivery_status = 'failed';
