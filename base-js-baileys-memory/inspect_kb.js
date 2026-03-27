import 'dotenv/config'
import { supabase } from './src/services/supabaseClient.js'

async function inspectKB() {
    console.log('🧐 Inspeccionando Tabla knowledge_base...');
    try {
        const { data, error } = await supabase
            .from('knowledge_base')
            .select('id, content')
            .limit(10);

        if (error) throw error;

        if (data && data.length > 0) {
            console.log(`✅ Se encontraron ${data.length} registros (mostrando los primeros 10):`);
            data.forEach((row, i) => {
                console.log(`\n[${i + 1}] ID: ${row.id}`);
                console.log(`   Contenido: "${row.content.substring(0, 100)}..."`);
            });
        } else {
            console.log('❌ La tabla knowledge_base está VACÍA.');
        }
    } catch (e) {
        console.error('❌ Error:', e.message);
    }
}

inspectKB();
