import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
    // Listar todas las conversaciones
    const { data } = await s.from('conversations').select('id, wa_id, status').order('wa_id');
    console.log('Todas las conversaciones:');
    if (data) {
        data.forEach(c => console.log('  ' + c.wa_id + ' | status=' + c.status + ' | id=' + c.id));
        console.log('Total: ' + data.length);
        
        // Encontrar duplicados (con @s.whatsapp.net)
        const dupes = data.filter(c => c.wa_id.includes('@'));
        if (dupes.length > 0) {
            console.log('\nDuplicados encontrados (con @):');
            for (const d of dupes) {
                console.log('  Eliminando: ' + d.wa_id);
                // Mover mensajes de la versión @s.whatsapp.net a la versión sin @
                const cleanId = d.wa_id.split('@')[0];
                await s.from('messages').update({ wa_id: cleanId }).eq('wa_id', d.wa_id);
                // Eliminar la conversación duplicada
                await s.from('conversations').delete().eq('id', d.id);
            }
            console.log('Limpieza completada!');
        } else {
            console.log('\nNo hay duplicados.');
        }
    }
})();
