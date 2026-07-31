import 'dotenv/config';
import { supabaseData } from './src/services/supabaseClient.js';

async function test() {
    const { data, error } = await supabaseData.from('estados_seguimiento').select('*');
    if (error) {
        console.error("Error:", error);
    } else {
        console.log(data);
    }
}
test();
