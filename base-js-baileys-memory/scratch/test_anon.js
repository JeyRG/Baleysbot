
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// USANDO LA KEY ANON (Como el dashboard)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testAnonAccess() {
    console.log('--- Probando acceso con Key ANON (Dashboard) ---');
    const { count, error, data } = await supabase.from('students').select('*', { count: 'exact', head: false }).limit(1);
    if (error) {
        console.log(`Error al leer students: ${error.message}`);
    } else {
        console.log(`Lectura exitosa! Encontrados ${count} estudiantes.`);
    }
}

testAnonAccess();
