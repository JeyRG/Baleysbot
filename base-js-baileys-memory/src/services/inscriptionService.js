import { supabaseData as supabase } from './supabaseClient.js';
import { queryLocalDb, isLocalDbEnabled } from './dbClient.js';

/**
 * Consulta de estado de inscripción y expediente por DNI.
 * Prioriza la base de datos SQL local si está habilitada (USE_LOCAL_DB=true)
 * y realiza fallback seguro y transparente a Supabase si no lo está.
 * Cumple estrictamente con la parametrización de consultas para evitar SQLi.
 */
export const checkInscriptionByDni = async (dni) => {
    // Sanitización básica de entrada: DNI solo dígitos
    const cleanDni = String(dni || '').trim().replace(/\D/g, '');
    if (!cleanDni || cleanDni.length < 8) {
        return { error: 'Por favor, proporciona un número de DNI válido (mínimo 8 dígitos).' };
    }

    try {
        if (isLocalDbEnabled()) {
            return await checkInscriptionLocal(cleanDni);
        } else {
            return await checkInscriptionSupabase(cleanDni);
        }
    } catch (err) {
        console.error('[InscriptionService] Error consultando inscripción:', err.message);
        // Fallback a Supabase si falla la base local
        try {
            console.log('[InscriptionService] Intentando fallback a Supabase...');
            return await checkInscriptionSupabase(cleanDni);
        } catch (fbErr) {
            return { error: 'Ocurrió un error al consultar el sistema de inscripciones. Inténtalo más tarde.' };
        }
    }
};

/**
 * Consulta optimizada y parametrizada en Servidor SQL Local
 */
async function checkInscriptionLocal(dni) {
    // 1. Buscar persona
    const { rows: personas } = await queryLocalDb(
        'SELECT id_persona, nombres, apellidos FROM personas WHERE dni = $1 LIMIT 1',
        [dni]
    );

    if (!personas || personas.length === 0) {
        return { error: '❌ No encontré ninguna persona con ese DNI en nuestra base de datos. Si deseas postular y aún no te has inscrito, puedes pedirme los *pasos de inscripción*.' };
    }
    const persona = personas[0];

    // 2. Buscar inscripción
    const { rows: inscripciones } = await queryLocalDb(
        `SELECT id_inscrito, id_programa, fecha_registro 
         FROM inscripciones 
         WHERE id_persona = $1 
         ORDER BY fecha_registro DESC LIMIT 1`,
        [persona.id_persona]
    );

    if (!inscripciones || inscripciones.length === 0) {
        return { error: `Hola ${persona.nombres}, estás registrado pero aún no tienes una inscripción a un programa activa. Pídeme los *pasos de inscripción* para orientarte.` };
    }
    const inscripcion = inscripciones[0];

    // 3. Obtener nombre del programa
    let nombrePrograma = 'Programa desconocido';
    if (inscripcion.id_programa) {
        const { rows: programas } = await queryLocalDb(
            'SELECT nombre_programa FROM programas WHERE id_programa = $1 LIMIT 1',
            [inscripcion.id_programa]
        );
        if (programas && programas.length > 0) {
            nombrePrograma = programas[0].nombre_programa;
        }
    }

    // 4. Buscar expediente en postulantes
    const { rows: postulantes } = await queryLocalDb(
        'SELECT mensaje_estado, id_estadoseguimiento FROM postulantes WHERE id_inscrito = $1 LIMIT 1',
        [inscripcion.id_inscrito]
    );

    let tieneExpediente = false;
    let idEstadoSeguimiento = null;
    let mensajeExpediente = '';

    if (postulantes && postulantes.length > 0) {
        tieneExpediente = true;
        idEstadoSeguimiento = postulantes[0].id_estadoseguimiento;
        mensajeExpediente = postulantes[0].mensaje_estado || '';
    }

    return {
        success: true,
        nombres: persona.nombres,
        apellidos: persona.apellidos,
        programa: nombrePrograma,
        tieneExpediente,
        idEstadoSeguimiento,
        mensajeExpediente
    };
}

/**
 * Consulta en Supabase (modo original/fallback)
 */
async function checkInscriptionSupabase(dni) {
    // 1. Buscar persona
    const { data: personas, error: errP } = await supabase
        .from('personas')
        .select('id_persona, nombres, apellidos')
        .eq('dni', dni);
        
    if (errP || !personas || personas.length === 0) {
        return { error: '❌ No encontré ninguna persona con ese DNI en nuestra base de datos. Si deseas postular y aún no te has inscrito, puedes pedirme los *pasos de inscripción*.' };
    }
    const persona = personas[0];

    // 2. Buscar inscripción
    const { data: inscripciones, error: errI } = await supabase
        .from('inscripciones')
        .select('id_inscrito, id_programa, fecha_registro')
        .eq('id_persona', persona.id_persona)
        .order('fecha_registro', { ascending: false })
        .limit(1);

    if (errI || !inscripciones || inscripciones.length === 0) {
        return { error: `Hola ${persona.nombres}, estás registrado pero aún no tienes una inscripción a un programa activa. Pídeme los *pasos de inscripción* para orientarte.` };
    }
    const inscripcion = inscripciones[0];

    // 3. Obtener nombre del programa
    const { data: programas } = await supabase
        .from('programas')
        .select('nombre_programa')
        .eq('id_programa', inscripcion.id_programa)
        .single();

    const nombrePrograma = programas ? programas.nombre_programa : 'Programa desconocido';

    // 4. Buscar estado del expediente en la tabla postulantes
    const { data: postulantes } = await supabase
        .from('postulantes')
        .select('mensaje_estado, id_estadoseguimiento')
        .eq('id_inscrito', inscripcion.id_inscrito);

    let tieneExpediente = false;
    let idEstadoSeguimiento = null;
    let mensajeExpediente = '';

    if (postulantes && postulantes.length > 0) {
        tieneExpediente = true;
        const postulante = postulantes[0];
        idEstadoSeguimiento = postulante.id_estadoseguimiento;
        mensajeExpediente = postulante.mensaje_estado || '';
    }

    return {
        success: true,
        nombres: persona.nombres,
        apellidos: persona.apellidos,
        programa: nombrePrograma,
        tieneExpediente,
        idEstadoSeguimiento,
        mensajeExpediente
    };
}
