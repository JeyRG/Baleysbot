// Ignorar errores de certificado SSL (posgradounac.edu.pe tiene certificado incompleto)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import cors from 'cors'
import express from 'express'
import { join } from 'path'
import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import { getGrokCompletion as originalGetGrokCompletion, getTokenUsageSummary } from './grokClient.js'

// Servicios
import { supabase } from './services/supabaseClient.js'
import { getEmbedding } from './services/embeddingService.js'
import { checkInscriptionByDni } from './services/inscriptionService.js'
import { initCatalog, findProgram, findPrograms, getSummaryContext, findFaculty, getContextForFaculty, findCategory, getContextForCategory, getAllProgramNamesOnly, findProgramFuzzy, getAllProgramsGeneral, getAllProgramsByCategory, getTipoProgramaInfo, getEnrichedContextForGrok, getProgramsForFacultyCategory } from './services/catalogService.js'
import { getRAGContext } from './services/knowledgeService.js'

import { fileURLToPath } from 'url';
const __filenameApp = fileURLToPath(import.meta.url);
const __dirnameApp = path.dirname(__filenameApp);
const pendingProgramInfoSelections = new Map();

function buildProgramExtraInfo(program) {
    if (!program) return '';

    const sections = [];

    if (program.descripcion) {
        sections.push(`*📖 Descripción:*
${program.descripcion}`);
    }

    if (program.perfiles_programa) {
        sections.push(`*🎯 Perfil del Egresado:*
${program.perfiles_programa}`);
    }

    if (sections.length === 0) return '';

    return `✨ *Conoce más de tu programa:*

${sections.join('\n\n')}`;
}

function buildProgramTeaser(program) {
    if (!program) return '';

    const teaserLines = [];

    if (program.descripcion) {
        teaserLines.push(program.descripcion);
    }

    teaserLines.push('Si quieres, te envío el brochure oficial.');

    return teaserLines.slice(0, 2).join('\n\n');
}

function buildProgramDetailMessage(program) {
    if (!program) return '';

    const lines = [
        `🎓 *${program.nombre}*`,
    ];

    if (program.facultad) {
        lines.push(`🏢 *Facultad:* ${program.facultad}`);
        lines.push(`📚 *Tipo:* ${program.tipo.replace('maestrias', 'Maestría').replace('doctorados', 'Doctorado').replace('especialidades', 'Especialidad')}`);
    }

    if (program.descripcion) {
        lines.push(`📖 *Descripción:* ${program.descripcion}`);
    }

    // Inyectar Costos y Requisitos
    if (program.tipo) {
        const tipoInfo = getTipoProgramaInfo(program.tipo);
        if (tipoInfo) {
            let extraInfo = '';
            if (tipoInfo.duracion) extraInfo += `⏳ *Duración:* ${tipoInfo.duracion}\n`;
            if (tipoInfo.costos) extraInfo += `💰 *Costo Inscripción:* ${tipoInfo.costos}\n`;
            if (tipoInfo.costo_ciclo) extraInfo += `💵 *Costo por Ciclo:* ${tipoInfo.costo_ciclo}\n`;
            
            if (extraInfo) {
                lines.push(`---\n${extraInfo.trim()}`);
            }

            if (tipoInfo.requisitos) {
                lines.push(`---\n📄 *Requisitos Generales:*\n${tipoInfo.requisitos}`);
            }
        }
    }

    if (program.perfiles_programa) {
        lines.push(`---\n🎯 *Perfil del egresado:* ${formatProgramField(program.perfiles_programa)}`);
    }

    return lines.join('\n\n');
}

function formatProgramField(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
        return value.map(item => formatProgramField(item)).filter(Boolean).join('\n');
    }
    if (typeof value === 'object') {
        if (Object.prototype.hasOwnProperty.call(value, 'descripcion')) {
            return formatProgramField(value.descripcion);
        }
        return Object.values(value).map(item => formatProgramField(item)).filter(Boolean).join('\n');
    }
    return String(value).trim();
}

function normalizeReply(text) {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[.,!?;]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isAffirmativeReply(text) {
    const normalized = normalizeReply(text);
    return /^(si|claro|ok|dale|por supuesto|afirmativo|yes)(\s|$)/.test(normalized) ||
        /\b(si|sí)\b/.test(normalized);
}

function compactContext(context, maxChars = 900) {
    if (!context) return '';
    const compact = context
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n')
        .replace(/\s+/g, ' ')
        .trim();

    if (compact.length <= maxChars) return compact;
    return compact.slice(0, maxChars).trimEnd();
}

function isGeneralCategoryRequest(bodyLower, categoryIntent, specificProgramMatch) {
    if (!categoryIntent) return false;

    const genericIntent = /\b(informacion|información|info|lista|programas|ofrecen|tienen|quiero saber|dame|mostrar|ver)\b/i.test(bodyLower);
    if (!genericIntent) return false;

    const normalized = bodyLower
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const tokens = normalized.split(' ').filter(Boolean);
    const noise = new Set([
        'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches',
        'informacion', 'info', 'lista', 'programas', 'ofrecen', 'tienen', 'quiero', 'saber', 'dame', 'mostrar', 'ver',
        'de', 'del', 'la', 'el', 'las', 'los', 'un', 'una', 'unos', 'unas', 'sobre', 'mas', 'mas',
        'maestrias', 'maestria', 'doctorados', 'doctorado', 'especialidades', 'especialidad'
    ]);

    const remaining = tokens.filter(token => !noise.has(token));
    if (remaining.length === 0) return true;

    if (!specificProgramMatch && remaining.length <= 1) return true;
    return false;
}

function isCategoryOnlyRequest(bodyLower, categoryIntent) {
    if (!categoryIntent) return false;

    const normalized = normalizeReply(bodyLower);
    const categoryHints = [
        'maestria', 'maestrias', 'doctorado', 'doctorados', 'especialidad', 'especialidades',
        'segunda especialidad', 'segundas especialidades', 'segunda especialidades', 'segundas especialidad'
    ];

    if (categoryHints.some(hint => normalized.includes(hint))) {
        const extraWords = normalized
            .replace(/\b(maestria|maestrias|doctorado|doctorados|especialidad|especialidades|segunda|segundas|especial)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return extraWords.length === 0 || extraWords.split(' ').length <= 2;
    }

    return false;
}

// Mapa de selecciones pendientes de brochures por usuario
const pendingBrochureSelections = new Map();

// Mapa de selecciones de menú interactivo de facultades
const pendingCategoryMenuSelections = new Map();

// --- Rate Limiting (Anti-Spam) ---
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 30000; // 30 segundos
const MAX_MESSAGES_PER_WINDOW = 5;

function checkRateLimit(userId) {
    const now = Date.now();
    const userLimit = rateLimits.get(userId) || { count: 0, startTime: now, warned: false };

    if (now - userLimit.startTime > RATE_LIMIT_WINDOW) {
        userLimit.count = 1;
        userLimit.startTime = now;
        userLimit.warned = false;
    } else {
        userLimit.count++;
    }

    rateLimits.set(userId, userLimit);

    if (userLimit.count > MAX_MESSAGES_PER_WINDOW) {
        return { isSpam: true, shouldWarn: !userLimit.warned, limitRef: userLimit };
    }
    return { isSpam: false };
}

// --- Cron Job (Limpieza de inactivos) ---
setInterval(async () => {
    try {
        console.log('[Cron] Ejecutando reset_inactive_conversations...');
        const { error } = await supabase.rpc('reset_inactive_conversations', { timeout_minutes: 240 });
        if (error) console.error('[Cron] Error al limpiar inactivos:', error);
    } catch (e) {
        console.error('[Cron] Excepción:', e);
    }
}, 60 * 60 * 1000); // Cada 1 hora

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
const getGrokCompletion = async (userName, message, context = '', options = {}) => {
    try {
        const cleanContext = compactContext(context, options.maxContextChars ?? 900);
        const systemPrompt = `Eres el Asesor Académico Virtual de la Escuela de Posgrado de la UNAC (Universidad Nacional del Callao).

REGLAS ESTRICTAS:
1. Responde SOLO con datos del contexto proporcionado. NUNCA inventes cifras, fechas ni requisitos.
2. Si el contexto tiene costos → úsalos exactamente. No modifiques las cifras.
3. Si preguntan por fechas → da exactamente las del contexto. Si no están → di que consulten a coordinación.
4. Si preguntan por requisitos → lista los del contexto numerados y ordenados.
5. Responde en máximo 3-4 líneas concisas. Sé directo.
6. Si la información no está en el contexto → responde [SOLICITUD_ASESOR].
7. No menciones otras universidades. No compares precios.
8. Trato cordial, usa emojis solo para claridad.`

        const messages = [{ role: 'system', content: cleanContext ? `${systemPrompt}\n\nContexto disponible:\n${cleanContext}` : systemPrompt }, { role: 'user', content: message }];

        const grokResponse = await originalGetGrokCompletion(messages, {
            maxTokens: options.maxTokens ?? 180,
            temperature: options.temperature ?? 0.2,
            model: options.model,
        });
        return grokResponse.choices?.[0]?.message?.content || null;
    } catch (e) {
        console.error('[Grok] Error:', e);
        return null;
    }
}

/**
 * Loguea una interacción del bot para revisión posterior
 */
const logInteraction = async (waId, userQuery, botResponse, embedding, source = 'grok') => {
    try {
        await supabase.from('chatbot_interactions').insert({
            wa_id: waId,
            user_query: userQuery,
            bot_response: botResponse || '',
            embedding: embedding || null,
            source: source,
        });
    } catch (e) {
        // No bloquear el flujo si falla el logueo
        console.error('[Interactions] Error al loguear interacción:', e.message);
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

function formatSupabaseField(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
        return data.map(item => {
            if (typeof item === 'object' && item !== null) {
                return Object.entries(item).map(([k, v]) => `${k}: ${v}`).join(' | ');
            }
            return String(item);
        }).join('\n');
    }
    if (typeof data === 'object' && data !== null) {
        return Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n');
    }
    return String(data);
}

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

        console.log(`[Flow] Buscando datos en Supabase para: "${programa}"...`);
        const targetProgram = findProgramFuzzy(programa);

        // 1. Determinar el link del grupo
        let groupLink = 'https://chat.whatsapp.com/DyKT9mklDUa8CrlemeJorl'; // Default
        if (targetProgram && targetProgram.link_ws) {
            groupLink = targetProgram.link_ws;
        } else {
            const p = programa.toLowerCase();
            if (p.includes('maestria')) groupLink = 'https://chat.whatsapp.com/DyKT9mklDUa8CrlemeJorl';
            else if (p.includes('doctorado')) groupLink = 'https://chat.whatsapp.com/DyKT9mklDUa8CrlemeJorl';
        }

        // 2. Información base
        let precio = 'S/ 200'; let duracion = '3 ciclos'; let cuenta = '000-3747336'; let cci = '009-100-000003747336-90'; let costo = 'S/ 2100';
        let reqDoc = 'Copia del Grado Académico de Bachiller.';
        let matricula = 'S/ 100';

        const p = programa.toLowerCase();
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
        const saludo = `🎓 ¡Hola ${nombre}! Felicidades.\n*Somos de la Escuela de Posgrado de la UNAC*\n🚀 Ya te encuentras registrado para nuestro programa de *${targetProgram ? targetProgram.nombre : programa}*.`;
        await provider.sendMessage(numero, saludo, {});
        await delay(3000);

        // 2. Descripción y Perfil (De Supabase)
        if (targetProgram) {
            let detallesExtra = '';
            if (targetProgram.descripcion) detallesExtra += `\n*📖 Descripción:*\n${targetProgram.descripcion}\n`;
            if (targetProgram.perfiles_programa) {
                const perfilFormat = formatSupabaseField(targetProgram.perfiles_programa);
                detallesExtra += `\n*🎯 Perfil del Egresado:*\n${perfilFormat}\n`;
            }

            if (detallesExtra) {
                await provider.sendMessage(numero, `✨ *Conoce más de tu programa:*\n${detallesExtra}`, {});
                await delay(3000);
            }
        }

        const infoText = `💥 *Detalles de Inscripción:*
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

        // Malla Curricular
        if (targetProgram && targetProgram.malla_curricular) {
            const mallaFormat = formatSupabaseField(targetProgram.malla_curricular);
            await provider.sendMessage(numero, `📚 *Malla Curricular:*\n${mallaFormat}`, {});
            await delay(3000);
        }

        const requirementsText = `📝 *REQUISITOS DE INSCRIPCIÓN:*
1️⃣ Ficha de Postulante y Hoja de Vida del Postulante llenados de manera virtual a través de nuestro sistema.
2️⃣ Copia legible del DNI o Pasaporte.
3️⃣ Foto actual a color (opcional).
4️⃣ ${reqDoc}

*Nota:* Los grados del extranjero deben estar registrados en SUNEDU.`;

        await provider.sendMessage(numero, requirementsText, {});
        await delay(3000);

        // 3. Enviar Brochure (Si existe)
        if (targetProgram && targetProgram.brochure) {
            console.log(`[Flow] ✅ Brochure encontrado: ${targetProgram.nombre} -> ${targetProgram.brochure}`);
            await provider.sendMessage(numero, `📄 Te adjunto el brochure oficial del programa:`, {});
            await delay(1500);

            // Envío robusto compatible con BuilderBot
            await provider.sendMessage(numero, "Brochure Oficial 📄", {
                media: targetProgram.brochure,
                fileName: `brochure-${targetProgram.nombre}.pdf`.replace(/\s+/g, '_')
            });
        } else {
            console.log(`[Flow] ⚠️ No se encontró brochure para: "${programa}".`);
            await provider.sendMessage(numero, `📍 Si deseas el brochure de este programa, por favor escríbeme el nombre exacto o solicita un asesor.`, {});
        }
        await delay(2000);

        // 4. Enviar los siguientes pasos
        const pasosPostInscripcion = `📌 **¡Paso a paso para completar tu proceso de admisión!** 🎓✨

**1️⃣ Realiza tu inscripción**
Ingresa al siguiente enlace y completa tu registro con tus datos:
👉 https://posgradounac.edu.pe/INSCRIPCION/

**2️⃣ Realiza el pago por derecho de admisión** 💳

El monto dependerá del programa al que postulas:
🎓 **Maestría:** S/ 200
📘 **Segunda Especialidad:** S/ 120
🎖️ **Doctorado:** S/ 250

💥 **Datos de la cuenta bancaria:**
🏦 **Banco:** Scotiabank
**Cuenta:** 000-3747336
**CCI:** 009-100-000003747336-90

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

        await provider.sendMessage(numero, pasosPostInscripcion, {});

    } catch (err) { console.error('Error en procesarEnvioMensaje:', err) }
}

/**
 * Flujo Unificado de Verificación de Expediente e Inscripción
 */
const flowExpedienteProcesar = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { state, flowDynamic }) => {
        const s = await state.getMyState();
        const dni = s.dni;
        await flowDynamic('⏳ Consultando tu expediente en nuestra base de datos... un momento.');

        const result = await checkInscriptionByDni(dni);
        if (result.error) {
            await flowDynamic(`❌ ${result.error}`);
        } else {
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
                    '👉 *Cuando tengas todos tus documentos listos, ingresa a la plataforma GED para cargar tu carpeta digital:',
                    '👉 https://posgradounac.edu.pe/GED/*',
                    'Sube tu Carpeta de Postulante para que pueda ser evaluada por coordinación.'
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
                } else if (estado === '1' || estado === '4') { // Pendiente / En Evaluacion
                    await flowDynamic([
                        '⏳ *TU EXPEDIENTE ESTÁ EN EVALUACIÓN*',
                        'Tu carpeta de postulante ya fue enviada y se encuentra a la espera de revisión.',
                        '👉 Por favor, ten paciencia. Te notificaremos o puedes volver a consultar tu estado más adelante.'
                    ]);
                } else {
                    await flowDynamic([
                        '📄 *Estado de tu expediente:*',
                        result.mensajeExpediente || 'En proceso de revisión.'
                    ]);
                }
            }
        }
    });


const welcomeFlow = addKeyword([EVENTS.WELCOME, /.*/])
    .addAction(async (ctx, { flowDynamic, state, provider, gotoFlow, endFlow }) => {
        const userId = ctx.from;
        const body = ctx.body?.trim() || '';
        if (!body) return;

        // --- RATE LIMITING (Anti-Spam) ---
        const rateLimitResult = checkRateLimit(userId);
        if (rateLimitResult.isSpam) {
            if (rateLimitResult.shouldWarn) {
                return await flowDynamic("⚠️ *Por favor, no envíes mensajes tan rápido.* Espera unos segundos e intenta nuevamente.");
            }
            return endFlow(); // Ignorar silenciosamente
        }
        // --- FIN RATE LIMITING ---

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

        const bodyLower = body.toLowerCase();

        // --- DETECCIÓN AUTOMÁTICA DE DNI / EXPEDIENTE / INSCRIPCIÓN ---
        const dniMatch = body.match(/\b\d{8}\b/);
        const isDniOnly = /^\d{8}$/.test(body.replace(/\s+/g, ''));

        // Detectar intención de verificar expediente o inscripción con frases naturales
        const mentionsExpediente = /(expediente|estado de mi|mi inscripci|verificar.*inscripci|verificar.*expediente|consultar.*inscripci|consultar.*expediente|revisar.*expediente|revisar.*inscripci|ver.*estado|mi.*estado|saber.*si.*estoy|estoy.*inscrito|inscripcion.*activa|fui.*admitido|admitido|si me.*inscrib)/i.test(bodyLower);

        if (dniMatch && (isDniOnly || mentionsExpediente)) {
            console.log(`[Flow] DNI detectado: ${dniMatch[0]}, redirigiendo a expediente...`);
            await state.update({ dni: dniMatch[0] });
            return gotoFlow(flowExpedienteProcesar);
        }

        if (mentionsExpediente && !dniMatch) {
            return await flowDynamic('🔍 *VERIFICACIÓN DE EXPEDIENTE E INSCRIPCIÓN*\n\nPuedo consultarte el estado de tu inscripción y el avance de tu carpeta de postulante.\n\nPor favor, escríbeme tu número de *DNI* (8 dígitos) para continuar.');
        }
        // --- FIN DETECCIÓN EXPEDIENTE ---

        let user = loadUserData(userId);
        const cleanBody = normalizeReply(bodyLower);
        const greetings = ['hola', 'buenas', 'inicio', 'comenzar', 'hi', 'hello', 'buenos dias', 'buenas tardes', 'buenas noches'];

        const s = await state.getMyState() || {};
        const isAffirmative = isAffirmativeReply(cleanBody);

        // 1. Manejo de Agradecimientos
        const thanks = ['gracias', 'muchas gracias', 'gracias asesor', 'perfecto gracias', 'ok gracias', 'entendido gracias'];
        if (thanks.some(t => bodyLower.includes(t))) {
            return await flowDynamic(`¡De nada, *${user.nombre || 'estimado'}*! 😊 Fue un gusto ayudarte. Si tienes más dudas en el futuro, aquí estaré. ¡Que tengas un excelente día! 🎓✨`);
        }

        // 1.5. Manejo de selección de brochures pendiente
        if (pendingBrochureSelections.has(userId)) {
            const pending = pendingBrochureSelections.get(userId);
            const selections = cleanBody.split(/[,\s]+/).map(s => parseInt(s.trim())).filter(n => !isNaN(n));

            if (selections.length > 0 && selections.every(n => n >= 1 && n <= pending.length)) {
                pendingBrochureSelections.delete(userId);
                for (const num of selections) {
                    const selected = pending[num - 1];
                    try {
                        const extraInfo = buildProgramExtraInfo(selected);
                        if (extraInfo) {
                            await flowDynamic(extraInfo);
                            await delay(1500);
                        }
                        await flowDynamic([{
                            body: `📄 *Brochure Oficial:* ${selected.nombre}`,
                            media: selected.brochureUrl
                        }]);
                        await delay(1500);
                    } catch (brochErr) {
                        console.error(`[Flow] Error al enviar brochure:`, brochErr.message);
                    }
                }
                return;
            } else if (cleanBody === 'todos' || cleanBody === 'todas') {
                pendingBrochureSelections.delete(userId);
                for (const item of pending) {
                    try {
                        const extraInfo = buildProgramExtraInfo(item);
                        if (extraInfo) {
                            await flowDynamic(extraInfo);
                            await delay(1500);
                        }
                        await flowDynamic([{
                            body: `📄 *Brochure Oficial:* ${item.nombre}`,
                            media: item.brochureUrl
                        }]);
                        await delay(1500);
                    } catch (brochErr) {
                        console.error(`[Flow] Error al enviar brochure:`, brochErr.message);
                    }
                }
                return;
            } else if (cleanBody === 'ninguno' || cleanBody === 'no' || cleanBody === 'cancelar') {
                pendingBrochureSelections.delete(userId);
                return await flowDynamic('✅ Entendido, no se enviarán brochures. ¿En qué más puedo ayudarte?');
            }
            // Si no es un número válido ni comando, limpiar y continuar normalmente
            pendingBrochureSelections.delete(userId);
        }

        // 1.5.1 Confirmación de menú interactivo (Facultades)
        if (pendingCategoryMenuSelections.has(userId)) {
            const menuData = pendingCategoryMenuSelections.get(userId);
            if (/^\d+$/.test(cleanBody)) {
                const index = parseInt(cleanBody, 10);
                if (index === 0) {
                    pendingCategoryMenuSelections.delete(userId);
                    return await flowDynamic('✅ Menú cancelado. ¿En qué más puedo ayudarte?');
                } else if (index > 0 && index <= menuData.faculties.length) {
                    const selectedFaculty = menuData.faculties[index - 1];
                    const programsList = getProgramsForFacultyCategory(selectedFaculty, menuData.category);
                    pendingCategoryMenuSelections.delete(userId);
                    return await flowDynamic(programsList);
                } else {
                    return await flowDynamic(`❌ Número inválido. Por favor, elige un número del 1 al ${menuData.faculties.length}, o 0 para cancelar.`);
                }
            }
            if (['cancelar', 'salir', 'no', 'ninguno'].includes(cleanBody)) {
                pendingCategoryMenuSelections.delete(userId);
                return await flowDynamic('✅ Menú cancelado. ¿En qué más puedo ayudarte?');
            }
            // Si escribe otra cosa que no sea número, lo limpiamos y dejamos que el flujo normal responda
            pendingCategoryMenuSelections.delete(userId);
        }

        // 1.6. Confirmación pendiente para enviar información completa de un programa
        if (pendingProgramInfoSelections.has(userId)) {
            const pending = pendingProgramInfoSelections.get(userId);
            if (isAffirmativeReply(cleanBody) || /\b(envia|envía|mandalo|mándalo|todos)\b/.test(cleanBody)) {
                pendingProgramInfoSelections.delete(userId);
                if (pending.brochureUrl) {
                    await flowDynamic([{ body: `📄 *Brochure Oficial:* ${pending.nombre}`, media: pending.brochureUrl }]);
                } else {
                    await flowDynamic('No encontré un brochure oficial disponible para este programa.');
                }
                return;
            }

            if (['no', 'ninguno', 'cancelar'].includes(cleanBody)) {
                pendingProgramInfoSelections.delete(userId);
                return await flowDynamic('✅ Perfecto, solo te dejo la información corta. Si luego quieres la malla o el brochure, me lo pides.');
            }

            pendingProgramInfoSelections.delete(userId);
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
                const menuObj = getContextForCategory(cat);
                if (menuObj && typeof menuObj === 'object') {
                    pendingCategoryMenuSelections.set(userId, menuObj);
                    console.log(`[Flow] Menú interactivo de categoría enviado: ${cat}`);
                    return await flowDynamic(menuObj.text);
                } else {
                    return await flowDynamic(menuObj || `No se encontraron programas.`);
                }
            }
        }

        const categoryIntent = findCategory(bodyLower);
        const matchedPrograms = findPrograms(body);
        const matchedProgram = findProgram(body);
        const facultyMatch = findFaculty(body);

        // --- DETECCIÓN DE INTENCIONES ESPECÍFICAS (RESPUESTA DIRECTA SIN LLM) ---
        const asksCost = /\b(costo|cuesta|precio|pago|monto|cuanto|cuánto|tarifa|arancel|valor|pagar|banco|cuenta|cci)\b/i.test(bodyLower);
        const asksReqs = /\b(requisito|documento|necesito para|que piden|que se pide|que solicitan|qué necesito|qué debo presentar|documentos)\b/i.test(bodyLower);
        const asksDates = /\b(fecha|cuando|cuándo|plazo|inicio|inicio de clases|cronograma|calendario|admision|admisión|cierre|inscripcion cierra)\b/i.test(bodyLower);
        const asksModality = /\b(modalidad|presencial|virtual|distancia|hibrido|híbrido|clases|como son las clases|como funciona)\b/i.test(bodyLower);
        const asksDuration = /\b(cuanto dura|cuánto dura|duración|duracion|cuantos años|cuántos años|cuantos semestres|ciclos|semestres|tiempo)\b/i.test(bodyLower)
            && /\b(maestria|doctorado|especialidad|programa|posgrado)\b/i.test(bodyLower);
        const asksNextSteps = /\b(que hago|qué hago|que sigue|qué sigue|ahora que|ya (pague|pagué|me inscribi|me inscribí)|pasos a seguir|cual es el siguiente paso)\b/i.test(bodyLower);

        // Respuesta directa de "Qué hacer después"
        if (asksNextSteps && !matchedProgram) {
            const msg = `🎓 *PASOS PARA TU ADMISIÓN - UNAC*\n\nSi ya te decidiste por un programa, estos son los pasos:\n\n1️⃣ *Paga el derecho de admisión* en el Banco Scotiabank.\n2️⃣ *Inscríbete online* en el portal oficial.\n3️⃣ *Sube tus documentos* a la plataforma GED: https://posgradounac.edu.pe/GED/\n4️⃣ *Revisa periódicamente* el estado de tu expediente en el GED.\n\nEscribe *"quiero verificar mi expediente"* junto con tu *DNI* para consultar tu estado actual. ✅`;
            console.log(`[Flow] Respuesta directa de próximos pasos.`);
            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }

        // Respuesta directa de COSTOS por categoría (si hay datos en tipos_programas)
        if (asksCost && categoryIntent && !matchedProgram) {
            const tipoInfo = getTipoProgramaInfo(categoryIntent);
            if (tipoInfo && (tipoInfo.costos || tipoInfo.costo_ciclo)) {
                const label = categoryIntent === 'maestrias' ? 'MAESTRÍA' : categoryIntent === 'doctorados' ? 'DOCTORADO' : 'SEGUNDA ESPECIALIDAD';
                let msg = `💰 *Costos de ${label} - UNAC*\n\n`;
                if (tipoInfo.costos) msg += `📌 *Inscripción:* ${tipoInfo.costos}\n`;
                if (tipoInfo.costo_ciclo) msg += `💵 *Costo por semestre:* ${tipoInfo.costo_ciclo}\n`;
                if (tipoInfo.duracion) msg += `⏳ *Duración:* ${tipoInfo.duracion}\n`;
                if (tipoInfo.numero_cuenta) msg += `🏦 *Cuenta Scotiabank:* ${tipoInfo.numero_cuenta}\n`;
                msg += `\n¿Deseas más información o te explico los pasos de inscripción? 🎓`;
                console.log(`[Flow] Respuesta directa de costos para: ${categoryIntent}`);
                await logInteraction(userId, body, msg, null, 'catalog');
                return await flowDynamic(msg);
            }
        }

        // Respuesta directa de REQUISITOS por categoría (si hay datos en tipos_programas)
        if (asksReqs && categoryIntent && !matchedProgram) {
            const tipoInfo = getTipoProgramaInfo(categoryIntent);
            if (tipoInfo && tipoInfo.requisitos) {
                const label = categoryIntent === 'maestrias' ? 'Maestría' : categoryIntent === 'doctorados' ? 'Doctorado' : 'Segunda Especialidad';
                const msg = `📄 *Requisitos de ${label} - UNAC*\n\n${tipoInfo.requisitos}\n\n*Sube tus documentos en:* https://posgradounac.edu.pe/GED/ ✅`;
                console.log(`[Flow] Respuesta directa de requisitos para: ${categoryIntent}`);
                await logInteraction(userId, body, msg, null, 'catalog');
                return await flowDynamic(msg);
            }
        }

        // Respuesta directa de DURACIÓN si solo hay categoría
        if (asksDuration && categoryIntent && !matchedProgram) {
            const tipoInfo = getTipoProgramaInfo(categoryIntent);
            if (tipoInfo && tipoInfo.duracion) {
                const label = categoryIntent === 'maestrias' ? 'Maestría' : categoryIntent === 'doctorados' ? 'Doctorado' : 'Segunda Especialidad';
                const msg = `⏳ *Duración de ${label} - UNAC*\n\n📚 ${tipoInfo.duracion}${tipoInfo.creditos ? `\n📖 Créditos: ${tipoInfo.creditos}` : ''}\n\n🎓 El grado se otorga con modalidad *PRESENCIAL* (según normativa SUNEDU).`;
                console.log(`[Flow] Respuesta directa de duración para: ${categoryIntent}`);
                await logInteraction(userId, body, msg, null, 'catalog');
                return await flowDynamic(msg);
            }
        }

        // Respuesta directa sobre MODALIDAD (hardcodeada, es la misma para todos)
        if (asksModality && !matchedProgram) {
            const msg = `🎓 *Modalidad de Estudios - UNAC Posgrado*\n\n📍 *Presencial con Herramientas Tecnológicas*\n\n• 80% virtual / 20% presencial\n• Asistencia 1 vez al mes (clase híbrida)\n• El grado académico se otorga con modalidad *PRESENCIAL* (cumple SUNEDU)\n\n¿Hay algo más en lo que pueda orientarte? 😊`;
            console.log(`[Flow] Respuesta directa de modalidad.`);
            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }
        // --- FIN DETECCIÓN INTENCIONES ESPECÍFICAS ---

        if (!matchedProgram && matchedPrograms.length === 0 && isCategoryOnlyRequest(bodyLower, categoryIntent)) {
            const menuObj = getContextForCategory(categoryIntent);
            console.log(`[Flow] Consulta de categoría prioritaria detectada: ${categoryIntent}`);
            if (menuObj && typeof menuObj === 'object') {
                pendingCategoryMenuSelections.set(userId, menuObj);
                await logInteraction(userId, body, menuObj.text, null, 'catalog');
                return await flowDynamic(menuObj.text);
            } else {
                await logInteraction(userId, body, menuObj || '', null, 'catalog');
                return await flowDynamic(menuObj || `No se encontraron programas.`);
            }
        }

        // Detección de consulta general de posgrado ("programas", "oferta académica", etc.)
        const isGeneralPosgradoQuery = /\b(programas?|oferta|posgrado|que\s+ofrecen|que\s+tienen)\b/i.test(bodyLower)
            && !categoryIntent && !matchedProgram && matchedPrograms.length === 0;
        if (isGeneralPosgradoQuery) {
            const generalMsg = getAllProgramsGeneral();
            console.log(`[Flow] Consulta general de posgrado detectada.`);
            await logInteraction(userId, body, generalMsg, null, 'catalog');
            return await flowDynamic(generalMsg);
        }

        if (matchedProgram && matchedPrograms.length === 1) {
            console.log(`[Flow] Programa detectado en catálogo: ${matchedProgram.nombre}`);
            const detailMessage = buildProgramDetailMessage(matchedProgram);
            if (detailMessage) {
                await flowDynamic(detailMessage);
            }

            // Envío AUTOMÁTICO del brochure (sin preguntar)
            const brochureUrl = matchedProgram.brochure;
            if (brochureUrl) {
                await delay(1000);
                try {
                    await flowDynamic([{
                        body: `📄 *Brochure Oficial:* ${matchedProgram.nombre}`,
                        media: brochureUrl
                    }]);
                    console.log(`[Flow] ✅ Brochure enviado automáticamente: ${matchedProgram.nombre}`);
                } catch (brochErr) {
                    console.error(`[Flow] Error al enviar brochure:`, brochErr.message);
                }
            }

            // Loguear interacción
            await logInteraction(userId, body, detailMessage || matchedProgram.nombre, null, 'catalog');
            return;
        }

        if (categoryIntent && isGeneralCategoryRequest(bodyLower, categoryIntent, matchedProgram)) {
            const list = getContextForCategory(categoryIntent);
            console.log(`[Flow] Consulta general de categoría detectada: ${categoryIntent}`);
            await logInteraction(userId, body, list, null, 'catalog');
            return await flowDynamic(list);
        }

        if (matchedPrograms.length > 1) {
            const slicedPrograms = matchedPrograms.slice(0, 8);
            // Formatear los programas añadiéndoles url de brochure para compatibilidad con pendingBrochureSelections
            const programsWithBrochure = slicedPrograms.map(p => ({ ...p, brochureUrl: p.brochure }));
            
            const catalogList = programsWithBrochure.map((program, index) => {
                const facultyLabel = program.facultad ? ` - ${program.facultad}` : '';
                return `*${index + 1}.* ${program.nombre}${facultyLabel}`;
            }).join('\n');

            pendingBrochureSelections.set(userId, programsWithBrochure);

            return await flowDynamic(
                `📋 Encontré varios programas en la base de datos:\n\n${catalogList}\n\n👉 Responde con el *número* del programa que deseas revisar.`
            );
        }

        if (facultyMatch) {
            console.log(`[Flow] Facultad detectada: ${facultyMatch.nombre}`);
            
            let facultyPrograms = [];
            
            if (categoryIntent && facultyMatch[categoryIntent]) {
                Object.values(facultyMatch[categoryIntent]).forEach(p => {
                    facultyPrograms.push({ ...p, facultad: facultyMatch.nombre, tipo: categoryIntent, brochureUrl: p.brochure });
                });
            } else {
                const categories = ['maestrias', 'doctorados', 'especialidades'];
                categories.forEach(cat => {
                    if (facultyMatch[cat]) {
                        Object.values(facultyMatch[cat]).forEach(p => {
                            facultyPrograms.push({ ...p, facultad: facultyMatch.nombre, tipo: cat, brochureUrl: p.brochure });
                        });
                    }
                });
            }

            if (facultyPrograms.length > 0) {
                const slicedPrograms = facultyPrograms.slice(0, 10);
                
                const catalogList = slicedPrograms.map((program, index) => {
                    const typeLabel = program.tipo === 'maestrias' ? 'Maestría' : program.tipo === 'doctorados' ? 'Doctorado' : 'Especialidad';
                    return `*${index + 1}.* [${typeLabel}] ${program.nombre}`;
                }).join('\n');

                pendingBrochureSelections.set(userId, slicedPrograms);

                const filterLabel = categoryIntent ? ` (${categoryIntent.toUpperCase()})` : '';
                return await flowDynamic(
                    `📋 Programas en la *${facultyMatch.nombre}*${filterLabel}:\n\n${catalogList}\n\n👉 Responde con el *número* del programa que deseas revisar.`
                );
            }
            
            return await flowDynamic(getContextForFaculty(facultyMatch));
        }

        // 2. Confirmación de Asesor (REACCION A "SI")
        if (isAffirmative && body.split(' ').length <= 4) {
            if (s.pendingAdvisor) {
                await state.update({ pendingAdvisor: null });
                return gotoFlow(solicitudAsesorFlow);
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
        const programsMatch = matchedPrograms;
        const categoryMatch = categoryIntent;
        let dynamicContext = "";

        if (programsMatch && programsMatch.length > 0) {
            dynamicContext = programsMatch.map(p => `Programa: ${p.nombre}. Info: ${p.descripcion}. Indica que adjuntarás el brochure oficial de este programa.`).join('\n');
            console.log(`[RAG] Programas detectados: ${programsMatch.map(p => p.nombre).join(', ')}`);
        } else if (facultyMatch) {
            dynamicContext = getContextForFaculty(facultyMatch);
            console.log(`[RAG] Facultad detectada: ${facultyMatch.nombre}`);
        } else if (categoryMatch) {
            dynamicContext = getContextForCategory(categoryMatch);
            // Enriquecer con datos de tipos_programas (costos, requisitos, duración)
            const enriched = getEnrichedContextForGrok(categoryMatch);
            if (enriched) dynamicContext += '\n' + enriched;
            console.log(`[RAG] Categoría detectada: ${categoryMatch}`);
        } else {
            dynamicContext = "Contamos con Maestrías, Doctorados y Especialidades en 7 facultades: Salud, Ingeniería (Industrial, Eléctrica, Pesquera), Administración, Contables y Educación.";
            // Agregar contexto enriquecido de todos los tipos
            const enrichedM = getEnrichedContextForGrok('maestrias');
            const enrichedD = getEnrichedContextForGrok('doctorados');
            const enrichedE = getEnrichedContextForGrok('especialidades');
            if (enrichedM || enrichedD || enrichedE) {
                dynamicContext += '\nDatos de programas:\n' + (enrichedM || '') + (enrichedD || '') + (enrichedE || '');
            }
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
        const response = await getGrokCompletion(user.nombre, body, dynamicContext, {
            maxTokens: 180,
            maxContextChars: 900,
        });
        console.log(`[Grok] Respuesta cruda: "${response}"`);

        if (response) {
            // Guardar en Caché
            if (embedding) await saveToCache(body, response, embedding);

            // Manejo de respuesta limpia
            const cleanResponse = response.replace('[SOLICITUD_ASESOR]', '').trim();
            if (cleanResponse) await flowDynamic(cleanResponse);

            // Loguear interacción en chatbot_interactions
            await logInteraction(userId, body, cleanResponse, embedding, 'grok');

            // 7. Enviar Brochures automáticamente si se detectaron programas
            const programsInResponse = findPrograms(response || '');
            const allMatchedPrograms = [...(programsMatch || []), ...(programsInResponse || [])];

            // Eliminar duplicados
            const uniquePrograms = Array.from(new Set(allMatchedPrograms.map(p => p.nombre)))
                .map(nombre => allMatchedPrograms.find(p => p.nombre === nombre))
                .slice(0, 3);

            // Filtrar programas que tengan brochure disponible
            const programsWithBrochure = uniquePrograms
                .map(p => ({ ...p, brochureUrl: p.brochure }))
                .filter(p => p.brochureUrl);

            if (programsWithBrochure.length === 1) {
                // Solo 1 programa → enviar brochure directo (AUTOMÁTICO)
                console.log(`[Flow] Enviando brochure automático: ${programsWithBrochure[0].nombre}`);
                try {
                    await delay(1000);
                    await flowDynamic([{
                        body: `📄 *Brochure Oficial:* ${programsWithBrochure[0].nombre}`,
                        media: programsWithBrochure[0].brochureUrl
                    }]);
                } catch (brochErr) {
                    console.error(`[Flow] Error al enviar brochure:`, brochErr.message);
                }
            } else if (programsWithBrochure.length > 1) {
                // Múltiples programas → mostrar lista y esperar selección
                console.log(`[Flow] ${programsWithBrochure.length} brochures encontrados. Mostrando lista.`);
                const listItems = programsWithBrochure.map((p, i) => `*${i + 1}.* ${p.nombre}`).join('\n');

                pendingBrochureSelections.set(userId, programsWithBrochure);

                await delay(1000);
                await flowDynamic(
                    `📋 Encontré *${programsWithBrochure.length} brochures* disponibles:\n\n` +
                    listItems + '\n\n' +
                    '👉 Responde con el *número* del programa que deseas (ej: *1*), varios separados por coma (ej: *1, 3*), o escribe *todos* para recibirlos todos.'
                );
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

const flowPasosInscripcion = addKeyword([
    'pasos', 'inscribirme', 'inscribirse', 'proceso', 'como hago para inscribirme', 'como me inscribo'
], { regex: false })
    .addAction(async (ctx, { flowDynamic }) => {
        const respuesta = `📌 **¡Paso a paso para completar tu proceso de admisión!** 🎓✨

**1️⃣ Realiza tu inscripción**
Ingresa al siguiente enlace y completa tu registro con tus datos:
👉 https://posgradounac.edu.pe/INSCRIPCION/

**2️⃣ Realiza el pago por derecho de admisión** 💳

El monto dependerá del programa al que postulas:
🎓 **Maestría:** S/ 200
📘 **Segunda Especialidad:** S/ 120
🎖️ **Doctorado:** S/ 250

💥 **Datos de la cuenta bancaria:**
🏦 **Banco:** Scotiabank
**Cuenta:** 000-3747336
**CCI:** 009-100-000003747336-90

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

        // Loguear interacción para entrenamiento
        await logInteraction(ctx.from, ctx.body, respuesta, null, 'catalog');
        return await flowDynamic(respuesta);
    });

const main = async () => {
    console.log('[Bot] Inicializando catálogo desde Supabase...');
    await initCatalog();

    const adapterFlow = createFlow([resetFlow, flowPasosInscripcion, flowExpedienteProcesar, welcomeFlow, solicitudAsesorFlow, mediaFlow])
    const adapterProvider = createProvider(Provider);
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
        console.log(`[DEBUG] Intentando enviar mensaje a ${number}:`, message, options);
        try {
            const result = await originalSendMessage.call(adapterProvider, number, message, options);
            console.log(`[DEBUG] Mensaje enviado exitosamente a ${number}`);

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
        } catch (globalErr) {
            console.error(`[DEBUG] Error catastrofico en originalSendMessage:`, globalErr);
            throw globalErr;
        }
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

    adapterProvider.server.get('/bot/token-usage', (req, res) => {
        try {
            const usage = getTokenUsageSummary();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(usage));
        } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message }));
        }
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



    // --- ENDPOINTS DE REVISIÓN DE RESPUESTAS (ENTRENAMIENTO) ---

    // Listar interacciones pendientes de revisión
    adapterProvider.server.get('/bot/responses-review', async (req, res) => {
        try {
            const reviewed = req.query?.reviewed;
            const source = req.query?.source;
            const limit = parseInt(req.query?.limit) || 50;

            let query = supabase
                .from('chatbot_interactions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (reviewed === 'false') {
                query = query.eq('reviewed', false);
            } else if (reviewed === 'true') {
                query = query.eq('reviewed', true);
            }

            if (source) {
                query = query.eq('source', source);
            }

            const { data, error } = await query;
            if (error) throw error;

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // Aprobar una respuesta como correcta → guardar en semantic_cache
    adapterProvider.server.post('/bot/responses-review/:id/approve', async (req, res) => {
        try {
            const { id } = req.params;

            // 1. Obtener la interacción
            const { data: interaction, error: fetchErr } = await supabase
                .from('chatbot_interactions')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchErr || !interaction) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Interacción no encontrada' }));
            }

            // 2. Generar embedding si no existe
            let embeddingToSave = interaction.embedding;
            if (!embeddingToSave) {
                embeddingToSave = await getEmbedding(interaction.user_query);
            }

            // 3. Guardar en semantic_cache
            if (embeddingToSave) {
                await supabase.from('semantic_cache').insert({
                    question: interaction.user_query,
                    answer: interaction.bot_response,
                    embedding: embeddingToSave,
                });
            }

            // 4. Marcar como revisada y correcta
            await supabase
                .from('chatbot_interactions')
                .update({ reviewed: true, is_correct: true })
                .eq('id', id);

            console.log(`[Review] ✅ Interacción ${id} aprobada y guardada en caché.`);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Respuesta aprobada y guardada en caché semántico' }));
        } catch (err) {
            console.error('[Review] Error al aprobar:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // Corregir una respuesta incorrecta → guardar corrección en cache + knowledge_base
    adapterProvider.server.post('/bot/responses-review/:id/correct', async (req, res) => {
        try {
            const { id } = req.params;
            const { corrected_response } = req.body;

            if (!corrected_response) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Se requiere corrected_response en el body' }));
            }

            // 1. Obtener la interacción original
            const { data: interaction, error: fetchErr } = await supabase
                .from('chatbot_interactions')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchErr || !interaction) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Interacción no encontrada' }));
            }

            // 2. Generar embedding
            let embeddingToSave = interaction.embedding;
            if (!embeddingToSave) {
                embeddingToSave = await getEmbedding(interaction.user_query);
            }

            // 3. Guardar respuesta CORREGIDA en semantic_cache
            if (embeddingToSave) {
                await supabase.from('semantic_cache').insert({
                    question: interaction.user_query,
                    answer: corrected_response,
                    embedding: embeddingToSave,
                });
            }

            // 4. Guardar en knowledge_base para enriquecer el RAG
            const kbEmbedding = await getEmbedding(corrected_response);
            if (kbEmbedding) {
                await supabase.from('knowledge_base').insert({
                    content: `Pregunta: ${interaction.user_query}\nRespuesta correcta: ${corrected_response}`,
                    embedding: kbEmbedding,
                    metadata: { corrected_from: id, original_response: interaction.bot_response },
                });
            }

            // 5. Marcar como revisada e incorrecta con la corrección
            await supabase
                .from('chatbot_interactions')
                .update({
                    reviewed: true,
                    is_correct: false,
                    corrected_response: corrected_response,
                })
                .eq('id', id);

            console.log(`[Review] ✏️ Interacción ${id} corregida. Guardada en caché + knowledge_base.`);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Respuesta corregida y guardada en caché semántico + base de conocimientos' }));
        } catch (err) {
            console.error('[Review] Error al corregir:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    // Estadísticas de revisión
    adapterProvider.server.get('/bot/responses-review/stats', async (req, res) => {
        try {
            const { data: allData, error } = await supabase
                .from('chatbot_interactions')
                .select('reviewed, is_correct, source');

            if (error) throw error;

            const stats = {
                total: allData.length,
                pending: allData.filter(d => !d.reviewed).length,
                approved: allData.filter(d => d.reviewed && d.is_correct === true).length,
                corrected: allData.filter(d => d.reviewed && d.is_correct === false).length,
                by_source: {},
            };

            allData.forEach(d => {
                stats.by_source[d.source] = (stats.by_source[d.source] || 0) + 1;
            });

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(stats));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
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
        let targetNumber = wa_id || telefono;

        if (!targetNumber || !dni) {
            return res.writeHead(400).end(JSON.stringify({ error: 'Faltan wa_id/telefono o dni' }));
        }

        targetNumber = targetNumber.includes('@') ? targetNumber : `${targetNumber}@s.whatsapp.net`;

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

    // NOTA: El endpoint /api/enviar-mensaje fue eliminado.
    // El bot ya no recibe peticiones externas del formulario PHP para enviar mensajes automáticos.
    // Los mensajes ahora son iniciados manualmente o vía /v1/enviar-datos con control de cola.

    try {
        httpServer(+PORT);
        console.log(`[Bot] Servidor listo en puerto ${PORT}`);
    } catch (e) { console.error('[Bot] Error en servidor:', e); }
};

main();
