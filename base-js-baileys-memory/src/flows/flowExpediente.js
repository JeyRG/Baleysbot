import { addKeyword, EVENTS } from '@builderbot/bot';
import { checkInscriptionByDni } from '../services/inscriptionService.js';
import { findProgramFuzzy } from '../services/catalogService.js';

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Flujo Unificado de Verificación de Expediente e Inscripción (MySQL Posgrado UNAC)
 */
export const flowExpedienteProcesar = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { state, flowDynamic, provider }) => {
        const s = await state.getMyState() || {};
        const dni = s.dni;

        await flowDynamic('⏳ Consultando tu expediente en nuestra base de datos... un momento.');

        const result = await checkInscriptionByDni(dni);
        if (result.error) {
            await flowDynamic(`❌ ${result.error}`);
            return;
        }

        // Saludo inicial y confirmación de inscripción
        await flowDynamic([
            `✅ ¡Hola *${result.nombres} ${result.apellidos}*!`,
            `🎓 Estás correctamente inscrito(a) en:\n*${result.programa}*`
        ]);

        // Lógica de Expediente (Carpeta de Postulante)
        if (!result.tieneExpediente) {
            await flowDynamic([
                '⚠️ *FALTA SUBIR TU CARPETA DE POSTULANTE*',
                'Para continuar con tu proceso, debes subir tus documentos.',
                `📌 **¡Sigue estos pasos para completar tu proceso de admisión!** 🎓✨

**1️⃣ ÚNETE A NUESTRO GRUPO DE WHATSAPP PARA EL PROCESO DE ADMISION 2026-II**
Ingresa al siguiente enlace y completa tu registro con tus datos:
👉https://chat.whatsapp.com/L3SLkM8yYgw2iCfcAOEzYI?s=cl&p=a&mlu=4&ilr=4

**2️⃣ Realiza el pago por derecho de admisión** 💳

El monto dependerá del programa al que postulas:
🎓 **Maestría:** S/ 200
📘 **Segunda Especialidad:** S/ 120
🎖️ **Doctorado:** S/ 250

💥 **Datos de la cuenta bancaria:**
🏦 **Banco:** Scotiabank
**Cuenta:** 000-3747336
**CCI:** 009-100-000003747336-90

⚠️ Guarda tu voucher de pago, ya que lo necesitarás para el siguiente paso.

**3️⃣ Revisa los requisitos de admisión** 📄

Verifica la documentación que debes presentar según el programa al que postulas:
👉 https://posgradounac.edu.pe/Admision/requisitos/requisitos_admision.php

**4️⃣ Sube tu expediente digital (GED)** 💻

Cuando tengas todos tus documentos listos, ingresa a la plataforma GED para cargar tu carpeta digital:
👉 https://posgradounac.edu.pe/GED/login.php

Solo necesitarás tu **DNI**, siempre que ya hayas realizado tu inscripción.

**5️⃣ Verifica el estado de tu carpeta** ✅

Finalmente, ingresa periódicamente a la plataforma GED para revisar el estado de tu expediente y verificar si tu documentación ha sido validada o si existe alguna observación por corregir. Si quiere una atención más personalizada puede comunicarse con el 900969591`
            ]);
        } else {
            const estado = String(result.idEstadoSeguimiento);
            if (estado === '2') { // Observado
                await flowDynamic([
                    '❌ *TU EXPEDIENTE TIENE UNA OBSERVACIÓN*',
                    `*Detalle:* ${result.mensajeExpediente || 'Documentos incorrectos o ilegibles.'}`,
                    '👉 *Acción requerida:* Ingresa de nuevo al sistema (https://posgradounac.edu.pe/GED/) y corrige los documentos observados.'
                ]);
            } else if (estado === '3') { // Aceptado / Correcto
                await flowDynamic([
                    '🎉 *¡TU EXPEDIENTE ESTÁ CORRECTO!*',
                    'Tus documentos han sido aceptados.',
                    '👉 *Siguiente paso:* Ingresa al sistema (https://posgradounac.edu.pe/GED/) para obtener el enlace y unirte al *Grupo de WhatsApp* de tu programa.'
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
