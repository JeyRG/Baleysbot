import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { supabase } from './services/supabaseClient.js'
import { getEmbedding } from './services/embeddingService.js'
import readline from 'readline'

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/**
 * Script para nutrir la base de conocimientos del bot.
 * Soporta entrada manual o desde un archivo.
 */
async function main() {
    const args = process.argv.slice(2);
    const filePath = args[0];

    if (filePath) {
        await processFile(filePath);
    } else {
        await interactiveMode();
    }
}

async function processFile(filePath) {
    const absolutePath = path.resolve(filePath);
    console.log(`\n--- 📄 PROCESANDO ARCHIVO: ${path.basename(absolutePath)} ---`);

    if (!fs.existsSync(absolutePath)) {
        console.error('❌ El archivo no existe.');
        process.exit(1);
    }

    try {
        const rawContent = fs.readFileSync(absolutePath, 'utf8');

        // 1. Dividir por cabeceras (ej: */REQUISITOS)
        // El primer bloque es especial si no tiene */ al inicio
        const chunks = rawContent.split(/\*\//).map(c => c.trim()).filter(c => c.length > 5);

        console.log(`\n📦 Se detectaron ${chunks.length} bloques de conocimiento.`);
        console.log('⏳ Iniciando carga masiva a Supabase...\n');

        for (let i = 0; i < chunks.length; i++) {
            const text = chunks[i];
            const firstLine = text.split('\n')[0].substring(0, 50);

            process.stdout.write(`   [${i + 1}/${chunks.length}] Insertando: "${firstLine}..." `);

            try {
                const embedding = await getEmbedding(text);
                const { data, error } = await supabase.from('knowledge_base').insert({
                    content: text,
                    embedding: embedding
                }).select(); // Usar select() para confirmar inserción

                if (error) {
                    process.stdout.write(`❌ ERROR DB: ${JSON.stringify(error)}\n`);
                } else {
                    process.stdout.write(`✅ OK (ID: ${data?.[0]?.id || 'N/A'})\n`);
                }
            } catch (err) {
                process.stdout.write(`❌ ERROR VECTOR: ${err.message}\n`);
            }
        }

        console.log('\n✨ ¡Carga masiva finalizada con éxito!');
        process.exit(0);

    } catch (err) {
        console.error('❌ Error crítico:', err.message);
        process.exit(1);
    }
}

async function interactiveMode() {
    console.log('\n--- 🤖 NUTRICIÓN DE CONOCIMIENTO (MODO INTERACTIVO) ---');
    console.log('Escribe el texto que deseas que el bot "aprenda".\n');

    rl.question('👉 Introduce el conocimiento: ', async (text) => {
        if (!text || text.trim().length < 5) {
            console.log('❌ Texto muy corto.');
            rl.close();
            return;
        }

        try {
            console.log('⏳ Vectorizando...');
            const embedding = await getEmbedding(text);
            const { error } = await supabase.from('knowledge_base').insert({
                content: text,
                embedding: embedding
            });

            if (error) throw error;
            console.log('\n✅ Guardado con éxito.');
        } catch (err) {
            console.error('\n❌ Error:', err.message);
        } finally {
            rl.close();
        }
    });
}

main();
