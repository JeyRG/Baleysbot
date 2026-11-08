import 'dotenv/config';
import { supabase } from '../src/services/supabaseClient.js';
import { getEmbedding } from '../src/services/embeddingService.js';

async function test() {
    console.log('Probando match_documents_filtered con embedding de prueba...');
    const emb = await getEmbedding('¿Cuánto cuesta la maestría en administración?');
    
    // 1. Sin filtro
    const res1 = await supabase.rpc('match_documents_filtered', {
        query_embedding: emb,
        match_threshold: 0.5,
        match_count: 3,
        filter_meta: {}
    });
    console.log('Resultados sin filtro:', res1.data?.length || 0, 'error:', res1.error);

    // 2. Con filtro de metadata
    const res2 = await supabase.rpc('match_documents_filtered', {
        query_embedding: emb,
        match_threshold: 0.5,
        match_count: 3,
        filter_meta: { tema: 'costos' }
    });
    console.log('Resultados con filtro { tema: "costos" }:', res2.data?.length || 0, 'error:', res2.error);
}

test().catch(console.error);
