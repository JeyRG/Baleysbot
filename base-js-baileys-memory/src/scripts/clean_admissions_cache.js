import 'dotenv/config';
import { supabase } from '../services/supabaseClient.js';

async function runSelectiveClean() {
    console.log(`=======================================================`);
    console.log(` PURGA SELECTIVA DE CACHÉ Y RAG ANTIGUO`);
    console.log(`=======================================================`);

    // 1. Limpiar semantic_cache (CRÍTICO: evita que devuelva fechas/costos de semestres anteriores)
    console.log('[Clean] Purgando semantic_cache...');
    const { error: errCache } = await supabase
        .from('semantic_cache')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Borra todo de forma segura

    if (errCache) {
        console.error('[Clean] ❌ Error en semantic_cache:', errCache.message);
    } else {
        console.log('[Clean] ✅ semantic_cache limpiado (respuestas obsoletas eliminadas).');
    }

    // 2. Limpiar knowledge_base previa para que se regenere limpia con el nuevo entrenamiento
    console.log('[Clean] Purgando knowledge_base previa...');
    const { error: errKB } = await supabase
        .from('knowledge_base')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

    if (errKB) {
        console.error('[Clean] ❌ Error en knowledge_base:', errKB.message);
    } else {
        console.log('[Clean] ✅ knowledge_base limpiada lista para nuevo entrenamiento.');
    }

    console.log(`=======================================================`);
    console.log(` NOTA: Las tablas 'students', 'conversations' y 'messages'`);
    console.log(` NO fueron tocadas para proteger los datos de tus contactos.`);
    console.log(`=======================================================`);
}

runSelectiveClean()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('[Clean] ❌ Fallo:', err);
        process.exit(1);
    });
