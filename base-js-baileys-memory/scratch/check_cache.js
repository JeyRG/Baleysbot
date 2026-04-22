
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkCache() {
    const { count, error } = await supabase.from('semantic_cache').select('*', { count: 'exact', head: true });
    if (error) {
        console.log(`Error: ${error.message}`);
    } else {
        console.log(`Semantic Cache: ${count} filas`);
    }
}

checkCache();
