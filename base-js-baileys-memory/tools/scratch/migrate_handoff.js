import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function migrate() {
    console.log('=== Migración: Agregar columna handoff ===\n');

    // 1. Agregar columna handoff a conversations
    const { error: e1 } = await supabase.rpc('exec_sql', {
        sql: `ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS handoff BOOLEAN DEFAULT false;`
    });

    if (e1) {
        console.log('⚠️  RPC exec_sql no disponible. Necesitas ejecutar este SQL manualmente en Supabase Dashboard:');
        console.log('');
        console.log('--- COPIAR Y PEGAR EN SQL EDITOR DE SUPABASE ---');
        console.log('');
        console.log(`
-- 1. Agregar columna handoff
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS handoff BOOLEAN DEFAULT false;

-- 2. Agregar columna last_message para el trigger
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_message TEXT;

-- 3. Recrear el trigger con las columnas correctas
CREATE OR REPLACE FUNCTION link_message_to_conversation()
RETURNS TRIGGER AS $$
DECLARE
    conv_id UUID;
BEGIN
    IF NEW.conversation_id IS NULL AND NEW.wa_id IS NOT NULL THEN
        SELECT id INTO conv_id FROM public.conversations WHERE wa_id = NEW.wa_id LIMIT 1;
        
        IF conv_id IS NULL THEN
            INSERT INTO public.conversations (wa_id, last_message, updated_at) 
            VALUES (NEW.wa_id, NEW.text, now()) 
            RETURNING id INTO conv_id;
        ELSE
            UPDATE public.conversations 
            SET last_message = NEW.text, updated_at = now() 
            WHERE id = conv_id;
        END IF;
        
        NEW.conversation_id := conv_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Política para insertar conversaciones (si no existe)
DO $$
BEGIN
    DROP POLICY IF EXISTS "Insertar conversaciones publico" ON public.conversations;
EXCEPTION
    WHEN undefined_object THEN null;
END $$;
CREATE POLICY "Insertar conversaciones publico" ON public.conversations FOR INSERT WITH CHECK (true);

-- 5. Agregar tabla a realtime (si no está)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;
`);
        console.log('--- FIN SQL ---');
    } else {
        console.log('✅ Columna handoff agregada correctamente.');
    }

    // Verificar estado actual
    const { data, error: checkErr } = await supabase
        .from('conversations')
        .select('*')
        .limit(3);

    console.log('\n📊 Estado actual de conversations:');
    if (checkErr) {
        console.log('  Error:', checkErr.message);
    } else {
        console.log(`  Registros encontrados: ${data?.length || 0}`);
        if (data?.length > 0) {
            console.log('  Columnas:', Object.keys(data[0]).join(', '));
        }
    }
}

migrate().catch(console.error);
