-- Migración RAG 2.0: Búsqueda Semántica con Filtrado por Metadatos
CREATE INDEX IF NOT EXISTS idx_knowledge_base_metadata ON public.knowledge_base USING gin (metadata);

CREATE OR REPLACE FUNCTION match_documents_filtered (
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  filter_meta jsonb DEFAULT '{}'::jsonb
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
  WHERE (filter_meta = '{}'::jsonb OR knowledge_base.metadata @> filter_meta)
    AND 1 - (knowledge_base.embedding <=> query_embedding) > match_threshold
  ORDER BY knowledge_base.embedding <=> query_embedding
  LIMIT match_count;
$$;
