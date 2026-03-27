import 'dotenv/config'
import fs from 'fs'
import path from 'path'
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
        const systemPrompt = `Asesor Posgrado UNAC. ✨ BREVE y directo.
REGLAS:
- Max 2 párrafos cortos. Emojis.
- NO envíes PDFs proactivamente. Pregunta primero. 📄
- Solo temas UNAC. Código [SOLICITUD_ASESOR] solo si piden humano o no sabes la respuesta.
- PROHIBIDO inventar datos. 
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
const solicitudAsesorFlow = addKeyword(['SOLICITUD_ASESOR_MANUAL', 'SOLICITUD_ASESOR'])
    .addAction(async (ctx, { provider, flowDynamic }) => {
        const user = loadUserData(ctx.from);
        const adminMsg = `🚨 *NUEVA SOLICITUD DE ASESOR* 🚨\n\n` +
                        `👤 *Nombre:* ${user.nombre || 'No registrado'}\n` +
                        `📞 *Teléfono:* ${ctx.from}\n` +
                        `💬 *Motivo:* El usuario solicitó un asesor humano.\n` +
                        `📱 *WhatsApp:* wa.me/${ctx.from}`;

        const targetAdmin = '51900969591@s.whatsapp.net';
        console.log(`[Flow] Notificación automática a: ${targetAdmin}`);
        
        try {
            await provider.sendMessage(targetAdmin, adminMsg, {}); 
            await flowDynamic('✅ ¡Excelente! He avisado a un asesor humano. Se comunicarán contigo pronto por este mismo chat. 🕒');
        } catch (error) {
            console.error(`[Flow] Error al notificar admin:`, error);
        }
    });

// Ayuda de retardo
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * LÓGICA DE ENVÍO AUTOMATIZADO (Post-Verificación)
 */
async function procesarEnvioMensaje(numero, nombre, facultad, programa, provider) {
    try {
        console.log(`[Flow] Iniciando secuencia automatizada para ${nombre} (${numero})`);
        const groupLink = "https://chat.whatsapp.com/DyKT9mklDUa8CrlemeJorl?mode=gi_t";
        
        // 1. Bienvenida
        const saludo = `🎓 ¡Hola ${nombre}! Felicidades.\n*Somos de la Escuela de Posgrado de la UNAC*\n🚀 Ya te encuentras registrado para nuestro programa de *${programa}*.`;
        await provider.sendMessage(numero, saludo, {});
        await delay(3000);

        // 2. Información de Costos y Fechas
        let precio = 'S/ 200', duracion = '3 semestres', cuenta = '000-3747336', cci = '009-100-000003747336-90', costo = 'S/ 2100';
        const p = programa.toLowerCase();
        if (p.includes('doctorado')) { 
            precio = 'S/ 250'; duracion = '6 semestres'; costo = 'S/ 2100';
        } else if (p.includes('especialidad')) { 
            precio = 'S/ 120'; duracion = '2 semestres'; cuenta = '000-1797042'; cci = '009-100-000001797042-97'; costo = 'S/ 1200';
        }

        const infoText = `💥 *Detalles del Programa:*
📌 Inscripción: ${precio}
🏦 Banco: Scotiabank (Cta: ${cuenta} / CCI: ${cci})
⏳ Duración: ${duracion}
💵 Costo Semestre: ${costo}

📅 *Fechas Clave:*
🖋 Inscripciones: Hasta el 21 de Marzo 2026
🎒 Inicio Clases: Abril 2026

🔗 *Únete al grupo de WhatsApp oficial:*
${groupLink}`;

        await provider.sendMessage(numero, infoText, {});
        await delay(3000);

        // 3. Enviar Brochure (Si existe)
        const targetProgram = findProgramFuzzy(programa);
        if (targetProgram && targetProgram.brochure) {
            console.log(`[Flow] Brochure encontrado para ${programa}: ${targetProgram.nombre}`);
            await provider.sendMessage(numero, `📄 Te adjunto el brochure oficial del programa:`, {});
            await provider.sendMessage(numero, { media: targetProgram.brochure }, { fileName: `${targetProgram.nombre}.pdf`.replace(/\s+/g, '_') });
        } else {
            console.log(`[Flow] ⚠️ No se encontró brochure para: "${programa}". Verifica el catálogo.`);
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
                    if (s.infoEnviada || user.infoEnviada) {
                        return await flowDynamic(`✅ ¡Hola ${data.nombre}! Tu inscripción para *${data.programa}* ya está confirmada. Si tienes más dudas, ¡avísame! ✨`);
                    }

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
    .addAction(async (ctx, { flowDynamic, state, provider, gotoFlow }) => {
        const userId = ctx.from;
        const body = ctx.body?.trim() || '';
        if (!body) return;

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
            const extraContext = await getRAGContext(embedding);
            if (extraContext) {
                dynamicContext += `\n\n${extraContext}`;
                console.log(`[RAG] Información adicional recuperada de Supabase.`);
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

            // 8. Interceptar [SOLICITUD_ASESOR] (Derivación Reactiva)
            if (response.includes('[SOLICITUD_ASESOR]')) {
                await state.update({ pendingAdvisor: true });
                console.log(`[Flow] Derivación preparada. Esperando confirmación del usuario.`);
            }
        } else {
            await flowDynamic("Lo siento, tuve un problema al procesar tu consulta. ¿Podrías repetirla? 🔄");
        }
    });

// Mapa global para gestionar temporizadores de leads (DNI -> Timer)
const pendingTimers = new Map();

const main = async () => {
    const adapterFlow = createFlow([resetFlow, welcomeFlow, solicitudAsesorFlow, flowVerificacion])
    const adapterProvider = createProvider(Provider, { version: [2, 3000, 1035824857] });
    const adapterDB = new Database();

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

        console.log(`[API] Lead recibido: ${nombre} (${dni}). Iniciando espera de 5 min.`);

        // 1. Guardar o actualizar registro en Supabase
        await supabase.from('students').upsert({ 
            wa_id: targetNumber, 
            full_name: nombre, 
            document_id: dni 
        });

        // 2. Configurar temporizador de 5 minutos
        if (pendingTimers.has(dni)) clearTimeout(pendingTimers.get(dni));
        
        const timer = setTimeout(async () => {
            console.log(`[API] Tiempo cumplido para ${dni}. Verificando envío...`);
            
            // Cargar datos actuales del usuario para ver si ya se le envió
            const user = loadUserData(targetNumber);
            if (!user.infoEnviada) {
                console.log(`[API] Disparando envío proactivo para ${targetNumber}`);
                await procesarEnvioMensaje(targetNumber, nombre, facultad, programa, bot);
                saveUser(targetNumber, { infoEnviada: true });
            }
            pendingTimers.delete(dni);
        }, 5 * 60 * 1000); // 5 minutos

        pendingTimers.set(dni, timer);

        return res.end('Lead registrado, en espera de interacción o 5 min.');
    }));

    try {
        httpServer(+PORT);
        console.log(`[Bot] Servidor listo en puerto ${PORT}`);
    } catch (e) { console.error('[Bot] Error en servidor:', e); }
};

main();
