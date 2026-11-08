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
 * Script RAG 2.0 para nutrir la base de conocimientos del bot con metadatos.
 * Soporta entrada interactiva, archivos JSON estructurados y archivos de texto plano.
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
        let items = [];

        if (absolutePath.endsWith('.json')) {
            const parsed = JSON.parse(rawContent);
            if (Array.isArray(parsed)) {
                items = parsed.map(item => ({
                    content: typeof item === 'string' ? item : item.content,
                    metadata: item.metadata || {}
                })).filter(i => i.content && i.content.trim().length > 5);
            } else if (parsed.content) {
                items = [{ content: parsed.content, metadata: parsed.metadata || {} }];
            }
        } else {
            // Dividir por cabeceras (ej: */REQUISITOS)
            const chunks = rawContent.split(/\*\//).map(c => c.trim()).filter(c => c.length > 5);
            items = chunks.map(c => ({ content: c, metadata: {} }));
        }

        console.log(`\n📦 Se detectaron ${items.length} bloques de conocimiento estructurado.`);
        console.log('⏳ Iniciando vectorización e ingesta a Supabase...\n');

        let successCount = 0;
        let skipCount = 0;

        for (let i = 0; i < items.length; i++) {
            const { content, metadata } = items[i];
            const preview = content.split('\n')[0].substring(0, 50);

            process.stdout.write(`   [${i + 1}/${items.length}] "${preview}..." `);

            // Deduplicación: verificar si el contenido ya existe
            const { data: existing } = await supabase
                .from('knowledge_base')
                .select('id')
                .eq('content', content)
                .limit(1);

            if (existing && existing.length > 0) {
                process.stdout.write(`⏭️ YA EXISTE (Saltado)\n`);
                skipCount++;
                continue;
            }

            try {
                const embedding = await getEmbedding(content);
                const { data, error } = await supabase.from('knowledge_base').insert({
                    content,
                    metadata: metadata || {},
                    embedding
                }).select();

                if (error) {
                    process.stdout.write(`❌ ERROR DB: ${JSON.stringify(error)}\n`);
                } else {
                    process.stdout.write(`✅ OK (ID: ${data?.[0]?.id || 'N/A'})\n`);
                    successCount++;
                }
            } catch (err) {
                process.stdout.write(`❌ ERROR VECTOR: ${err.message}\n`);
            }
        }

        console.log(`\n✨ Ingesta completada: ${successCount} nuevos, ${skipCount} existentes.`);
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
                metadata: { source: 'interactive' },
                embedding
            });

            if (error) throw error;
            console.log('\n✅ Guardado con éxito.');
        } catch (err) {
            console.error('\n❌ Error al guardar:', err.message);
        } finally {
            rl.close();
        }
    });
}

main();
