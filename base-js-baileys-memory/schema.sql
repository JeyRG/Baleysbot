-- Habilitar extensiones
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Tabla de Estudiantes/Leads (NUEVO)
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_id TEXT UNIQUE NOT NULL,
    full_name TEXT,
    document_id TEXT,
    phone_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabla de Conversaciones
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_id TEXT UNIQUE NOT NULL,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'bot' CHECK (status IN ('bot', 'human_active')),
    metadata JSONB DEFAULT '{}'::jsonb,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabla de Mensajes
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'bot', 'dashboard', 'mobile')),
    text TEXT,
    media_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabla de Base de Conocimientos (RAG)
CREATE TABLE IF NOT EXISTS public.knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(384)
);

-- Tabla de Telemetría (NUEVO)
CREATE TABLE IF NOT EXISTS public.bot_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    latency_ms INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_embedding ON public.knowledge_base USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_students_wa_id ON public.students(wa_id);

-- RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;

-- Políticas
DO $$
BEGIN
    DROP POLICY IF EXISTS "Leer conversaciones autenticado" ON public.conversations;
    DROP POLICY IF EXISTS "Actualizar conversaciones autenticado" ON public.conversations;
    DROP POLICY IF EXISTS "Leer mensajes autenticado" ON public.messages;
    DROP POLICY IF EXISTS "Insertar mensajes autenticado" ON public.messages;
    DROP POLICY IF EXISTS "Leer KB" ON public.knowledge_base;
    DROP POLICY IF EXISTS "Administrar students autenticado" ON public.students;
    DROP POLICY IF EXISTS "Administrar logs autenticado" ON public.bot_logs;
EXCEPTION
    WHEN undefined_object THEN null;
END $$;

CREATE POLICY "Leer conversaciones autenticado" ON public.conversations FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Actualizar conversaciones autenticado" ON public.conversations FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Leer mensajes autenticado" ON public.messages FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Insertar mensajes autenticado" ON public.messages FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Leer KB" ON public.knowledge_base FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Administrar students autenticado" ON public.students FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Administrar logs autenticado" ON public.bot_logs FOR ALL USING (auth.role() = 'authenticated');

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;

-- Función RAG
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector(384),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    metadata,
    1 - (knowledge_base.embedding <=> query_embedding) AS similarity
  FROM knowledge_base
    WHERE 1 - (knowledge_base.embedding <=> query_embedding) > match_threshold
  ORDER BY knowledge_base.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Función para Auto-Handoff (Timeout) (NUEVO)
CREATE OR REPLACE FUNCTION reset_inactive_conversations(timeout_minutes INT DEFAULT 120) 
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.conversations
  SET status = 'bot'
  WHERE status = 'human_active' 
    AND last_activity_at < timezone('utc', now()) - (timeout_minutes || ' minutes')::interval;
END;
$$;

-- =========================================================================
-- CACHÉ SEMÁNTICO (Optimización de costos)
-- =========================================================================

-- Tabla de Caché Semántico
CREATE TABLE IF NOT EXISTS public.semantic_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    embedding vector(384),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índice HNSW ultrarrápido para buscar coincidencias
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding ON public.semantic_cache USING hnsw (embedding vector_cosine_ops);

-- Privacidad y RLS de la Caché
ALTER TABLE public.semantic_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Leer cache autenticado" ON public.semantic_cache;
EXCEPTION
    WHEN undefined_object THEN null;
END $$;

CREATE POLICY "Leer cache autenticado" ON public.semantic_cache FOR SELECT USING (auth.role() = 'authenticated');

-- Función para buscar en caché
CREATE OR REPLACE FUNCTION match_semantic_cache (
  query_embedding vector(384),
  match_threshold float
)
RETURNS TABLE (
  answer text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    answer,
    1 - (semantic_cache.embedding <=> query_embedding) AS similarity
  FROM semantic_cache
  WHERE 1 - (semantic_cache.embedding <=> query_embedding) > match_threshold
  ORDER BY semantic_cache.embedding <=> query_embedding
  LIMIT 1;
$$;

-- Trigger para limpiar caché cuando la Base de Conocimientos cambia (NUEVO)
CREATE OR REPLACE FUNCTION clear_semantic_cache()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.semantic_cache;
  RETURN NULL; -- AFTER trigger
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clear_semantic_cache ON public.knowledge_base;
CREATE TRIGGER trg_clear_semantic_cache
AFTER INSERT OR UPDATE OR DELETE ON public.knowledge_base
FOR EACH STATEMENT
EXECUTE FUNCTION clear_semantic_cache();

-- =========================================================================
-- INTEGRACIÓN DE LEADS Y BROCHURES
-- =========================================================================

-- Tabla para encolar prospectos que no han contactado aún
CREATE TABLE IF NOT EXISTS public.pending_leads (
    wa_id TEXT PRIMARY KEY,
    program_name TEXT,
    faculty_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.pending_leads ENABLE ROW LEVEL SECURITY;

