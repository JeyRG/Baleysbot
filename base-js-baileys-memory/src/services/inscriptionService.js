import { supabaseData as supabase } from './supabaseClient.js'

export const checkInscriptionByDni = async (dni) => {
    try {
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
        const { data: postulantes, error: errPost } = await supabase
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
    } catch (error) {
        console.error('[InscriptionService] Error:', error);
        return { error: 'Ocurrió un error al consultar la base de datos.' };
    }
}
