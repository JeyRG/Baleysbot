import { addKeyword, EVENTS } from '@builderbot/bot';
import { getTipoProgramaInfo } from '../services/catalogService.js';
import { saveUser } from '../services/userService.js';
import { getBotSettings, buildAdmissionStepsMessage } from '../services/settingsService.js';
import { shouldBlockAutomatedFlow, clearConversationMemory } from '../services/flowGuardService.js';

/**
 * Flujo para restablecer o reiniciar datos de perfil del usuario.
 * Respeta estrictamente el modo human_active para no secuestrar conversaciones tomadas por un asesor.
 */
export const resetFlow = addKeyword(['reiniciar', 'reset', 'configurar', 'borrar'])
    .addAction(async (ctx, { flowDynamic, endFlow }) => {
        const guard = await shouldBlockAutomatedFlow(ctx.from, flowDynamic);
        if (guard.blocked) return endFlow();

        saveUser(ctx.from, {
            nombre: null,
            esperandoNombre: true,
            rol: null,
            esperandoRol: false,
            esperandoConfirmacionAsesor: false,
            pendingInitialQuery: null
        });
        clearConversationMemory(ctx.from);

        return await flowDynamic('🚀 Entendido. He restablecido tus datos de atención. ¿Cuál es tu *nombre completo* para empezar? ✍️');
    });

/**
 * Flujo para capturar multimedia entrante
 */
export const mediaFlow = addKeyword(EVENTS.MEDIA)
    .addAction(async (ctx) => {
        console.log(`[Bot] Multimedia recibida de ${ctx.from}.`);
    });

/**
 * Flujo informativo de pasos para inscribirse (alimentado dinámicamente desde bot_settings)
 */
export const flowPasosInscripcion = addKeyword([
    'pasos', 'inscribirme', 'inscribirse', 'proceso', 'como hago para inscribirme', 'como me inscribo'
], { regex: false })
    .addAction(async (ctx, { flowDynamic, endFlow }) => {
        const guard = await shouldBlockAutomatedFlow(ctx.from, flowDynamic);
        if (guard.blocked) return endFlow();

        const respuesta = buildAdmissionStepsMessage(getTipoProgramaInfo);
        return await flowDynamic(respuesta);
    });

/**
 * Flujo informativo sobre examen / evaluación de admisión (alimentado desde bot_settings)
 */
export const flowExamenAdmision = addKeyword([
    'examen', 'evaluacion', 'entrevista', 'en que consiste el examen', 'como es el examen', 'hay examen', 'en que consiste la evaluacion'
], { regex: false })
    .addAction(async (ctx, { flowDynamic, endFlow }) => {
        const guard = await shouldBlockAutomatedFlow(ctx.from, flowDynamic);
        if (guard.blocked) return endFlow();

        const s = getBotSettings();
        const respuesta = `📝 *Sobre la Evaluación de Admisión (${s.admision.proceso_actual}) - Posgrado UNAC*

${s.admision.nota_evaluacion}

1️⃣ *Evaluación de Expediente:* Revisión de tu CV y documentos cargados en la plataforma GED (${s.enlaces.portal_ged}).
2️⃣ *Entrevista / Evaluación:* ${s.admision.fecha_entrevistas}.

🗓️ *Cierre de inscripciones:* ${s.admision.cierre_inscripciones}
🎒 *Inicio de clases:* ${s.admision.inicio_clases}

¿Te gustaría que te envíe los pasos detallados para iniciar tu inscripción? 🎓`;

        return await flowDynamic(respuesta);
    });
