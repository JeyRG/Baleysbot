import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../services/supabaseClient.js';
import { getEmbedding } from '../services/embeddingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const trainingFile = path.join(__dirname, '..', 'services', 'entranmiento.json');

async function processTrainingFile() {
    console.log(`[Trainer] Leyendo archivo de entrenamiento: ${trainingFile}`);
    
    if (!fs.existsSync(trainingFile)) {
        console.error('[Trainer] ❌ No se encontró el archivo de entrenamiento.');
        return;
    }

    const content = fs.readFileSync(trainingFile, 'utf-8');
    
    // Dividir el archivo por las secciones delimitadas por "*/"
    const sections = content.split('*/').filter(s => s.trim().length > 0);
    
    console.log(`[Trainer] Se encontraron ${sections.length} secciones para procesar.`);

    let inserted = 0;

    for (let i = 0; i < sections.length; i++) {
        const sectionText = sections[i].trim();
        if (!sectionText) continue;

        // Extraer el título de la sección (la primera línea)
        const lines = sectionText.split('\n');
        const title = lines[0].trim().toUpperCase();
        const body = lines.slice(1).join('\n').trim();

        // Si no tiene cuerpo, o todo era texto general (primer bloque)
        let chunkText = "";
        let metadata = { source: 'entranmiento.json' };

        if (i === 0 && !title.includes('REQUISITOS')) {
            // El primer bloque suele ser general (fechas, modalidad general)
            chunkText = sectionText;
            metadata.topic = 'INFORMACIÓN GENERAL (Fechas, Modalidad)';
        } else {
            chunkText = `Sobre ${title}:\n${body}`;
            metadata.topic = title;
        }

        console.log(`[Trainer] Procesando chunk: ${metadata.topic || 'General'} (${chunkText.length} caracteres)`);

        try {
            // Obtener embedding
            const embedding = await getEmbedding(chunkText);
            
            if (!embedding) {
                console.error(`[Trainer] ⚠️ No se pudo obtener el embedding para el chunk ${i}. Saltando...`);
                continue;
            }

            // Insertar en Supabase
            const { error } = await supabase.from('knowledge_base').insert({
                content: chunkText,
                embedding: embedding,
                metadata: metadata
            });

            if (error) {
                console.error(`[Trainer] ❌ Error insertando en Supabase:`, error.message);
            } else {
                inserted++;
            }
            
            // Pequeña pausa para no saturar la API de Grok
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (err) {
            console.error(`[Trainer] ❌ Excepción procesando chunk ${i}:`, err.message);
        }
    }

    console.log(`[Trainer] ✅ Entrenamiento completado. Se insertaron ${inserted} fragmentos de conocimiento en la base de datos.`);
}

processTrainingFile().then(() => process.exit(0));
