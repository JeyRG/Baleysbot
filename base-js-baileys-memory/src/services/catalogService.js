import { supabaseData as supabase } from './supabaseClient.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let cachedCatalog = null;
let cachedTiposInfo = {};  // Datos enriquecidos de tipos_programas
let isFetching = false;

const normalizeText = (text) => {
    if (!text) return ""
    let norm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    norm = norm.replace(/\b(de|la|en|el|y|con|mencion)\b/g, "").replace(/\s+/g, " ").trim()
    return norm
}

const normalizeName = (name) => {
    return (name || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ').trim();
}

const levenshtein = (a, b) => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
};

const isWordMatch = (queryWord, targetWord) => {
    if (targetWord.includes(queryWord) || queryWord.includes(targetWord)) return true;
    if (queryWord.length > 4 && targetWord.length > 4 && levenshtein(queryWord, targetWord) <= 2) return true;
    return false;
};

/**
 * Carga el mapa de brochures desde brochures.json
 */
function loadBrochuresMap() {
    try {
        const brochuresPath = path.join(__dirname, '..', 'data', 'brochures.json');
        const rawBrochures = JSON.parse(fs.readFileSync(brochuresPath, 'utf-8'));
        const map = {};
        for (const [id, entry] of Object.entries(rawBrochures)) {
            if (entry.brochure) {
                map[normalizeName(entry.nombre)] = entry.brochure;
            }
        }
        console.log(`[Catalog] ✅ Brochures cargados desde JSON: ${Object.keys(map).length} programas`);
        return map;
    } catch (e) {
        console.warn('[Catalog] ⚠️ No se pudo cargar brochures.json:', e.message);
        return {};
    }
}

/**
 * Busca un brochure URL por nombre de programa usando fuzzy matching
 */
function matchBrochureUrl(programName, brochuresMap) {
    const normalized = normalizeName(programName);
    // 1. Match exacto
    if (brochuresMap[normalized]) return brochuresMap[normalized];

    // 2. Match fuzzy por palabras clave
    const words = normalized.split(' ').filter(w => w.length > 2);
    let bestMatch = null;
    let bestScore = 0;

    for (const [mapName, url] of Object.entries(brochuresMap)) {
        let score = 0;
        for (const word of words) {
            if (mapName.includes(word)) score++;
        }
        if (score > bestScore && score >= words.length * 0.7) {
            bestScore = score;
            bestMatch = url;
        }
    }
    return bestMatch;
}

/**
 * Descarga los datos de Supabase y construye el catálogo en memoria.
 * Ahora incluye datos enriquecidos de tipos_programas y URLs de brochures.
 */
export const initCatalog = async () => {
    if (isFetching) return;
    isFetching = true;
    try {
        console.log('[Catalog] Fetching data from Supabase...');
        const { data: unidades, error: errU } = await supabase.from('unidades').select('*');
        const { data: tipos, error: errT } = await supabase.from('tipos_programas').select('*');
        const { data: programas, error: errP } = await supabase.from('programas').select('*');

        if (errU || errT || errP) {
            console.error('[Catalog] Error fetching from Supabase:', errU || errT || errP);
            isFetching = false;
            return;
        }

        // Cargar brochures desde JSON
        const brochuresMap = loadBrochuresMap();

        const newCatalog = {};

        // Mapear tipos de programa por ID con datos enriquecidos
        const tiposMap = {};
        const newTiposInfo = {};
        tipos.forEach(t => {
            const nombre = (t.nombre_tipoprograma || '').toLowerCase();
            let cat = 'otros';
            if (nombre.includes('maest')) cat = 'maestrias';
            else if (nombre.includes('doctorado')) cat = 'doctorados';
            else if (nombre.includes('especial')) cat = 'especialidades';

            tiposMap[t.id_tipoprograma] = cat;

            // Guardar datos enriquecidos por categoría
            if (!newTiposInfo[cat] || cat !== 'otros') {
                newTiposInfo[cat] = {
                    nombre: t.nombre_tipoprograma,
                    costos: t.costos || null,
                    requisitos: t.requisitos || null,
                    duracion: t.duracion_programa || null,
                    creditos: t.creditos_programa || null,
                    costo_ciclo: t.costo_per_ciclo || null,
                    numero_cuenta: t.numero_cuenta || null,
                };
            }
        });

        cachedTiposInfo = newTiposInfo;

        // Crear la estructura de facultades
        unidades.forEach(u => {
            newCatalog[u.id_unidad] = {
                nombre: u.nombre_unidad,
                correo: u.correo_unidad || null,
                telefono: u.telefono_unidad || null,
                maestrias: {},
                doctorados: {},
                especialidades: {}
            };
        });

        // Poblar programas con brochure URL incluido
        programas.forEach(p => {
            if (p.id_unidad && newCatalog[p.id_unidad]) {
                const cat = tiposMap[p.id_tipoprograma] || 'maestrias';
                if (newCatalog[p.id_unidad][cat]) {
                    // Buscar brochure URL del JSON
                    const brochureUrl = matchBrochureUrl(p.nombre_programa, brochuresMap);

                    newCatalog[p.id_unidad][cat][p.id_programa] = {
                        id: p.id_programa,
                        nombre: p.nombre_programa,
                        descripcion: p.descripcion,
                        link_ws: p.link_ws,
                        perfiles_programa: p.perfiles_programa,
                        malla_curricular: p.malla_curricular,
                        brochure: brochureUrl || null,
                    };
                }
            }
        });

        cachedCatalog = newCatalog;

        // Contar programas
        let totalProgs = 0;
        let totalBrochures = 0;
        for (const fId in newCatalog) {
            for (const cat of ['maestrias', 'doctorados', 'especialidades']) {
                const progs = Object.values(newCatalog[fId][cat] || {});
                totalProgs += progs.length;
                totalBrochures += progs.filter(p => p.brochure).length;
            }
        }
        console.log(`[Catalog] ✅ Catálogo cargado: ${totalProgs} programas, ${totalBrochures} con brochure`);
    } catch (error) {
        console.error('[Catalog] Exception in initCatalog:', error);
    }
    isFetching = false;
}

// Actualización cada hora
setInterval(initCatalog, 3600000);

/**
 * Devuelve el catálogo cacheado.
 */
export const getCatalog = () => {
    if (!cachedCatalog) {
        console.warn('[Catalog] Warning: Catalog accessed before being initialized.');
    }
    return cachedCatalog;
}

/**
 * Devuelve los datos enriquecidos de un tipo de programa (maestrias, doctorados, especialidades)
 */
export const getTipoProgramaInfo = (category) => {
    return cachedTiposInfo[category] || null;
}

/**
 * Busca programas por nombre usando comparación flexible.
 */
export const findPrograms = (query) => {
    const catalog = getCatalog()
    if (!catalog || !query || query.trim().length < 4) return []

    const queryNorm = normalizeText(query)
    const matchedPrograms = []
    const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 3)

    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        const categories = ['maestrias', 'doctorados', 'especialidades']

        for (const cat of categories) {
            if (facultad[cat]) {
                for (const progId in facultad[cat]) {
                    const program = facultad[cat][progId]
                    const progNameNorm = normalizeText(program.nombre)

                    // 1. Coincidencia exacta o contenida
                    if (queryNorm.includes(progNameNorm) || progNameNorm.includes(queryNorm)) {
                        matchedPrograms.push({ ...program, facultad: facultad.nombre, tipo: cat })
                        continue;
                    }

                    // 2. Coincidencia por palabras clave
                    if (queryWords.length > 0) {
                        const targetWords = progNameNorm.split(/\s+/)
                        const matchCount = queryWords.filter(qWord =>
                            targetWords.some(tWord => isWordMatch(qWord, tWord))
                        ).length

                        if (matchCount >= 2) {
                            matchedPrograms.push({ ...program, facultad: facultad.nombre, tipo: cat })
                        }
                    }
                }
            }
        }
    }

    return matchedPrograms
}

export const findProgram = (query) => {
    const results = findPrograms(query);
    return results.length > 0 ? results[0] : null;
}

/**
 * Busca si el usuario menciona una categoría (maestrías, doctorados, etc.)
 */
export const findCategory = (query) => {
    const queryNorm = normalizeText(query)
    if (queryNorm.includes('maestria')) return 'maestrias'
    if (queryNorm.includes('doctorado')) return 'doctorados'
    if (queryNorm.includes('especialidad') || queryNorm.includes('segunda especial')) return 'especialidades'
    return null
}

/**
 * Genera un menú numerado con las facultades de una categoría específica.
 */
export const getContextForCategory = (category) => {
    const catalog = getCatalog()
    if (!catalog || !category) return null;

    const tipoInfo = getTipoProgramaInfo(category);
    const categoryLabel = category === 'maestrias' ? 'MAESTRÍAS' :
        category === 'doctorados' ? 'DOCTORADOS' :
            category === 'especialidades' ? 'SEGUNDAS ESPECIALIDADES' : category.toUpperCase();

    let ctx = `🎓 *${categoryLabel} - UNAC*\n\n`;

    // Agregar datos del tipo si existen
    if (tipoInfo) {
        if (tipoInfo.duracion) ctx += `⏳ *Duración:* ${tipoInfo.duracion}\n`;
        if (tipoInfo.costos) ctx += `💰 *Inscripción:* ${tipoInfo.costos}\n`;
        ctx += '\n';
    }

    ctx += `Por favor, elige una Facultad ingresando el *número* correspondiente:\n\n`;

    const faculties = [];
    let idx = 1;
    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        if (facultad[category] && Object.keys(facultad[category]).length > 0) {
            ctx += `*${idx}.* ${facultad.nombre}\n`;
            faculties.push(facultad.nombre);
            idx++;
        }
    }

    if (faculties.length === 0) {
        return { text: `No se encontraron programas en la categoría ${categoryLabel}.`, faculties: [] };
    }

    ctx += `\n*0.* Cancelar`;
    
    return { text: ctx, faculties, category };
}

/**
 * Obtiene los programas de una facultad y categoría específicas (para cuando el usuario elige un número)
 */
export const getProgramsForFacultyCategory = (facultyName, category) => {
    const catalog = getCatalog();
    if (!catalog || !category || !facultyName) return "";

    for (const facultyId in catalog) {
        if (catalog[facultyId].nombre === facultyName) {
            const facultad = catalog[facultyId];
            if (facultad[category]) {
                const progs = Object.values(facultad[category]);
                let ctx = `🏢 *${facultad.nombre}:*\n\n`;
                progs.forEach(p => {
                    ctx += `• ${p.nombre}\n`;
                });
                ctx += `\n¿Deseas información de alguno en específico? Solo escribe su nombre. 📄✨`;
                return ctx;
            }
        }
    }
    return "No se encontraron programas en esa facultad.";
}

/**
 * Devuelve un array plano con todos los programas de una categoría.
 */
export const getAllProgramsByCategory = (category) => {
    const catalog = getCatalog()
    if (!catalog || !category) return []

    const programs = [];
    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        if (facultad[category]) {
            Object.values(facultad[category]).forEach(p => {
                programs.push({ ...p, facultad: facultad.nombre, tipo: category })
            })
        }
    }
    return programs;
}

/**
 * Genera un resumen general de TODOS los programas de posgrado (las 3 categorías).
 */
export const getAllProgramsGeneral = () => {
    const catalog = getCatalog()
    if (!catalog) return "No se pudo cargar el catálogo de programas."

    let maestriasCount = 0, doctoradosCount = 0, especialidadesCount = 0;

    for (const facultyId in catalog) {
        const f = catalog[facultyId];
        maestriasCount += Object.keys(f.maestrias || {}).length;
        doctoradosCount += Object.keys(f.doctorados || {}).length;
        especialidadesCount += Object.keys(f.especialidades || {}).length;
    }

    const total = maestriasCount + doctoradosCount + especialidadesCount;

    let msg = `🎓 *OFERTA ACADÉMICA DE POSGRADO - UNAC*\n\n`;
    msg += `Contamos con *${total} programas de posgrado* en las siguientes modalidades:\n\n`;
    msg += `📘 *Maestrías:* ${maestriasCount} programas\n`;
    msg += `📕 *Doctorados:* ${doctoradosCount} programas\n`;
    msg += `📗 *Segundas Especialidades:* ${especialidadesCount} programas\n\n`;

    // Datos de costo general si están disponibles
    const tipoMaestria = getTipoProgramaInfo('maestrias');
    const tipoDoctorado = getTipoProgramaInfo('doctorados');
    const tipoEspecialidad = getTipoProgramaInfo('especialidades');

    if (tipoMaestria?.duracion || tipoDoctorado?.duracion || tipoEspecialidad?.duracion) {
        msg += `⏳ *Duración:*\n`;
        if (tipoMaestria?.duracion) msg += `  • Maestría: ${tipoMaestria.duracion}\n`;
        if (tipoDoctorado?.duracion) msg += `  • Doctorado: ${tipoDoctorado.duracion}\n`;
        if (tipoEspecialidad?.duracion) msg += `  • Especialidad: ${tipoEspecialidad.duracion}\n`;
        msg += '\n';
    }

    msg += `Escribe *maestrías*, *doctorados* o *especialidades* para ver la lista completa de cada una. 📋\n`;
    msg += `O dime el nombre del programa que te interesa para enviarte el brochure oficial 📄✨`;

    return msg;
}

/**
 * Búsqueda ultra-flexible para el envío de brochures
 */
export const findProgramFuzzy = (query) => {
    const catalog = getCatalog()
    if (!catalog || !query) return null

    const queryNorm = normalizeText(query)

    let allPrograms = []
    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        const categories = ['maestrias', 'doctorados', 'especialidades']
        categories.forEach(cat => {
            if (facultad[cat]) {
                Object.values(facultad[cat]).forEach(p => {
                    allPrograms.push({ ...p, facultad: facultad.nombre, tipo: cat })
                })
            }
        })
    }

    // 1. Coincidencia por sub-cadena
    const matchSimple = allPrograms.find(p => {
        const nameNorm = normalizeText(p.nombre)
        return nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)
    })
    if (matchSimple) return matchSimple

    // 2. Coincidencia por palabras clave compartidas
    const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 2)
    if (queryWords.length > 0) {
        const matchesByKeyword = allPrograms.map(p => {
            const nameNorm = normalizeText(p.nombre)
            const targetWords = nameNorm.split(/\s+/)
            const overlap = queryWords.filter(qWord =>
                targetWords.some(tWord => isWordMatch(qWord, tWord))
            ).length
            return { program: p, overlap }
        }).filter(m => m.overlap >= 1)

        if (matchesByKeyword.length > 0) {
            return matchesByKeyword.sort((a, b) => b.overlap - a.overlap)[0].program
        }
    }

    return null
}

/**
 * Busca si el usuario menciona una facultad.
 */
export const findFaculty = (query) => {
    const catalog = getCatalog()
    if (!catalog || !query) return null
    const queryNorm = normalizeText(query)

    for (const facultyId in catalog) {
        if (normalizeText(catalog[facultyId].nombre).includes(queryNorm) || queryNorm.includes(normalizeText(catalog[facultyId].nombre))) {
            return catalog[facultyId]
        }
    }
    return null
}

/**
 * Genera un contexto detallado de una facultad específica.
 */
export const getContextForFaculty = (faculty) => {
    if (!faculty) return ""
    let ctx = `Programas de la ${faculty.nombre}:\n`

    if (faculty.maestrias) {
        ctx += "\nMAESTRÍAS:\n"
        Object.values(faculty.maestrias).forEach(p => ctx += `- ${p.nombre}\n`)
    }
    if (faculty.doctorados) {
        ctx += "\nDOCTORADOS:\n"
        Object.values(faculty.doctorados).forEach(p => ctx += `- ${p.nombre}\n`)
    }
    if (faculty.especialidades) {
        ctx += "\nESPECIALIDADES:\n"
        Object.values(faculty.especialidades).forEach(p => ctx += `- ${p.nombre}\n`)
    }
    return ctx
}

/**
 * Devuelve una lista resumida de todas las facultades.
 */
export const getSummaryContext = () => {
    const catalog = getCatalog()
    if (!catalog) return ""

    let summary = "Contamos con las siguientes facultades y ejemplos de programas:\n\n"
    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        summary += `- Facultad: ${facultad.nombre}\n`
        const highlights = []
        if (facultad.maestrias) highlights.push(...Object.values(facultad.maestrias).slice(0, 1).map(p => p.nombre))
        if (highlights.length > 0) summary += `  Ejemplo: ${highlights[0]}\n`
    }
    summary += "\nIndícame de qué facultad o programa deseas información detallada."
    return summary
}

/**
 * Obtiene solo los nombres de todos los programas en una lista plana
 */
export const getAllProgramNamesOnly = () => {
    const catalog = getCatalog()
    if (!catalog) return ""

    let names = []
    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        const categories = ['maestrias', 'doctorados', 'especialidades']
        categories.forEach(cat => {
            if (facultad[cat]) {
                Object.values(facultad[cat]).forEach(p => names.push(p.nombre))
            }
        })
    }
    return names.join(' • ')
}

/**
 * Genera un contexto enriquecido con datos de costos/requisitos para Grok
 */
export const getEnrichedContextForGrok = (category) => {
    const tipoInfo = getTipoProgramaInfo(category);
    if (!tipoInfo) return '';

    let ctx = '';
    if (tipoInfo.costos) ctx += `Costos de ${category}: ${tipoInfo.costos}\n`;
    if (tipoInfo.requisitos) ctx += `Requisitos de ${category}: ${tipoInfo.requisitos}\n`;
    if (tipoInfo.duracion) ctx += `Duración de ${category}: ${tipoInfo.duracion}\n`;
    if (tipoInfo.creditos) ctx += `Créditos de ${category}: ${tipoInfo.creditos}\n`;
    if (tipoInfo.costo_ciclo) ctx += `Costo por ciclo de ${category}: ${tipoInfo.costo_ciclo}\n`;
    if (tipoInfo.numero_cuenta) ctx += `Número de cuenta para ${category}: ${tipoInfo.numero_cuenta}\n`;
    return ctx;
}
