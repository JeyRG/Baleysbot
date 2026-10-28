import 'dotenv/config';
import { supabase } from './src/services/supabaseClient.js';

async function test() {
    const res = await supabase.from('conversations').select('status').eq('wa_id', '51927953033').single();
    console.log(res);
}

test();
