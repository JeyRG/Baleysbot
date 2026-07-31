/**
 * SCRAPER DE BROCHURES - UNAC Posgrado
 * Escanea toda la página web de posgradounac.edu.pe
 * y extrae los links de brochures para cada programa.
 * Guarda el resultado en src/data/brochures.json
 * 
 * Ejecutar: node src/scripts/scrapeBrochures.js
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://posgradounac.edu.pe';
const DETAIL_URL = `${BASE_URL}/programas/programa-detalle.php?id=`;

// IDs de todos los programas (obtenidos de Supabase)
const PROGRAM_IDS = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
    61, 62, 63, 64, 65, 66, 67, 68
];

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractBrochureUrl(html) {
    const anchors = html.split('<a ');
    for (const anchor of anchors) {
        if (anchor.includes('Descargar Brochure')) {
            const hrefMatch = anchor.match(/href="([^"]+)"/);
            if (hrefMatch) {
                let url = hrefMatch[1];
                if (!url.startsWith('http')) {
                    url = url.replace(/^\.\.\//g, '');
                    if (!url.startsWith('/')) url = '/' + url;
                    url = BASE_URL + url;
                }
                return url;
            }
        }
    }
    return null;
}

function extractProgramName(html) {
    // Buscar el <h2> con el nombre del programa
    const h2Match = html.match(/<h2[^>]*class="[^"]*font-extrabold[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h2>/i);
    if (h2Match) {
        return h2Match[1].replace(/<[^>]+>/g, '').trim();
    }
    return null;
}

async function scrapeSingleProgram(id) {
    try {
        const res = await fetch(`${DETAIL_URL}${id}`);
        const html = await res.text();
        
        // Verificar si el programa existe
        if (html.includes('Programa no encontrado')) {
            return null;
        }

        const nombre = extractProgramName(html);
        const brochureUrl = extractBrochureUrl(html);
        
        return {
            id: String(id),
            nombre: nombre || `Programa ${id}`,
            brochure: brochureUrl
        };
    } catch (err) {
        console.error(`  ❌ Error al escanear programa ${id}:`, err.message);
        return null;
    }
}

async function main() {
    console.log('🔍 ====================================');
    console.log('   SCRAPER DE BROCHURES - UNAC Posgrado');
    console.log('   ====================================\n');

    const results = {};
    let found = 0;
    let notFound = 0;
    let noExist = 0;

    for (const id of PROGRAM_IDS) {
        process.stdout.write(`  Escaneando programa ID ${id}...`);
        
        const result = await scrapeSingleProgram(id);
        
        if (result === null) {
            console.log(' ⚪ No existe');
            noExist++;
        } else if (result.brochure) {
            console.log(` ✅ ${result.nombre}`);
            console.log(`     📄 ${result.brochure}`);
            results[result.id] = {
                nombre: result.nombre,
                brochure: result.brochure
            };
            found++;
        } else {
            console.log(` ⚠️  ${result.nombre} (sin brochure)`);
            results[result.id] = {
                nombre: result.nombre,
                brochure: null
            };
            notFound++;
        }

        // Esperar 300ms entre peticiones para no sobrecargar el servidor
        await delay(300);
    }

    // Guardar resultados
    const outputDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, 'brochures.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');

    console.log('\n📊 ====================================');
    console.log('   RESUMEN');
    console.log('   ====================================');
    console.log(`   ✅ Con brochure:    ${found}`);
    console.log(`   ⚠️  Sin brochure:   ${notFound}`);
    console.log(`   ⚪ No existen:      ${noExist}`);
    console.log(`   📁 Guardado en:     ${outputPath}`);
    console.log('   ====================================\n');
}

main();
