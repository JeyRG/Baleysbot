import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import cors from 'cors'
import express from 'express'
import { join } from 'path'
import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import { getGrokCompletion as originalGetGrokCompletion } from './grokClient.js'

// Servicios
import { supabase } from './services/supabaseClient.js'
import { getEmbedding } from './services/embeddingService.js'
import { findProgram, getSummaryContext, findFaculty, getContextForFaculty, findCategory, getContextForCategory, getAllProgramNamesOnly, findProgramFuzzy } from './services/catalogService.js'
import { getRAGContext } from './services/knowledgeService.js'

// Handlers globales
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));


const PORT = process.env.PORT ?? 3000
const USER_DATA_PATH = path.join(process.cwd(), 'user_data.json')
const pendingTimers = new Map();

// Gestión de persistencia local
const loadUsers = () => {
    try {
        if (fs.existsSync(USER_DATA_PATH)) return JSON.parse(fs.readFileSync(USER_DATA_PATH, 'utf8'))
    } catch (e) { console.error('[Bot] Error al cargar user_data:', e) }
    return {}
}

const saveUser = (id, data) => {
    try {
        const users = loadUsers()
        users[id] = { ...users[id], ...data }
        fs.writeFileSync(USER_DATA_PATH, JSON.stringify(users, null, 2))
    } catch (e) { console.error('[Bot] Error al guardar user_data:', e) }
}

const loadUserData = (id) => loadUsers()[id] || {};

/**
 * Gestión persistente del contador de leads diarios
 */
const COUNTER_PATH = path.join(process.cwd(), 'leads_counter.json');

const getLeadsCounter = () => {
    try {
        if (!fs.existsSync(COUNTER_PATH)) return { date: new Date().toISOString().split('T')[0], count: 0 };
        const data = JSON.parse(fs.readFileSync(COUNTER_PATH, 'utf8'));
        const today = new Date().toISOString().split('T')[0];
        if (data.date !== today) return { date: today, count: 0 };
        return data;
    } catch (e) { return { date: new Date().toISOString().split('T')[0], count: 0 }; }
};

const incrementLeadsCounter = (limit = 50) => {
    const data = getLeadsCounter();
    if (data.count >= limit) return -1; // Indicar límite alcanzado
    data.count++;
    fs.writeFileSync(COUNTER_PATH, JSON.stringify(data), 'utf8');
    return data.count;
};

/**
 * Lógica de Caché Semántico
 */
const checkSemanticCache = async (embedding) => {
    try {
        const { data, error } = await supabase.rpc('match_semantic_cache', {
            query_embedding: embedding,
            match_threshold: 0.95,
        })
        if (error) throw error
        return data?.[0]?.answer || null
    } catch (e) {
        console.error('[Cache] Error:', e)
        return null
    }
}

const saveToCache = async (question, answer, embedding) => {
    try {
        await supabase.from('semantic_cache').insert({
            question,
            answer,
            embedding
        })
    } catch (e) { console.error('[Cache] Error al guardar:', e) }
}

/**
 * Wrapper para Grok con RAG Dinámico
 */
const getGrokCompletion = async (userName, message, context = '') => {
    try {
        const systemPrompt = `Eres el Asesor Académico de la Escuela de Posgrado de la Universidad Nacional del Callao (UNAC), PERÚ. 🇵🇪✨
REGLAS:
- Responde de forma BREVE (máx 2 párrafos cortos). Usa emojis.
- Usa EXCLUSIVAMENTE la información del "Contexto" si está disponible.
- Si el "Contexto" menciona costos o fechas, úsalos.
- NO menciones otras universidades como la Autónoma de Chiriquí. Eres la UNAC del CALLAO, PERÚ.
- NO envíes PDFs proactivamente. Pregunta primero. 📄
- Si no sabes la respuesta o piden humano, responde con el código: [SOLICITUD_ASESOR]
Contexto: ${context}`

        const grokResponse = await originalGetGrokCompletion([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
        ]);
        return grokResponse.choices?.[0]?.message?.content || null;
    } catch (e) {
        console.error('[Grok] Error:', e);
        return null;
    }
}

// FLUJOS
const resetFlow = addKeyword(['reiniciar', 'reset', 'configurar', 'borrar'])
    .addAction(async (ctx, { flowDynamic }) => {
        saveUser(ctx.from, { nombre: null, esperandoNombre: true })
        try {
            await supabase.from('semantic_cache').delete().neq('id', 0)
            console.log('[Cache] Memoria semántica limpiada por comando de reinicio.');
        } catch (e) { console.error('[Cache] Error al limpiar:', e) }
        await flowDynamic('🚀 Entendido. He borrado tus datos y limpiado mi memoria de respuestas anteriores. ¿Cuál es tu nombre completo para empezar?')
    });

/**
 * Flujo de Solicitud de Asesor Humano
 */
const solicitudAsesorFlow = addKeyword(['SOLICITUD_ASESOR_MANUAL', 'SOLICITUD_ASESOR', 'asesor', 'ayuda humana', 'hablar con alguien'])
    .addAction(async (ctx, { provider, flowDynamic }) => {
        const userId = ctx.from;
        console.log(`[Handoff] Usuario ${userId} solicitó asesor humano.`);

        try {
            // 1. Marcar en la base de datos
            await supabase
                .from('conversations')
                .update({ status: 'human_active', updated_at: new Date().toISOString() })
                .eq('wa_id', userId);

            // 2. Notificar al usuario
            await flowDynamic([
                '👨‍💻 *Entendido. He solicitado la intervención de un asesor humano.*',
                'En breve uno de nuestros coordinadores se unirá al chat para ayudarte personalmente. Mientras tanto, puedes dejar tu consulta aquí. 👇'
            ]);
        } catch (e) {
            console.error('[Handoff] Error al activar modo manual:', e);
            await flowDynamic('Lo siento, tuve un problema al procesar tu solicitud. Por favor, intenta de nuevo en unos momentos.');
        }
    });

/**
 * FLUJO PARA CAPTURAR MULTIMEDIA ENTRANTE (DASHBOARD)
 */
const mediaFlow = addKeyword(EVENTS.MEDIA)
    .addAction(async (ctx) => {
        console.log(`[Bot] Multimedia recibida de ${ctx.from}.`);

    });

// Ayuda de retardo
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * LÓGICA DE ENVÍO AUTOMATIZADO (Post-Verificación)
 */
async function procesarEnvioMensaje(target, nombre, facultad, programa, provider) {
    try {
        console.log(`[Flow] Preparando envío para: ${nombre} - Programa: "${programa}"`);
        if (!provider || typeof provider.sendMessage !== 'function') {
            console.error('[Flow] ❌ El objeto provider/bot no es válido o no tiene sendMessage');
        }
        const numero = target;

        // 1. Determinar el link del grupo (Misma lógica simple)
        let groupLink = 'https://chat.whatsapp.com/DyKT9mklDUa8CrlemeJorl'; // Default
        const p = programa.toLowerCase();
        if (p.includes('maestria')) groupLink = 'https://chat.whatsapp.com/DyKT9mklDUa8CrlemeJorl';
        else if (p.includes('doctorado')) groupLink = 'https://chat.whatsapp.com/DyKT9mklDUa8CrlemeJorl';

        // 2. Información base
        let precio = 'S/ 200'; let duracion = '3 ciclos'; let cuenta = '000-3747336'; let cci = '009-100-000003747336-90'; let costo = 'S/ 2100';
        let reqDoc = 'Copia del Grado Académico de Bachiller.';
        let matricula = 'S/ 100';

        if (p.includes('doctorado')) {
            precio = 'S/ 250'; duracion = '6 ciclos'; cuenta = '000-3747336'; cci = '009-100-000003747336-90'; costo = 'S/ 2100';
            reqDoc = 'Copia del Grado Académico de Maestro, Constancia de egresado de la Maestría o Certificado de Estudios de la Maestría. ';
            matricula = 'S/ 100';
        } else if (p.includes('especialidad')) {
            precio = 'S/ 120'; duracion = '2 semestres'; cuenta = '000-1797042'; cci = '009-100-000001797042-97'; costo = 'S/ 1400';
            reqDoc = 'Copia del Título Profesional universitario.';
            matricula = 'S/ 200';
        }

        // 1. Bienvenida
        const saludo = `🎓 ¡Hola ${nombre}! Felicidades.\n*Somos de la Escuela de Posgrado de la UNAC*\n🚀 Ya te encuentras registrado para nuestro programa de *${programa}*.`;
        await provider.sendMessage(numero, saludo, {});
        await delay(3000);

        const infoText = `💥 *Detalles del Programa:*
📌 Inscripción: ${precio}
🏦 Banco: Scotiabank (Cta: ${cuenta} / CCI: ${cci})
⏳ Duración: ${duracion}
📌 Matricula: ${matricula}
💵 Costo Semestre: ${costo}

📅 *Fechas Clave:*
🖋 Inscripciones: Hasta el 10 de Agosto del 2026
📍 Exámen de Admisión: 19 y 20 de Agosto del 2026
🎒 Inicio Clases: 1 Setiembre del 2026

📍 *Modalidad:*
Presencial con Herramientas Tecnológicas (80% virtual / 20% presencial).
Asistencia 1 vez al mes (Clase híbrida).
🎓 El grado sale con modalidad *PRESENCIAL*.

🔗 *Únete al grupo de WhatsApp oficial:*
${groupLink}`;

        await provider.sendMessage(numero, infoText, {});
        await delay(2000);

        const requirementsText = `📝 *REQUISITOS DE INSCRIPCIÓN:*
1️⃣ Ficha de Postulante y Hoja de Vida del Postulante llenados de manera virtual a través de nuestro sistema.
2️⃣ Copia legible del DNI o Pasaporte.
3️⃣ Foto actual a color (opcional).
4️⃣ ${reqDoc}

*Nota:* Los grados del extranjero deben estar registrados en SUNEDU.`;

        await provider.sendMessage(numero, requirementsText, {});
        await delay(3000);

        // 3. Enviar Brochure (Si existe)
        console.log(`[Flow] Buscando brochure para: "${programa}"...`);
        const targetProgram = findProgramFuzzy(programa);

        if (targetProgram && targetProgram.brochure) {
            console.log(`[Flow] ✅ Brochure encontrado: ${targetProgram.nombre} -> ${targetProgram.brochure}`);
            await provider.sendMessage(numero, `📄 Te adjunto el brochure oficial del programa:`, {});
            await delay(1500);

            // Envío robusto compatible con BuilderBot
            // Envío compatible con BuilderBot (Usamos texto no vacío para evitar error de match)
            await provider.sendMessage(numero, "Brochure Oficial 📄", {
                media: targetProgram.brochure,
                fileName: `brochure-${targetProgram.nombre}.pdf`.replace(/\s+/g, '_')
            });
        } else {
            console.log(`[Flow] ⚠️ No se encontró coincidencia para: "${programa}".`);
            await provider.sendMessage(numero, `📍 Si deseas el brochure de este programa, por favor escríbeme el nombre exacto o solicita un asesor.`, {});
        }

    } catch (err) { console.error('Error en procesarEnvioMensaje:', err) }
}

/**
 * Flujo de Verificación por DNI
 */
const flowVerificacion = addKeyword(['verificar', 'inscripción', 'inscripcion', 'verificacion', 'verificar inscripción'])
    .addAnswer(
        '🔍 *VERIFICACIÓN DE INSCRIPCIÓN*\n\nPor favor, dime tu número de *DNI* para consultar tu registro:',
        { capture: true },
        async (ctx, { flowDynamic, state, provider, endFlow }) => {
            const dni = ctx.body.trim().replace(/\s+/g, '');
            if (!/^[0-9A-Za-z]{8,15}$/.test(dni)) {
                return await flowDynamic('❌ DNI no válido. Por favor, escribe solo números y letras sin espacios.');
            }

            try {
                await flowDynamic('⏳ Consultando base de datos... un momento.');
                const url = `${process.env.GOOGLE_SHEET_URL}?dni=${dni}`;
                const response = await fetch(url);
                const data = await response.json();

                if (data.encontrado) {
                    // Cancelar temporizador proactivo si existe
                    if (pendingTimers.has(dni)) {
                        console.log(`[Flow] Cancelando envío proactivo para ${dni} por interacción manual.`);
                        clearTimeout(pendingTimers.get(dni));
                        pendingTimers.delete(dni);
                    }

                    const s = await state.getMyState() || {};
                    const user = loadUserData(ctx.from);

                    // Ya no bloqueamos si infoEnviada es true, siempre enviamos si verifica DNI
                    await flowDynamic(`✅ ¡Excelente ${data.nombre}! Encontramos tu registro para *${data.programa}*.\nEn breve te enviaremos la información detallada... 🚀`);
                    await state.update({ infoEnviada: true });
                    saveUser(ctx.from, { infoEnviada: true });

                    // Disparar envío pesado
                    await procesarEnvioMensaje(ctx.from, data.nombre, data.facultad, data.programa, provider);
                    return endFlow();
                } else {
                    return await flowDynamic('❌ No pudimos encontrar tu inscripción con ese DNI. Verifica el número o escribe *asesor* para ayudarte.');
                }
            } catch (e) {
                console.error('Error verificación:', e);
                return await flowDynamic('⚠️ Error temporal en el sistema. Inténtalo más tarde.');
            }
        }
    )

const welcomeFlow = addKeyword([EVENTS.WELCOME, /.*/])
    .addAction(async (ctx, { flowDynamic, state, provider, gotoFlow, endFlow }) => {
        const userId = ctx.from;
        const body = ctx.body?.trim() || '';
        if (!body) return;

        // --- INICIO CONTROL HANDOFF (DASHBOARD) ---
        const { data: convData } = await supabase
            .from('conversations')
            .select('status')
            .eq('wa_id', userId)
            .single();

        if (convData?.status === 'human_active') {
            console.log(`[Bot] Modo Manual activado para ${userId}. Ignorando respuesta automática.`);
            return endFlow(); // Detiene el flujo del bot para este usuario
        }
        // --- FIN CONTROL HANDOFF ---

        let user = loadUserData(userId);
        const bodyLower = body.toLowerCase();
        const greetings = ['hola', 'buenas', 'inicio', 'comenzar', 'hi', 'hello', 'buenos dias', 'buenas tardes', 'buenas noches'];

        const s = await state.getMyState() || {};
        const isAffirmative = ['si', 'yes', 'claro', 'por supuesto', 'afirmativo', 'simón', 'dale'].includes(bodyLower);

        // 1. Manejo de Agradecimientos
        const thanks = ['gracias', 'muchas gracias', 'gracias asesor', 'perfecto gracias', 'ok gracias', 'entendido gracias'];
        if (thanks.some(t => bodyLower.includes(t))) {
            return await flowDynamic(`¡De nada, *${user.nombre || 'estimado'}*! 😊 Fue un gusto ayudarte. Si tienes más dudas en el futuro, aquí estaré. ¡Que tengas un excelente día! 🎓✨`);
        }

        // 2. Detección de solicitud de asesor humano (desde el usuario)
        const asesorKeywords = ['solicitud asesor', 'asesor', 'ayuda humana', 'hablar con alguien', 'quiero hablar con una persona', 'necesito ayuda real', 'agente humano', 'operador'];
        if (asesorKeywords.some(k => bodyLower.includes(k))) {
            console.log(`[Handoff] Usuario ${userId} solicitó asesor humano directamente.`);
            await supabase
                .from('conversations')
                .update({ status: 'human_active', updated_at: new Date().toISOString() })
                .eq('wa_id', userId);
            return await flowDynamic([
                '👨‍💼 *Entendido. He solicitado la intervención de un asesor humano.*',
                'En breve uno de nuestros coordinadores se unirá al chat para ayudarte personalmente. Mientras tanto, puedes dejar tu consulta aquí. 👇'
            ]);
        }

        // 1.5 Respuesta Directa a Categorías (Solo la palabra clave)
        const categoriesSolo = ['maestrias', 'maestria', 'doctorados', 'doctorado', 'especialidades', 'especialidad'];
        if (categoriesSolo.includes(bodyLower)) {
            const cat = findCategory(bodyLower);
            if (cat) {
                const list = getContextForCategory(cat);
                console.log(`[Flow] Respuesta directa de categoría: ${cat}`);
                return await flowDynamic(list);
            }
        }

        // 2. Confirmación de Brochure o Asesor (REACCION A "SI")
        if (isAffirmative && body.split(' ').length <= 4) {
            // Caso A: Confirmación de Brochure
            if (s.pendingProgram) {
                const targetProgram = findProgram(s.pendingProgram);
                if (targetProgram) {
                    console.log(`[Flow] Enviando brochure confirmado para: ${targetProgram.nombre}`);
                    await flowDynamic(`✅ ¡Excelente elección! Aquí tienes el brochure oficial de la *${targetProgram.nombre}*. 📄📂`);
                    await flowDynamic([{
                        body: `📄 *Brochure:* ${targetProgram.nombre}`,
                        media: targetProgram.brochure
                    }]);
                    await state.update({ pendingProgram: null });
                    return;
                }
            }
            // Caso B: Confirmación de Asesor
            if (s.pendingAdvisor) {
                await state.update({ pendingAdvisor: null });
                return await gotoFlow(solicitudAsesorFlow);
            }
        }

        // 3. Registro de Nombre
        if (!user.nombre || user.esperandoNombre) {
            if (user.esperandoNombre && !greetings.includes(bodyLower) && body.split(' ').length >= 1 && body.length > 2) {
                user.nombre = body;
                user.esperandoNombre = false;
                saveUser(userId, user);

                await supabase.from('students').upsert({ wa_id: userId, full_name: body, phone_number: ctx.from }).select()

                return await flowDynamic(`¡Excelente, *${user.nombre}*! 🎓 Soy el Asesor Académico de Posgrado UNAC. ¿En qué programa estás interesado? Tenemos Maestrías, Doctorados y Especialidades. ✨`);
            }
            user.esperandoNombre = true;
            saveUser(userId, user);
            return await flowDynamic([
                '🌟 *BIENVENIDO A LA ESCUELA DE POSGRADO DE LA UNIVERSIDAD NACIONAL DEL CALLAO* 🌟',
                'Aquí, la excelencia académica se combina con el compromiso y la vocación de servicio, formando líderes que impactan en la sociedad.',
                '*Una universidad con un rostro humano*, donde cada estudiante es parte de una comunidad que inspira, acompaña y fortalece.',
                '¡Es momento de crecer juntos!',
                '\n¿Cuál es tu *nombre completo* para empezar? ✍️'
            ]);
        }

        // 4. Caché Semántico
        let embedding = null;
        try {


            embedding = await getEmbedding(body);
            if (embedding) {
                const cachedAnswer = await checkSemanticCache(embedding);
                if (cachedAnswer) {
                    console.log(`[Cache] Coincidencia encontrada para: "${body}"`);
                    return await flowDynamic(cachedAnswer);
                }
            }
        } catch (e) { console.error('[Flow] Error en embedding/cache:', e) }

        // 5. RAG Dinámico
        const programMatch = findProgram(body);
        const facultyMatch = findFaculty(body);
        const categoryMatch = findCategory(body);
        let dynamicContext = "";

        if (programMatch) {
            dynamicContext = `Programa: ${programMatch.nombre}. Info: ${programMatch.descripcion}. Pregunta si quiere el PDF.`;
            console.log(`[RAG] Programa detectado: ${programMatch.nombre}`);
        } else if (facultyMatch) {
            dynamicContext = getContextForFaculty(facultyMatch); // Ya es resumen
            console.log(`[RAG] Facultad detectada: ${facultyMatch.nombre}`);
        } else if (categoryMatch) {
            dynamicContext = getContextForCategory(categoryMatch); // Lista de nombres
            console.log(`[RAG] Categoría detectada: ${categoryMatch}`);
        } else {
            dynamicContext = "Contamos con Maestrías, Doctorados y Especialidades en 7 facultades: Salud, Ingeniería (Industrial, Eléctrica, Pesquera), Administración, Contables y Educación.";
        }

        // 5.5 RAG Complementario (Supabase Knowledge Base)
        if (embedding) {
            const { data: documents } = await supabase.rpc('match_documents', {
                query_embedding: embedding,
                match_threshold: 0.78, // Umbral de confianza
                match_count: 3
            });

            if (documents && documents.length > 0) {
                const extraContext = documents.map(d => d.content).join('\n\n');
                dynamicContext += `\n\n${extraContext}`;
                console.log(`[RAG] Información adicional recuperada de Supabase.`);
            } else {
                // REGISTRO DE DUDA NO RESUELTA (Feedback Loop)
                console.log(`[RAG] ⚠️ Sin coincidencia clara. Registrando duda para entrenamiento...`);
                await supabase.from('unresolved_queries').insert({
                    query: body,
                    wa_id: userId,
                    embedding: embedding
                });
            }
        }

        // 6. Consulta Grok
        const response = await getGrokCompletion(user.nombre, body, dynamicContext);
        console.log(`[Grok] Respuesta cruda: "${response}"`);

        if (response) {
            // Guardar en Caché
            if (embedding) await saveToCache(body, response, embedding);

            // Manejo de respuesta límpia
            const cleanResponse = response.replace('[SOLICITUD_ASESOR]', '').trim();
            if (cleanResponse) await flowDynamic(cleanResponse);

            // 7. Detectar intención de programa para futura confirmación
            const programInResponse = findProgram(response);
            const targetProgram = programInResponse || programMatch;

            if (targetProgram) {
                await state.update({ pendingProgram: targetProgram.nombre });
                console.log(`[Flow] Programa pendiente de confirmación: ${targetProgram.nombre}`);
            }

            // 8. Interceptar [SOLICITUD_ASESOR] (Derivación Reactiva Automática)
            if (response.includes('[SOLICITUD_ASESOR]')) {
                console.log(`[Flow] IA solicitó derivación para ${userId}. Activando Modo Manual.`);
                await supabase
                    .from('conversations')
                    .update({ status: 'human_active', updated_at: new Date().toISOString() })
                    .eq('wa_id', userId);
            }
        } else {
            await flowDynamic("Lo siento, tuve un problema al procesar tu consulta. ¿Podrías repetirla? 🔄");
        }
    });

/**
 * SISTEMA DE COLA PARA API EXTERNA (Pre-inscripción)
 */
const apiQueue = [];
let isProcessingQueue = false;

const processApiQueue = async (provider) => {
    if (isProcessingQueue || apiQueue.length === 0) return;
    isProcessingQueue = true;

    while (apiQueue.length > 0) {
        const item = apiQueue.shift();
        const { targetNumber, nombre, facultad, programa } = item;

        console.log(`[Queue] Procesando mensaje para ${nombre} (${targetNumber})...`);

        try {
            await procesarEnvioMensaje(targetNumber, nombre, facultad, programa, provider);
            saveUser(targetNumber, { infoEnviada: true });
            console.log(`[Queue] Mensaje enviado exitosamente a ${targetNumber}.`);
        } catch (error) {
            console.error(`[Queue] Error al procesar envío para ${targetNumber}:`, error);
        }

        // Espera aleatoria entre 2 y 3 minutos (120s - 180s)
        const waitTime = Math.floor(Math.random() * (180000 - 120000 + 1)) + 120000;
        console.log(`[Queue] Esperando ${Math.round(waitTime / 1000)}s antes del próximo envío. Quedan: ${apiQueue.length}`);
        await delay(waitTime);
    }

    isProcessingQueue = false;
};

const main = async () => {
    const adapterFlow = createFlow([resetFlow, welcomeFlow, solicitudAsesorFlow, flowVerificacion, mediaFlow])
    const adapterProvider = createProvider(Provider, { version: [2, 3000, 1035824857] });
    const adapterDB = new Database();

    // --- ESCUCHAR EVENTOS DEL PROVIDER ---
    let botStatus = { connected: false, waiting_qr: false };

    adapterProvider.on('require_action', (payload) => {
        if (payload.type === 'qr') {
            console.log(`[Bot] ⚡ NUEVO QR RECIBIDO (vía require_action)`);
            botStatus.connected = false;
            botStatus.waiting_qr = true;
            // Guardar el string del QR para el generador externo
            fs.writeFileSync(path.join(process.cwd(), 'last_qr.txt'), payload.value);
        }
    });

    adapterProvider.on('ready', () => {
        console.log('[Bot] ✅ Conexión establecida y lista.');
        botStatus.connected = true;
        botStatus.waiting_qr = false;

        // Limpieza de archivos QR viejos
        const qrPath = path.join(process.cwd(), 'bot.qr.png');
        const lastQrPath = path.join(process.cwd(), 'last_qr.txt');
        if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);
        if (fs.existsSync(lastQrPath)) fs.unlinkSync(lastQrPath);
    });

    adapterProvider.on('auth_failure', (error) => {
        console.error('[Bot] ❌ Error de autenticación:', error);
        botStatus.connected = false;
        botStatus.waiting_qr = false;
    });

    // --- ESCUCHA GLOBAL DE MENSAJES (PARA DASHBOARD) ---
    adapterProvider.on('message', async (ctx) => {
        // Ignorar estados de WhatsApp (historias)
        if (ctx.from === 'status@broadcast') return;

        console.log(`[Dashboard Sync] Mensaje de ${ctx.from}: ${ctx.body}`);

        try {
            // 1. Asegurar que existe la conversación (upsert explícito)
            const { data: existingConv } = await supabase
                .from('conversations')
                .select('id')
                .eq('wa_id', ctx.from)
                .single();

            if (!existingConv) {
                await supabase.from('conversations').insert({
                    wa_id: ctx.from,
                    status: 'bot',
                    updated_at: new Date().toISOString()
                });
                console.log(`[Dashboard Sync] Nueva conversación creada para ${ctx.from}`);
            } else {
                await supabase.from('conversations')
                    .update({ updated_at: new Date().toISOString() })
                    .eq('wa_id', ctx.from);
            }

            // 2. Insertar el mensaje (filtrar eventos internos y stickers)
            if (ctx.body?.startsWith('_event_')) {
                console.log(`[Dashboard Sync] Ignorando evento interno: ${ctx.body}`);
                return;
            }
            const msgText = ctx.body || (
                ctx.type === 'image' ? '📷 Imagen' :
                    ctx.type === 'audio' ? '🎵 Audio' :
                        ctx.type === 'video' ? '🎬 Video' :
                            ctx.type === 'document' ? '📄 Documento' :
                                ctx.type === 'sticker' ? '✨ Sticker' :
                                    ctx.type === 'location' ? '📍 Ubicación' :
                                        ctx.type === 'contact' ? '👤 Contacto' :
                                            null
            );
            if (!msgText) return; // Ignorar tipos desconocidos sin texto
            await supabase.from('messages').insert({
                wa_id: ctx.from,
                text: msgText,
                media_url: ctx.url || null,
                sender_type: 'user'
            });
        } catch (e) {
            console.error('[Dashboard Sync] Error al persistir mensaje entrante:', e);
        }
    });

    // Interceptar el envío de mensajes del Bot para persistirlos también
    const originalSendMessage = adapterProvider.sendMessage;
    const _dashboardPendingSends = new Set(); // Evitar duplicados de mensajes del dashboard

    adapterProvider.sendMessage = async (number, message, options) => {
        const result = await originalSendMessage.call(adapterProvider, number, message, options);

        // Normalizar el wa_id (quitar @s.whatsapp.net para que coincida con ctx.from)
        const cleanNumber = number.includes('@') ? number.split('@')[0] : number;

        // Si este mensaje fue originado desde el dashboard, NO lo insertamos otra vez
        const dedupKey = `${cleanNumber}:${typeof message === 'string' ? message : ''}`;
        if (_dashboardPendingSends.has(dedupKey)) {
            _dashboardPendingSends.delete(dedupKey);
            // Solo actualizar el timestamp de la conversación
            try {
                await supabase.from('conversations')
                    .update({ updated_at: new Date().toISOString() })
                    .eq('wa_id', cleanNumber);
            } catch (e) { }
            return result;
        }

        try {
            // Asegurar que existe la conversación para mensajes salientes también
            const { data: existingConv } = await supabase
                .from('conversations')
                .select('id')
                .eq('wa_id', cleanNumber)
                .single();

            if (!existingConv) {
                await supabase.from('conversations').insert({
                    wa_id: cleanNumber,
                    status: 'bot',
                    updated_at: new Date().toISOString()
                });
            } else {
                await supabase.from('conversations')
                    .update({ updated_at: new Date().toISOString() })
                    .eq('wa_id', cleanNumber);
            }

            await supabase.from('messages').insert({
                wa_id: cleanNumber,
                text: typeof message === 'string' ? message : (options?.media ? '📎 Archivo enviado' : 'Mensaje automático'),
                media_url: options?.media || null,
                sender_type: 'bot'
            });
        } catch (e) {
            console.error('[Dashboard Sync] Error al persistir respuesta del Bot:', e);
        }

        return result;
    };




    // --- INICIO INTEGRACIÓN DASHBOARD PREMIUM ---
    console.log('[Bot] Configurando integración con el Dashboard...');

    // Middleware Global para CORS y JSON (Compatible con Polka/BuilderBot)
    adapterProvider.server.use(cors());
    adapterProvider.server.use(express.json());

    adapterProvider.server.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // Logger básico para depuración
        if (req.url.startsWith('/bot/')) {
            console.log(`[Dashboard API] ${req.method} ${req.url}`);
        }

        // Manejar pre-vuelo (Preflight)
        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            return res.end();
        }
        next();
    });

    // Endpoint para servir la imagen del QR
    adapterProvider.server.get('/bot/qr', (req, res) => {
        const qrPath = path.join(process.cwd(), 'bot.qr.png');


        if (fs.existsSync(qrPath)) {
            console.log('[Dashboard] Sirviendo bot.qr.png local');
            res.sendFile(qrPath);
        } else {
            res.statusCode = 404;
            res.end('QR no encontrado.');
        }
    });

    // Endpoint para obtener el estado de conexión (con QR embebido en Base64)
    adapterProvider.server.get('/bot/status', (req, res) => {

        const qrPath = path.join(process.cwd(), 'bot.qr.png');
        const hasQrFile = fs.existsSync(qrPath);

        let qr_base64 = null;
        if (hasQrFile) {
            try {
                const buffer = fs.readFileSync(qrPath);
                qr_base64 = `data:image/png;base64,${buffer.toString('base64')}`;
            } catch (e) {
                console.error('[Dashboard] Error convirtiendo QR a Base64:', e);
            }
        }

        console.log(`[Dashboard] Estado: conectado=${botStatus.connected}, qr_disponible=${!!qr_base64}`);

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            connected: botStatus.connected,
            waiting_qr: botStatus.waiting_qr || hasQrFile,
            qr_base64: qr_base64,
            timestamp: new Date().toISOString()
        }));
    });



    // 1. Escuchar mensajes enviados desde el Dashboard
    const channel = supabase.channel('dashboard-send')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'sender_type=eq.dashboard' }, async (payload) => {
            const { wa_id, text, media_url } = payload.new;
            console.log(`[Dashboard] 📩 Recibida solicitud de envío para ${wa_id}`);

            // Asegurar formato de número correcto
            let target = wa_id;
            if (!target.includes('@')) {
                target = `${target}@s.whatsapp.net`;
            }

            const cleanWa = wa_id.split('@')[0];
            _dashboardPendingSends.add(`${cleanWa}:${text || ''}`);

            try {
                if (media_url) {
                    await adapterProvider.sendMessage(target, text || "Archivo adjunto", { media: media_url });
                } else {
                    await adapterProvider.sendMessage(target, text, {});
                }
                console.log(`[Dashboard] ✅ Mensaje enviado exitosamente a ${target}`);
            } catch (err) {
                console.error(`[Dashboard] ❌ ERROR al enviar a ${target}:`, err);
                _dashboardPendingSends.delete(`${cleanWa}:${text || ''}`);
            }
        })
        .subscribe();

    // --- NUEVOS ENDPOINTS PARA GESTIÓN DE RAG (ENTRENAMIENTO) ---

    // Listar Dudas Pendientes (Feedback Loop)
    adapterProvider.server.get('/bot/unresolved', async (req, res) => {

        try {
            const { data, error } = await supabase
                .from('unresolved_queries')
                .select('*')
                .eq('resolved', false)
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // Resolver una duda: Mover a Knowledge Base y marcar como resuelta
    adapterProvider.server.post('/bot/resolve', async (req, res) => {

        try {
            const { id, content } = req.body;
            if (!id || !content) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'ID y contenido son requeridos' }));
            }

            console.log(`[RAG Admin] Resolviendo duda ${id} -> Entrenando bot...`);
            const embedding = await getEmbedding(content);

            // 1. Insertar en Knowledge Base
            const { error: insertError } = await supabase
                .from('knowledge_base')
                .insert({ content, embedding });

            if (insertError) throw insertError;

            // 2. Marcar como resuelta
            const { error: updateError } = await supabase
                .from('unresolved_queries')
                .update({ resolved: true })
                .eq('id', id);

            if (updateError) throw updateError;

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // Listar Base de Conocimientos
    adapterProvider.server.get('/bot/knowledge', async (req, res) => {

        try {
            const { data, error } = await supabase
                .from('knowledge_base')
                .select('id, content, metadata, created_at')
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // Agregar nuevo fragmento con embedding
    adapterProvider.server.post('/bot/knowledge', async (req, res) => {

        try {
            const { content, metadata } = req.body;
            if (!content) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'El contenido es requerido' }));
            }

            console.log(`[RAG Admin] Generando embedding para nuevo fragmento...`);
            const embedding = await getEmbedding(content);

            const { data, error } = await supabase
                .from('knowledge_base')
                .insert({
                    content,
                    metadata: metadata || {},
                    embedding
                })
                .select();

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, data: data[0] }));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // Actualizar fragmento y su embedding
    adapterProvider.server.put('/bot/knowledge/:id', async (req, res) => {

        try {
            const { id } = req.params;
            const { content, metadata } = req.body;
            if (!content) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'El contenido es requerido' }));
            }

            console.log(`[RAG Admin] Actualizando fragmento ID ${id}...`);
            const embedding = await getEmbedding(content);

            const { data, error } = await supabase
                .from('knowledge_base')
                .update({
                    content,
                    metadata: metadata || {},
                    embedding
                })
                .eq('id', id)
                .select();

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, data: data[0] }));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // Eliminar fragmento
    adapterProvider.server.delete('/bot/knowledge/:id', async (req, res) => {

        try {
            const { id } = req.params;
            const { error } = await supabase
                .from('knowledge_base')
                .delete()
                .eq('id', id);

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Fragmento eliminado' }));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // --- ENDPOINTS MEMORIA SEMÁNTICA (CACHE) ---

    // Listar Memoria Semántica
    adapterProvider.server.get('/bot/cache', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('semantic_cache')
                .select('id, question, answer, created_at')
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('[Dashboard] Error al listar caché:', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
        }
    });

    // Actualizar respuesta en la memoria
    adapterProvider.server.put('/bot/cache/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { answer } = req.body;

            if (!answer) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'La respuesta es requerida' }));
            }

            const { error } = await supabase
                .from('semantic_cache')
                .update({ answer })
                .eq('id', id);

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            console.error('[Dashboard] Error al actualizar caché:', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
        }
    });

    // Eliminar entrada de la memoria
    adapterProvider.server.delete('/bot/cache/:id', async (req, res) => {
        try {
            const { id } = req.params;

            // Caso especial: Limpiar toda la memoria
            if (id === 'all') {
                const { error } = await supabase
                    .from('semantic_cache')
                    .delete()
                    .neq('id', '00000000-0000-0000-0000-000000000000'); // Borrar todo

                if (error) throw error;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ success: true, message: 'Memoria limpiada totalmente' }));
            }

            const { error } = await supabase
                .from('semantic_cache')
                .delete()
                .eq('id', id);

            if (error) throw error;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            console.error('[Dashboard] Error al eliminar caché:', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
        }
    });



    // --- FIN INTEGRACIÓN DASHBOARD PREMIUM ---

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    adapterProvider.server.post('/v1/messages', handleCtx(async (bot, req, res) => {
        const { number, message, urlMedia } = req.body;
        await bot.sendMessage(number, message, { media: urlMedia ?? null });
        return res.end('sended');
    }));

    adapterProvider.server.post('/v1/enviar-datos', handleCtx(async (bot, req, res) => {
        let { wa_id, nombre, facultad, programa, dni, telefono } = req.body;
        const targetNumber = wa_id || telefono;

        if (!targetNumber || !dni) {
            return res.writeHead(400).end(JSON.stringify({ error: 'Faltan wa_id/telefono o dni' }));
        }

        console.log(`[API v1] Petición recibida para ${nombre} (DNI: ${dni}).`);

        // 1. Guardar o actualizar registro en Supabase
        await supabase.from('students').upsert({
            wa_id: targetNumber,
            full_name: nombre,
            document_id: dni
        });

        // 2. Validar límite diario (50)
        const currentCounter = getLeadsCounter();
        if (currentCounter.count >= 50) {
            console.log(`[API v1] ❌ Límite diario de 50 alcanzado.`);
            return res.writeHead(403).end('Limite diario alcanzado');
        }

        // 3. Incrementar contador y añadir a cola
        incrementLeadsCounter(50);
        apiQueue.push({ targetNumber, nombre, facultad, programa });
        processApiQueue(adapterProvider);

        return res.end('Lead encolado para procesamiento.');
    }));

    /**
     * NUEVO ENDPOINT: /api/enviar-mensaje
     * Recibe peticiones del formulario PHP y encola con retardo.
     */
    adapterProvider.server.post('/api/enviar-mensaje', handleCtx(async (bot, req, res) => {
        const { numero, mensaje, facultad, programa } = req.body;
        const nombre = mensaje; // El PHP envía el nombre en el campo 'mensaje'
        const targetNumber = numero.includes('@') ? numero : `${numero}@s.whatsapp.net`;

        console.log(`[API New] Petición recibida para ${nombre} (${targetNumber})`);

        // Validar límite diario (50)
        const currentCounter = getLeadsCounter();
        if (currentCounter.count >= 50) {
            console.log(`[API New] ❌ Límite diario de 50 alcanzado.`);
            return res.writeHead(403).end('Limite diario alcanzado');
        }

        // Incrementar contador y añadir a la cola
        incrementLeadsCounter(50);
        apiQueue.push({ targetNumber, nombre, facultad, programa });
        processApiQueue(adapterProvider);

        return res.end('Recibido y encolado');
    }));

    try {
        httpServer(+PORT);
        console.log(`[Bot] Servidor listo en puerto ${PORT}`);
    } catch (e) { console.error('[Bot] Error en servidor:', e); }
};

main();
