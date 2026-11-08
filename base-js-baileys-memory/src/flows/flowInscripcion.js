import { addKeyword, EVENTS } from '@builderbot/bot';
import { supabase } from '../services/supabaseClient.js';
import { getTipoProgramaInfo } from '../services/catalogService.js';
import { saveUser } from '../services/userService.js';

/**
 * Flujo para restablecer o reiniciar conversación
 */
export const resetFlow = addKeyword(['reiniciar', 'reset', 'configurar', 'borrar'])
    .addAction(async (ctx, { flowDynamic }) => {
        saveUser(ctx.from, {
            nombre: null,
            esperandoNombre: true,
            rol: null,
            esperandoRol: false,
            esperandoConfirmacionAsesor: false
        });

        try {
            await supabase.from('conversations').update({ status: 'bot' }).eq('wa_id', ctx.from);
            console.log(`[Bot] ${ctx.from} fue devuelto a modo automático (bot).`);
        } catch (e) {
            console.error('[Bot] Error al restablecer modo manual:', e);
        }

        await flowDynamic('🚀 Entendido. He borrado tus datos. ¿Cuál es tu *nombre completo* para empezar? ✍️');
    });

/**
 * Flujo de Solicitud de Asesor Humano (Handoff)
 */
export const solicitudAsesorFlow = addKeyword(['SOLICITUD_ASESOR_MANUAL', 'SOLICITUD_ASESOR', 'asesor', 'ayuda humana', 'hablar con alguien'])
    .addAction(async (ctx, { flowDynamic }) => {
        const userId = ctx.from;
        console.log(`[Handoff] Usuario ${userId} solicitó asesor humano.`);

        try {
            await supabase
                .from('conversations')
                .update({ status: 'human_active', updated_at: new Date().toISOString() })
                .eq('wa_id', userId);

            await flowDynamic([
                '👨‍💼 *Entendido. He transferido tu solicitud a un asesor humano.*',
                'Uno de nuestros coordinadores se comunicará contigo en los próximos minutos para ayudarte personalmente. Mientras tanto, puedes dejar tu consulta detallada aquí. 👇'
            ]);
        } catch (e) {
            console.error('[Handoff] Error al activar modo manual:', e);
            await flowDynamic('Lo siento, tuve un problema al procesar tu solicitud. Por favor, intenta de nuevo en unos momentos.');
        }
    });

/**
 * Flujo para capturar multimedia entrante
 */
export const mediaFlow = addKeyword(EVENTS.MEDIA)
    .addAction(async (ctx) => {
        console.log(`[Bot] Multimedia recibida de ${ctx.from}.`);
    });

/**
 * Flujo informativo de pasos para inscribirse
 */
export const flowPasosInscripcion = addKeyword([
    'pasos', 'inscribirme', 'inscribirse', 'proceso', 'como hago para inscribirme', 'como me inscribo'
], { regex: false })
    .addAction(async (ctx, { flowDynamic }) => {
        const infoM = getTipoProgramaInfo('maestrias');
        const infoD = getTipoProgramaInfo('doctorados');
        const infoE = getTipoProgramaInfo('especialidades');

        const costoM = infoM?.costos || 'S/ 200';
        const costoD = infoD?.costos || 'S/ 250';
        const costoE = infoE?.costos || 'S/ 120';
        const cuenta = infoM?.numero_cuenta || '000-3747336\n**CCI:** 009-100-000003747336-90';

        const respuesta = `📌 **¡Paso a paso para completar tu proceso de admisión!** 🎓✨

**1️⃣ Realiza tu inscripción**
Ingresa al siguiente enlace y completa tu registro con tus datos:
👉 https://posgradounac.edu.pe/INSCRIPCION/

**2️⃣ Realiza el pago por derecho de admisión** 💳

El monto dependerá del programa al que postulas:
🎓 **Maestría:** ${costoM}
📘 **Segunda Especialidad:** ${costoE}
🎖️ **Doctorado:** ${costoD}

💥 **Datos de la cuenta bancaria:**
🏦 **Banco:** Scotiabank
**Cuenta:** ${cuenta}

ÚNETE A NUESTRO GRUPO DE WHATSAPP PARA EL PROCESO DE ADMISION 2026-II
👉https://chat.whatsapp.com/DyKT9mklDUa8CrlemeJorl

⚠️ Guarda tu voucher de pago, ya que lo necesitarás para el siguiente paso.

**3️⃣ Revisa los requisitos de admisión** 📄

Verifica la documentación que debes presentar según el programa al que postulas:
👉 https://posgradounac.edu.pe/Admision/requisitos/requisitos_admision.php

**4️⃣ Sube tu expediente digital (GED)** 💻

Cuando tengas todos tus documentos listos, ingresa a la plataforma GED para cargar tu carpeta digital:
👉 https://posgradounac.edu.pe/GED/login.php

Solo necesitarás tu **DNI**, siempre que ya hayas realizado tu inscripción.

**5️⃣ Verifica el estado de tu carpeta** ✅

Finalmente, ingresa periódicamente a la plataforma GED para revisar el estado de tu expediente y verificar si tu documentación ha sido validada o si existe alguna observación por corregir.`;

        return await flowDynamic(respuesta);
    });

/**
 * Flujo informativo sobre examen / evaluación de admisión
 */
export const flowExamenAdmision = addKeyword([
    'examen', 'evaluacion', 'entrevista', 'en que consiste el examen', 'como es el examen', 'hay examen', 'en que consiste la evaluacion'
], { regex: false })
    .addAction(async (ctx, { flowDynamic }) => {
        const respuesta = `📝 *Sobre la Evaluación de Admisión - Posgrado UNAC*

Te comento que nuestro proceso de admisión *no es un examen escrito tradicional ni descalificatorio*. Consiste en dos etapas sencillas:

1️⃣ *Evaluación de Expediente:* Revisamos tu CV y los documentos que subas a la plataforma GED.
2️⃣ *Entrevista Personal:* Una breve charla virtual para conocer tu perfil y expectativas.

🗓️ *Fechas clave:* Las entrevistas se llevarán a cabo los últimos días de marzo del 2027.

¿Te gustaría que te envíe los pasos para iniciar tu inscripción? 🎓`;

        return await flowDynamic(respuesta);
    });
