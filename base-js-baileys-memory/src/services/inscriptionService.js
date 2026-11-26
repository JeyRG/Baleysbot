import { supabaseData as supabase } from './supabaseClient.js';
import { queryLocalDb, isLocalDbEnabled } from './dbClient.js';

/**
 * Consulta de estado de inscripción y expediente por DNI.
 * Prioriza la base de datos SQL local si está habilitada (USE_LOCAL_DB=true)
 * usando un único LEFT JOIN parametrizado y realiza fallback transparente a Supabase.
 */
export const checkInscriptionByDni = async (dni, deps = {}) => {
    const cleanDni = String(dni || '').trim().replace(/\D/g, '');
    if (!cleanDni || cleanDni.length < 8) {
        return { error: 'Por favor, proporciona un número de DNI válido (mínimo 8 dígitos).' };
    }

    const localEnabled = deps.isLocalDbEnabled ? deps.isLocalDbEnabled() : isLocalDbEnabled();
    const runLocalQuery = deps.queryLocalDb || queryLocalDb;
    const sbClient = deps.supabase || supabase;

    try {
        if (localEnabled) {
            return await checkInscriptionLocal(cleanDni, runLocalQuery);
        } else {
            return await checkInscriptionSupabase(cleanDni, sbClient);
        }
    } catch (err) {
        console.error('[InscriptionService] Error consultando inscripción local:', err.message);
        try {
            console.log('[InscriptionService] Intentando fallback a Supabase...');
            return await checkInscriptionSupabase(cleanDni, sbClient);
        } catch {
            return { error: 'Ocurrió un error al consultar el sistema de inscripciones. Inténtalo más tarde.' };
        }
    }
};

/**
 * Consulta optimizada en 1 solo roundtrip SQL con LEFT JOIN y parámetros seguros
 */
export async function checkInscriptionLocal(dni, runQuery = queryLocalDb) {
    const { rows } = await runQuery(
        `SELECT
            p.id_persona,
            p.nombres,
            p.apellidos,
            i.id_inscrito,
            i.id_programa,
            i.fecha_registro,
            pr.nombre_programa,
            po.id_inscrito AS postulante_inscrito_id,
            po.mensaje_estado,
            po.id_estadoseguimiento
         FROM personas p
         LEFT JOIN inscripciones i ON i.id_persona = p.id_persona
         LEFT JOIN programas pr ON pr.id_programa = i.id_programa
         LEFT JOIN postulantes po ON po.id_inscrito = i.id_inscrito
         WHERE p.dni = $1
         ORDER BY i.fecha_registro DESC
         LIMIT 1`,
        [dni]
    );

    if (!rows || rows.length === 0) {
        return {
            error: '❌ No encontré ninguna persona con ese DNI en nuestra base de datos. Si deseas postular y aún no te has inscrito, puedes pedirme los *pasos de inscripción*.'
        };
    }

    const row = rows[0];

    if (!row.id_inscrito) {
        return {
            error: `Hola ${row.nombres}, estás registrado pero aún no tienes una inscripción a un programa activa. Pídeme los *pasos de inscripción* para orientarte.`
        };
    }

    const tieneExpediente = row.postulante_inscrito_id !== null && row.postulante_inscrito_id !== undefined;

    return {
        success: true,
        nombres: row.nombres,
        apellidos: row.apellidos,
        programa: row.nombre_programa || 'Programa desconocido',
        tieneExpediente,
        idEstadoSeguimiento: tieneExpediente ? row.id_estadoseguimiento : null,
        mensajeExpediente: tieneExpediente ? (row.mensaje_estado || '') : ''
    };
}

/**
 * Consulta en Supabase (modo original / fallback)
 */
async function checkInscriptionSupabase(dni, sbClient = supabase) {
    const { data: personas, error: errP } = await sbClient
        .from('personas')
        .select('id_persona, nombres, apellidos')
        .eq('dni', dni);

    if (errP || !personas || personas.length === 0) {
        return {
            error: '❌ No encontré ninguna persona con ese DNI en nuestra base de datos. Si deseas postular y aún no te has inscrito, puedes pedirme los *pasos de inscripción*.'
        };
    }
    const persona = personas[0];

    const { data: inscripciones, error: errI } = await sbClient
        .from('inscripciones')
        .select('id_inscrito, id_programa, fecha_registro')
        .eq('id_persona', persona.id_persona)
        .order('fecha_registro', { ascending: false })
        .limit(1);

    if (errI || !inscripciones || inscripciones.length === 0) {
        return {
            error: `Hola ${persona.nombres}, estás registrado pero aún no tienes una inscripción a un programa activa. Pídeme los *pasos de inscripción* para orientarte.`
        };
    }
    const inscripcion = inscripciones[0];

    const { data: programas } = await sbClient
        .from('programas')
        .select('nombre_programa')
        .eq('id_programa', inscripcion.id_programa)
        .maybeSingle();

    const nombrePrograma = programas ? programas.nombre_programa : 'Programa desconocido';

    const { data: postulantes } = await sbClient
        .from('postulantes')
        .select('mensaje_estado, id_estadoseguimiento')
        .eq('id_inscrito', inscripcion.id_inscrito);

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
