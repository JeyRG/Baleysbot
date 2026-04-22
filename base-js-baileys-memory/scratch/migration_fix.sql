-- =====================================================
-- MIGRACIÓN: Corregir tablas para sincronización
-- Ejecutar en el SQL Editor de Supabase Dashboard
-- =====================================================

-- 1. Agregar columna last_message (requerida por el trigger existente)
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_message TEXT;

-- 2. Política para permitir que el bot inserte conversaciones
DO $$
BEGIN
    DROP POLICY IF EXISTS "Insertar conversaciones publico" ON public.conversations;
EXCEPTION
    WHEN undefined_object THEN null;
END $$;
CREATE POLICY "Insertar conversaciones publico" ON public.conversations FOR INSERT WITH CHECK (true);

-- 3. Política para permitir eliminar conversaciones (limpieza)
DO $$
BEGIN
    DROP POLICY IF EXISTS "Eliminar conversaciones publico" ON public.conversations;
EXCEPTION
    WHEN undefined_object THEN null;
END $$;
CREATE POLICY "Eliminar conversaciones publico" ON public.conversations FOR DELETE USING (true);

-- 4. Verificar que messages y conversations estén en realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
