import fs from 'fs'
import path from 'path'

const PROGRAMAS_PATH = path.join(process.cwd(), 'programas.json')

const normalizeText = (text) => {
    if (!text) return ""
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

/**
 * Carga el catálogo de programas desde el archivo JSON.
 */
export const getCatalog = () => {
    try {
        const data = fs.readFileSync(PROGRAMAS_PATH, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        console.error('[Catalog] Error al cargar programas.json:', error)
        return null
    }
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
 * Genera un contexto con TODOS los programas de una categoría específica.
 */
export const getContextForCategory = (category) => {
    const catalog = getCatalog()
    if (!catalog || !category) return ""

    let ctx = `Lista de ${category.toUpperCase()}:\n`
    for (const facultyId in catalog) {
        const facultad = catalog[facultyId]
        if (facultad[category]) {
            ctx += `*${facultad.nombre}:*\n`
            Object.values(facultad[category]).forEach(p => ctx += `- ${p.nombre}\n`)
        }
    }
    return ctx
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
