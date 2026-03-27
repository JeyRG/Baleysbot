import 'dotenv/config'
import { supabase } from './src/services/supabaseClient.js'

async function listTables() {
    console.log('📋 Listando tablas en Supabase...');
    try {
        // Consultar metadatos de las tablas
        const { data, error } = await supabase.rpc('get_tables_info');

        if (error) {
            console.log('⚠️ RPC get_tables_info no existe. Probando consulta directa...');
            const { data: data2, error: error2 } = await supabase
                .from('knowledge_base')
                .select('count', { count: 'exact', head: true });

            if (error2) throw error2;
            console.log('✅ Tabla knowledge_base existe. Conteo:', data2);
        } else {
            console.log('✅ Tablas encontradas:', data);
        }
    } catch (e) {
        console.error('❌ Error:', e.message);
    }
}

listTables();
