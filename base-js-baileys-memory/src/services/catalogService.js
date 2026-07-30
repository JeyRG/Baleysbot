import { supabaseData as supabase } from './supabaseClient.js'

let cachedCatalog = null;
let isFetching = false;

const normalizeText = (text) => {
    if (!text) return ""
    // Quitar tildes, pasar a minúsculas y quitar palabras vacías comunes
    let norm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    norm = norm.replace(/\b(de|la|en|el|y|con|mencion)\b/g, "").replace(/\s+/g, " ").trim()
    return norm
}

/**
 * Descarga los datos de Supabase y construye el catálogo en memoria.
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

        const newCatalog = {};
        
        // Mapear tipos de programa por ID
        const tiposMap = {};
        tipos.forEach(t => {
            const nombre = t.nombre_tipoprograma.toLowerCase();
            let cat = 'otros';
            if (nombre.includes('maest')) cat = 'maestrias';
            else if (nombre.includes('doctorado')) cat = 'doctorados';
            else if (nombre.includes('especial')) cat = 'especialidades';
            tiposMap[t.id_tipoprograma] = cat;
        });

        // Crear la estructura de facultades
        unidades.forEach(u => {
            newCatalog[u.id_unidad] = {
                nombre: u.nombre_unidad,
                maestrias: {},
                doctorados: {},
                especialidades: {}
            };
        });

        // Poblar programas
        programas.forEach(p => {
            if (p.id_unidad && newCatalog[p.id_unidad]) {
                const cat = tiposMap[p.id_tipoprograma] || 'maestrias';
                if (newCatalog[p.id_unidad][cat]) {
                    newCatalog[p.id_unidad][cat][p.id_programa] = {
                        id: p.id_programa,
                        nombre: p.nombre_programa,
                        descripcion: p.descripcion,
                        link_ws: p.link_ws,
                        perfiles_programa: p.perfiles_programa,
                        malla_curricular: p.malla_curricular
                    };
                }
            }
        });

        cachedCatalog = newCatalog;
        console.log('[Catalog] Supabase data loaded into memory cache.');
    } catch (error) {
        console.error('[Catalog] Exception in initCatalog:', error);
    }
    isFetching = false;
}

// Iniciar actualización cada hora (3600000 ms)
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
 * Busca un programa específico por nombre usando una comparación más flexible.
 */
export const findProgram = (query) => {
    const catalog = getCatalog()
    if (!catalog || !query || query.trim().length < 4) return null

    const queryNorm = normalizeText(query)

    // 1. Coincidencia exacta o contenida (Caso ideal)
    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        const categories = ['maestrias', 'doctorados', 'especialidades']

        for (const cat of categories) {
            if (facultad[cat]) {
                for (const progId in facultad[cat]) {
                    const program = facultad[cat][progId]
                    const progNameNorm = normalizeText(program.nombre)

                    if (queryNorm.includes(progNameNorm) || progNameNorm.includes(queryNorm)) {
                        return { ...program, facultad: facultad.nombre, tipo: cat }
                    }
                }
            }
        }
    }

    // 2. Coincidencia por palabras clave (Fuzzy)
    const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 3)
    if (queryWords.length === 0) return null

    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        const categories = ['maestrias', 'doctorados', 'especialidades']
        for (const cat of categories) {
            if (facultad[cat]) {
                for (const progId in facultad[cat]) {
                    const program = facultad[cat][progId]
                    const progNameLower = program.nombre.toLowerCase()
                    const matchCount = queryWords.filter(word => progNameLower.includes(word)).length

                    // Si coinciden al menos 2 palabras clave significativas
                    if (matchCount >= 2) {
                        return { ...program, facultad: facultad.nombre, tipo: cat }
                    }
                }
            }
        }
    }

    return null
}

/**
 * Busca si el usuario menciona una categoría (maestrías, doctorados, etc.)
 */
export const findCategory = (query) => {
    const queryNorm = normalizeText(query)
    if (queryNorm.includes('maestria')) return 'maestrias'
    if (queryNorm.includes('doctorado')) return 'doctorados'
    if (queryNorm.includes('especialidad')) return 'especialidades'
    return null
}

/**
 * Genera un mensaje con TODOS los programas de una categoría específica.
 */
export const getContextForCategory = (category) => {
    const catalog = getCatalog()
    if (!catalog || !category) return ""

    let ctx = `🎓 *LISTA DE ${category.toUpperCase()} - UNAC*\n\n`
    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        if (facultad[category]) {
            ctx += `🏢 *${facultad.nombre}:*\n`
            Object.values(facultad[category]).forEach(p => ctx += `• ${p.nombre}\n`)
            ctx += `\n`
        }
    }
    ctx += `¿Deseas información de algún programa en específico? ✨`
    return ctx
}

/**
 * Búsqueda ultra-flexible para el envío de brochures (DNI Verification)
 */
export const findProgramFuzzy = (query) => {
    const catalog = getCatalog()
    if (!catalog || !query) return null

    const queryNorm = normalizeText(query)

    // Lista de todos los programas para buscar
    let allPrograms = []
    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        const categories = ['maestrias', 'doctorados', 'especialidades']
        categories.forEach(cat => {
            if (facultad[cat]) {
                Object.values(facultad[cat]).forEach(p => {
                    allPrograms.push({ ...p, facultad: facultad.nombre })
                })
            }
        })
    }

    // 1. Coincidencia por sub-cadena (ignora tildes y mayúsculas)
    const matchSimple = allPrograms.find(p => {
        const nameNorm = normalizeText(p.nombre)
        return nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)
    })
    if (matchSimple) return matchSimple

    // 2. Coincidencia por palabras clave compartidas
    const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 2) // Palabras de 3+ letras
    if (queryWords.length > 0) {
        const matchesByKeyword = allPrograms.map(p => {
            const nameNorm = normalizeText(p.nombre)
            const overlap = queryWords.filter(w => nameNorm.includes(w)).length
            return { program: p, overlap }
        }).filter(m => m.overlap >= 1) // Al menos 1 palabra clave significativa

        if (matchesByKeyword.length > 0) {
            // Devolver el que tenga más coincidencia
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
 * Obtiene solo los nombres de todos los programas en una lista plana (para ahorrar tokens)
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
