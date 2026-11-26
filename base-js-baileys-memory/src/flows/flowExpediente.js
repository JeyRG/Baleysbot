import { addKeyword, EVENTS } from '@builderbot/bot';
import { checkInscriptionByDni } from '../services/inscriptionService.js';
import { findProgramFuzzy, getTipoProgramaInfo } from '../services/catalogService.js';
import { getBotSettings, buildAdmissionStepsMessage } from '../services/settingsService.js';

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Flujo Unificado de Verificación de Expediente e Inscripción (MySQL Posgrado UNAC)
 */
export const flowExpedienteProcesar = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { state, flowDynamic, provider }) => {
        const s = await state.getMyState() || {};
        const dni = s.dni;
        const settings = getBotSettings();

        await flowDynamic('⏳ Consultando tu expediente en nuestra base de datos... un momento.');

        const result = await checkInscriptionByDni(dni);
        if (result.error) {
            await flowDynamic(`❌ ${result.error}`);
            return;
        }

        await flowDynamic([
            `✅ ¡Hola *${result.nombres} ${result.apellidos}*!`,
            `🎓 Estás correctamente inscrito(a) en:\n*${result.programa}*`
        ]);

        if (!result.tieneExpediente) {
            await flowDynamic([
                '⚠️ *FALTA SUBIR TU CARPETA DE POSTULANTE*',
                'Para continuar con tu proceso, debes subir tus documentos.',
                buildAdmissionStepsMessage(getTipoProgramaInfo)
            ]);
        } else {
            const estado = String(result.idEstadoSeguimiento);
            if (estado === '2') { // Observado
                await flowDynamic([
                    '❌ *TU EXPEDIENTE TIENE UNA OBSERVACIÓN*',
                    `*Detalle:* ${result.mensajeExpediente || 'Documentos incorrectos o ilegibles.'}`,
                    `👉 *Acción requerida:* Ingresa nuevamente a la plataforma GED (${settings.enlaces.portal_ged}) y corrige los documentos observados.`
                ]);
            } else if (estado === '3') { // Aceptado / Correcto
                await flowDynamic([
                    '🎉 *¡TU EXPEDIENTE ESTÁ CORRECTO!*',
                    'Tus documentos han sido aceptados.',
                    `👉 *Siguiente paso:* Ingresa al sistema GED (${settings.enlaces.portal_ged}) para obtener el enlace y unirte al *Grupo de WhatsApp* de tu programa.`
                ]);
            } else if (estado === '1' || estado === '4') { // Pendiente / En Evaluación
                await flowDynamic([
                    '⏳ *TU EXPEDIENTE ESTÁ EN EVALUACIÓN*',
                    'Tu carpeta de postulante ya fue enviada y se encuentra a la espera de revisión.',
                    '👉 Por favor, ten paciencia. Te notificaremos o puedes volver a consultar tu estado más adelante.'
                ]);

                const targetProgram = findProgramFuzzy(result.programa);
                if (targetProgram && (targetProgram.brochureUrl || targetProgram.brochure)) {
                    const urlPDF = targetProgram.brochureUrl || targetProgram.brochure;
                    await delay(1500);
                    await provider.sendMessage(ctx.from, `📄 Te adjunto el brochure oficial de tu programa:`, {
                        media: urlPDF,
                        fileName: `brochure-${targetProgram.nombre}.pdf`.replace(/\s+/g, '_')
                    });
                }
            } else {
                await flowDynamic([
                    '📄 *Estado de tu expediente:*',
                    result.mensajeExpediente || 'En proceso de revisión.'
                ]);
            }
        }
    });
