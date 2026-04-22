
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkData() {
    const tables = ['students', 'conversations', 'messages', 'knowledge_base', 'unresolved_queries', 'bot_logs'];
    console.log('--- Resumen de Datos en Supabase ---');
    for (const table of tables) {
        try {
            const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
            if (error) {
                console.log(`${table}: ERROR - ${error.message}`);
            } else {
                console.log(`${table}: ${count} filas`);
            }
        } catch (e) {
            console.log(`${table}: EXCEPTION - ${e.message}`);
        }
    }
}

checkData();
