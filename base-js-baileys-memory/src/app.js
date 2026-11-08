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
import { supabase, supabaseData } from './services/supabaseClient.js'
import { getEmbedding } from './services/embeddingService.js'
import { checkInscriptionByDni } from './services/inscriptionService.js'
import { login, logout, verifyToken, listUsers, createUser, updateUser, deleteUser, getAudit, getAgentStats, writeAudit } from './services/adminAuth.js'
import { initCatalog, findProgram, findPrograms, getSummaryContext, findFaculty, getContextForFaculty, findCategory, getContextForCategory, getAllProgramNamesOnly, findProgramFuzzy, getAllProgramsGeneral, getAllProgramsByCategory, getTipoProgramaInfo, getEnrichedContextForGrok, getProgramsForFacultyCategory, getCatalog, formatProgramsCatalogList } from './services/catalogService.js'
import { loadUsers, saveUser, loadUserData, resetUserData, getLeadsCounter, incrementLeadsCounter } from './services/userService.js'

// Flujos Modulares
import { flowExpedienteProcesar } from './flows/flowExpediente.js'
import { resetFlow, solicitudAsesorFlow, mediaFlow, flowPasosInscripcion, flowExamenAdmision } from './flows/flowInscripcion.js'

// Rutas HTTP Modulares
import { registerKnowledgeRoutes } from './routes/knowledgeRoutes.js'
import { registerReviewRoutes } from './routes/reviewRoutes.js'
import { registerAuthRoutes } from './routes/authRoutes.js'
import { registerMessagingRoutes } from './routes/messagingRoutes.js'

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


const STOPWORDS_NO_CACHE = /^(si|sí|no|nop|ok|okay|vale|claro|ya|gracias|hola|buenas|informacion|programas|asesor|humano|1|2|3|4|5|todos|todas|ninguno|ninguna)$/i;

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
        if (!question || typeof question !== 'string') return;
        const cleanQ = question.trim().toLowerCase();
        if (cleanQ.length < 10) return; // Rechazar preguntas cortas (< 10 caracteres)
        if (STOPWORDS_NO_CACHE.test(cleanQ)) return; // Rechazar stopwords o comandos comunes
        if (!answer || typeof answer !== 'string' || answer.trim().length < 20) return; // Rechazar respuestas vacías o erróneas

        await supabase.from('semantic_cache').insert({
            question: question.trim(),
            answer: answer.trim(),
            embedding
        })
    } catch (e) { console.error('[Cache] Error al guardar:', e) }
}

/**
 * Wrapper para Grok con RAG Dinámico
 */
const getGrokCompletion = async (userName, message, context = '', options = {}) => {
    try {
        const cleanContext = compactContext(context, options.maxContextChars ?? 2500);
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
 * Sincroniza datos de estudiante y conversación en Supabase
 */
async function syncUserToSupabase(waId, user) {
    try {
        await supabase.from('students').upsert({
            wa_id: waId,
            full_name: user?.nombre || null,
            student_condition: user?.rol || null,
            phone_number: waId,
            updated_at: new Date().toISOString()
        }, { onConflict: 'wa_id' });

        await supabase.from('conversations').upsert({
            wa_id: waId,
            metadata: {
                user_role: user?.rol || null,
                user_condition: user?.rol || null,
                full_name: user?.nombre || null
            },
            updated_at: new Date().toISOString()
        }, { onConflict: 'wa_id' });
    } catch (e) {
        console.error('[Supabase] Error sincronizando estudiante/conversación:', e.message);
    }
}

/**
 * Activa la transferencia a un asesor humano en Supabase y notifica al usuario
 */
async function activateHumanHandoff(waId, flowDynamic) {
    try {
        await supabase
            .from('conversations')
            .update({ status: 'human_active', updated_at: new Date().toISOString() })
            .eq('wa_id', waId);
    } catch (e) {
        console.error('[Flow] Error activando human_active:', e.message);
    }
    return await flowDynamic([
        '👨‍💼 *Entendido. He transferido tu solicitud a un asesor humano.*',
        'Uno de nuestros coordinadores se comunicará contigo en los próximos minutos para ayudarte personalmente. Mientras tanto, puedes dejar tu consulta detallada aquí. 👇'
    ]);
}

/**
 * Loguea una interacción del bot para análisis analítico y revisión posterior
 */
const logInteraction = async (waId, userQuery, botResponse, embedding, source = 'grok', customName = null, customCondition = null) => {
    try {
        const u = loadUserData(waId);
        const nameToSave = customName || u?.nombre || null;
        const conditionToSave = customCondition || u?.rol || null;

        await supabase.from('chatbot_interactions').insert({
            wa_id: waId,
            user_name: nameToSave,
            user_condition: conditionToSave,
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

// Auto-limpiar selecciones pendientes cada 10 minutos (prevención de memory leak)
setInterval(() => {
    const maxAge = 5 * 60 * 1000; // 5 minutos
    const now = Date.now();
    for (const [key, val] of pendingBrochureSelections) {
        if (val._ts && now - val._ts > maxAge) pendingBrochureSelections.delete(key);
    }
    for (const [key, val] of pendingCategoryMenuSelections) {
        if (val._ts && now - val._ts > maxAge) pendingCategoryMenuSelections.delete(key);
    }
    for (const [key, val] of pendingProgramInfoSelections) {
        if (val._ts && now - val._ts > maxAge) pendingProgramInfoSelections.delete(key);
    }
}, 10 * 60 * 1000);


// Ayuda de retardo
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const ASSETS_DIR = path.join(process.cwd(), 'assets');
const SAMPLE_FALLBACK = path.join(ASSETS_DIR, 'sample.png');

async function sendSafeMediaList(flowDynamic, items) {
    for (const item of items) {
        let mediaPath = item.path;
        if (!mediaPath || !fs.existsSync(mediaPath)) {
            if (fs.existsSync(SAMPLE_FALLBACK)) {
                mediaPath = SAMPLE_FALLBACK;
            } else {
                mediaPath = null;
            }
        }
        if (mediaPath) {
            try {
                await flowDynamic([{
                    body: item.caption || '',
                    media: mediaPath
                }]);
            } catch (err) {
                console.error('[Flow] Error al enviar media:', err.message);
                if (item.caption) {
                    await flowDynamic(item.caption);
                }
            }
        } else if (item.caption) {
            await flowDynamic(item.caption);
        }
        await delay(1200);
    }
}

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
        let groupLink = 'https://chat.whatsapp.com/L3SLkM8yYgw2iCfcAOEzYI?s=cl&p=a&mlu=4&ilr=4'; // Default
        if (targetProgram && targetProgram.link_ws) {
            groupLink = targetProgram.link_ws;
        } else {
            const p = programa.toLowerCase();
            if (p.includes('maestria')) groupLink = 'https://chat.whatsapp.com/L3SLkM8yYgw2iCfcAOEzYI?s=cl&p=a&mlu=4&ilr=4';
            else if (p.includes('doctorado')) groupLink = 'https://chat.whatsapp.com/L3SLkM8yYgw2iCfcAOEzYI?s=cl&p=a&mlu=4&ilr=4';
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
👉https://chat.whatsapp.com/L3SLkM8yYgw2iCfcAOEzYI?s=cl&p=a&mlu=4&ilr=4

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
        let user = loadUserData(userId);
        const cleanBody = normalizeReply(bodyLower);
        const isAffirmative = isAffirmativeReply(cleanBody);
        const s = await state.getMyState() || {};

        // --- MANEJO DE CONFIRMACIÓN DE ASESOR (PENDIENTE) ---
        if (user.esperandoConfirmacionAsesor || s.pendingAdvisor) {
            if (isAffirmative || cleanBody.includes('asesor') || cleanBody.includes('humano') || cleanBody.includes('coordinador')) {
                user.esperandoConfirmacionAsesor = false;
                saveUser(userId, user);
                await state.update({ pendingAdvisor: null });
                try {
                    await supabase
                        .from('conversations')
                        .update({ status: 'human_active', updated_at: new Date().toISOString() })
                        .eq('wa_id', userId);
                } catch (e) {
                    console.error('[Flow] Error activando human_active:', e.message);
                }
                return await flowDynamic([
                    '👨‍💼 *Modo Asesor Activado*',
                    'Uno de nuestros coordinadores se comunicará contigo en los próximos minutos para ayudarte personalmente.',
                    'Por favor, déjanos tu consulta detallada para asistirte de inmediato. 📋✨'
                ]);
            } else if (/^(no|nop|cancelar|ninguno|ninguna)/.test(cleanBody)) {
                user.esperandoConfirmacionAsesor = false;
                saveUser(userId, user);
                await state.update({ pendingAdvisor: null });
                return await flowDynamic('Entendido. Estaré aquí si necesitas cualquier otra información sobre la Escuela de Posgrado UNAC. ¿Tienes alguna otra consulta? 😊');
            } else {
                user.esperandoConfirmacionAsesor = false;
                saveUser(userId, user);
                await state.update({ pendingAdvisor: null });
            }
        }

        // --- GATING 1: IDENTIFICACIÓN OBLIGATORIA (NOMBRE COMPLETO) ---
        const greetings = ['hola', 'buenas', 'inicio', 'comenzar', 'hi', 'hello', 'buenos dias', 'buenas tardes', 'buenas noches'];

        if (!user.nombre || user.esperandoNombre) {
            const looksLikeName = /^[a-záéíóúñüA-ZÁÉÍÓÚÑÜ\s]{3,60}$/.test(body.trim()) && body.trim().split(/\s+/).length >= 1;
            if (user.esperandoNombre && !greetings.includes(bodyLower) && looksLikeName) {
                user.nombre = body.trim();
                user.esperandoNombre = false;
                user.esperandoRol = true;
                saveUser(userId, user);

                await syncUserToSupabase(userId, user);

                return await flowDynamic(
                    `¡Mucho gusto, *${user.nombre}*! 🎓👋\n\n` +
                    `Para orientarte con la información adecuada, indícame tu condición:\n\n` +
                    `1️⃣ *Postulante* (deseo postular a un posgrado)\n` +
                    `2️⃣ *Estudiante* (actualmente cursando en posgrado UNAC)\n` +
                    `3️⃣ *Egresado* (culminé mis estudios de posgrado)\n\n` +
                    `👉 _Responde con el número (1, 2 o 3) o escribe tu condición._`
                );
            }

            if (user.esperandoNombre && !looksLikeName && body.length > 2 && !greetings.includes(bodyLower)) {
                return await flowDynamic('Por favor, escríbeme tu *nombre completo* (solo letras). Ejemplo: _Juan Pérez López_ ✍️');
            }

            user.esperandoNombre = true;
            saveUser(userId, user);
            return await flowDynamic(
                '🌟 *BIENVENIDO A LA ESCUELA DE POSGRADO DE LA UNIVERSIDAD NACIONAL DEL CALLAO* 🎓\n\n' +
                'Aquí, la excelencia académica se combina con el compromiso y la vocación de servicio.\n\n' +
                'Para brindarte una atención personalizada, ¿cuál es tu *nombre completo* para empezar? ✍️'
            );
        }

        // --- GATING 2: CALIFICACIÓN DE ROL (POSTULANTE / ESTUDIANTE / EGRESADO) ---
        if (user.esperandoRol || !user.rol) {
            const isPostulante = /^(1|postulan)/i.test(cleanBody);
            const isEstudiante = /^(2|estudian|alumn)/i.test(cleanBody);
            const isEgresado = /^(3|egresad|graduad)/i.test(cleanBody);

            if (isPostulante) {
                user.rol = 'postulante';
                user.esperandoRol = false;
                saveUser(userId, user);
                await syncUserToSupabase(userId, user);

                await flowDynamic(
                    `¡Excelente, *${user.nombre}*! 🎓 Como *Postulante*, te presento nuestra oferta académica:\n\n` +
                    `• 📘 *Maestrías:* Formación avanzada e investigación en diversas especialidades.\n` +
                    `• 📕 *Doctorados:* El más alto grado académico para la producción científica.\n` +
                    `• 📗 *Segundas Especialidades:* Especialización técnica y profesional.\n\n` +
                    `Te comparto nuestro material informativo oficial: 📄👇`
                );
                await delay(800);
                await sendSafeMediaList(flowDynamic, [
                    { path: path.join(ASSETS_DIR, 'info_1.jpg'), caption: '📌 Programas y modalidades de posgrado UNAC' },
                    { path: path.join(ASSETS_DIR, 'info_2.jpg'), caption: '🗓️ Calendario y fechas del proceso de admisión' },
                    { path: path.join(ASSETS_DIR, 'info_3.jpg'), caption: '📝 Requisitos e inversión económica' }
                ]);
                await delay(800);
                return await flowDynamic(
                    `✨ *Modo Asistente Activo*\n` +
                    `Puedes hacerme cualquier pregunta o elegir una opción:\n\n` +
                    `1️⃣ Ver catálogo de *Maestrías*\n` +
                    `2️⃣ Ver catálogo de *Segundas Especialidades*\n` +
                    `3️⃣ Ver catálogo de *Doctorados*\n` +
                    `4️⃣ Hablar con un *Asesor Humano*\n\n` +
                    `👉 _Escribe un número (1-4), el nombre de un programa o tu consulta._`
                );
            } else if (isEstudiante) {
                user.rol = 'estudiante';
                user.esperandoRol = false;
                saveUser(userId, user);
                await syncUserToSupabase(userId, user);

                await flowDynamic(
                    `¡Bienvenido, *${user.nombre}*! 📚 Como *Estudiante* de posgrado UNAC, estamos para apoyarte en tus gestiones académicas.\n\n` +
                    `Te comparto el directorio oficial de contactos y oficinas por facultad:`
                );
                await delay(800);
                await sendSafeMediaList(flowDynamic, [
                    { path: path.join(ASSETS_DIR, 'contactos_facultades.jpg'), caption: '📞 Directorio de contactos y oficinas por facultad - Posgrado UNAC' }
                ]);
                await delay(800);
                return await flowDynamic(
                    `¿En qué trámite académico podemos orientarte hoy? ✍️\n\n` +
                    `1️⃣ *Matrícula y Cronograma*\n` +
                    `2️⃣ *Pagos y Cuentas Bancarias*\n` +
                    `3️⃣ *Mesa de Partes Virtual (GED)*\n` +
                    `4️⃣ *Hablar con un Coordinador / Asesor*\n\n` +
                    `👉 _Elige una opción (1-4) o escribe tu consulta directamente._`
                );
            } else if (isEgresado) {
                user.rol = 'egresado';
                user.esperandoRol = false;
                saveUser(userId, user);
                await syncUserToSupabase(userId, user);

                await flowDynamic(
                    `¡Un gusto saludarte, *${user.nombre}*! 🎓 Como *Egresado* de posgrado UNAC, te apoyamos en tus trámites de graduación y certificaciones.\n\n` +
                    `Te comparto el directorio oficial de contactos y oficinas por facultad:`
                );
                await delay(800);
                await sendSafeMediaList(flowDynamic, [
                    { path: path.join(ASSETS_DIR, 'contactos_facultades.jpg'), caption: '📞 Directorio de contactos y oficinas por facultad - Posgrado UNAC' }
                ]);
                await delay(800);
                return await flowDynamic(
                    `¿En qué trámite podemos orientarte hoy? ✍️\n\n` +
                    `1️⃣ *Grados y Títulos* (Requisitos y expedientes)\n` +
                    `2️⃣ *Constancias y Certificados de Estudios*\n` +
                    `3️⃣ *Mesa de Partes Virtual (GED)*\n` +
                    `4️⃣ *Hablar con un Coordinador / Asesor*\n\n` +
                    `👉 _Elige una opción (1-4) o escribe tu consulta directamente._`
                );
            } else {
                user.esperandoRol = true;
                saveUser(userId, user);
                return await flowDynamic(
                    `Por favor, elige tu condición ingresando el número correspondiente:\n\n` +
                    `1️⃣ *Postulante*\n` +
                    `2️⃣ *Estudiante*\n` +
                    `3️⃣ *Egresado*\n\n` +
                    `👉 _Escribe 1, 2 o 3._`
                );
            }
        }

        // --- DETECCIÓN AUTOMÁTICA DE DNI / EXPEDIENTE / INSCRIPCIÓN ---
        const dniMatch = body.match(/\b\d{8}\b/);
        const isDniOnly = /^\d{8}$/.test(body.replace(/[^0-9]/g, ''));
        const mentionsDni = /(dni|documento|identidad)/i.test(bodyLower);
        const esperandoDni = s.esperandoDni;

        // Detectar intención de verificar expediente o inscripción con frases naturales
        const mentionsExpediente = /(expediente|estado de mi|mi inscripci|verificar.*inscripci|verificar.*expediente|consultar.*inscripci|consultar.*expediente|revisar.*expediente|revisar.*inscripci|ver.*estado|mi.*estado|saber.*si.*estoy|estoy.*inscrito|inscripcion.*activa|fui.*admitido|admitido|si me.*inscrib)/i.test(bodyLower);

        if (dniMatch && (isDniOnly || mentionsExpediente || mentionsDni || esperandoDni)) {
            console.log(`[Flow] DNI detectado: ${dniMatch[0]}, redirigiendo a expediente...`);
            await state.update({ dni: dniMatch[0], esperandoDni: false });
            return gotoFlow(flowExpedienteProcesar);
        }

        // Si estaba esperando DNI pero el usuario escribió otra cosa, limpiar el estado
        if (esperandoDni && !dniMatch) {
            await state.update({ esperandoDni: false });
        }

        if (mentionsExpediente && !dniMatch) {
            await state.update({ esperandoDni: true });
            return await flowDynamic('🔍 *VERIFICACIÓN DE EXPEDIENTE E INSCRIPCIÓN*\n\nPuedo consultarte el estado de tu inscripción y el avance de tu carpeta de postulante.\n\nPor favor, escríbeme tu número de *DNI* (8 dígitos) para continuar.');
        }
        // --- FIN DETECCIÓN EXPEDIENTE ---

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
        const asesorKeywords = ['solicitud asesor', 'quiero un asesor', 'necesito un asesor', 'ayuda humana', 'hablar con alguien', 'quiero hablar con una persona', 'necesito ayuda real', 'agente humano', 'operador', 'hablar con un humano', 'comunicarme con un asesor'];
        if (asesorKeywords.some(k => bodyLower.includes(k))) {
            console.log(`[Handoff] Usuario ${userId} solicitó asesor humano directamente.`);
            return await activateHumanHandoff(userId, flowDynamic);
        }

        // 2.1 Atajo prioritario: "necesito informacion" o "programas" -> Enviar 3 imágenes
        const isInfoTrigger = /\b(necesito\s+informaci[oó]n|quiero\s+informaci[oó]n|m[aá]s\s+informaci[oó]n|dame\s+informaci[oó]n|informaci[oó]n\s+general)\b/i.test(bodyLower);
        const isProgramasTrigger = /\b(programas?|oferta\s+acad[eé]mica|qu[eé]\s+programas?)\b/i.test(bodyLower);

        if ((isInfoTrigger || isProgramasTrigger) && !/\b(maestr[ií]as?|doctorados?|especialidades?)\b/i.test(bodyLower)) {
            console.log(`[Flow] Disparador de información/programas detectado para ${userId}`);
            await flowDynamic(`📄 *OFERTA ACADÉMICA Y PROCESO DE ADMISIÓN - UNAC*\nAquí tienes la información oficial:`);
            await delay(600);
            await sendSafeMediaList(flowDynamic, [
                { path: path.join(ASSETS_DIR, 'info_1.jpg'), caption: '📌 Programas y modalidades de posgrado UNAC' },
                { path: path.join(ASSETS_DIR, 'info_2.jpg'), caption: '🗓️ Calendario y fechas del proceso de admisión' },
                { path: path.join(ASSETS_DIR, 'info_3.jpg'), caption: '📝 Requisitos e inversión económica' }
            ]);
            await delay(600);
            return await flowDynamic(
                `👉 Puedes escribir:\n` +
                `• *Información maestrías*\n` +
                `• *Información especialidades*\n` +
                `• *Información doctorados*\n\n` +
                `O indícame el nombre del programa específico que te interesa. ✨`
            );
        }

        // 2.2 Atajos de Catálogos (Maestrías, Especialidades, Doctorados)
        const isMaestriasTrigger = /\b(informaci[oó]n\s+maestr[ií]as?|maestr[ií]as?)\b/i.test(bodyLower);
        if (isMaestriasTrigger && !findProgram(body)) {
            console.log(`[Flow] Listado de maestrías solicitado.`);
            const msg = formatProgramsCatalogList('maestrias');
            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }

        const isEspecialidadesTrigger = /\b(informaci[oó]n\s+(?:segundas?\s+)?especialidades?|(?:segundas?\s+)?especialidades?)\b/i.test(bodyLower);
        if (isEspecialidadesTrigger && !findProgram(body)) {
            console.log(`[Flow] Listado de especialidades solicitado.`);
            const msg = formatProgramsCatalogList('especialidades');
            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }

        const isDoctoradosTrigger = /\b(informaci[oó]n\s+doctorados?|doctorados?)\b/i.test(bodyLower);
        if (isDoctoradosTrigger && !findProgram(body)) {
            console.log(`[Flow] Listado de doctorados solicitado.`);
            const msg = formatProgramsCatalogList('doctorados');
            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }

        // 2.3 Opciones Guiadas y Menú por Rol (Postulante / Estudiante / Egresado)
        const isOption1 = /^(1|uno|opci[oó]n\s*1)$/i.test(cleanBody);
        const isOption2 = /^(2|dos|opci[oó]n\s*2)$/i.test(cleanBody);
        const isOption3 = /^(3|tres|opci[oó]n\s*3)$/i.test(cleanBody);
        const isOption4 = /^(4|cuatro|opci[oó]n\s*4)$/i.test(cleanBody);

        // Intenciones específicas de Estudiante
        const isMatriculaTrigger = /\b(matr[ií]cula|cronograma|inscribir\s+cursos|asignaturas|sga)\b/i.test(bodyLower);
        const isPagosTrigger = /\b(pagos?|cuotas?|scotiabank|banco|comprobante|voucher|arancel)\b/i.test(bodyLower);
        const isGedTrigger = /\b(ged|mesa\s+de\s+partes|tr[aá]mite\s+virtual)\b/i.test(bodyLower);

        // Intenciones específicas de Egresado
        const isGradosTrigger = /\b(grados?|t[ií]tulos?|tesis|graduaci[oó]n|sustentaci[oó]n|diploma)\b/i.test(bodyLower);
        const isConstanciasTrigger = /\b(constancias?|certificados?|no\s+adeudo)\b/i.test(bodyLower);

        if (user.rol === 'estudiante') {
            if (isOption1 || isMatriculaTrigger) {
                const msg = `📅 *MATRÍCULA Y CRONOGRAMA ACADÉMICO - POSGRADO UNAC*\n\n` +
                    `• *Sistema SGA (Matrícula en línea):* https://sga.unac.edu.pe\n` +
                    `• *Cronograma Académico:* Las fechas de matrícula regular y extemporánea se rigen por la resolución de cada facultad y el calendario académico oficial.\n` +
                    `• *Requisitos:* Estar al día con las cuotas académicas y registrar tus asignaturas en el SGA.\n\n` +
                    `¿Deseas ayuda adicional o comunicarte con la coordinación de tu facultad? Responde *asesor*. 👨‍💼`;
                await logInteraction(userId, body, msg, null, 'student_guide');
                return await flowDynamic(msg);
            }
            if (isOption2 || isPagosTrigger) {
                const msg = `💳 *PAGOS Y CUENTAS BANCARIAS - POSGRADO UNAC*\n\n` +
                    `• *Entidad:* Banco Scotiabank (Ventanilla, Agentes o App Scotiabank).\n` +
                    `• *Identificación:* Brindar tu número de DNI o código de alumno al realizar el pago.\n` +
                    `• *Validación obligatoria:* Todo comprobante de pago debe registrarse en la plataforma GED para su validación oficial: https://posgradounac.edu.pe/GED/\n\n` +
                    `⚠️ Conserva tu voucher o constancia digital para cualquier gestión académica.`;
                await logInteraction(userId, body, msg, null, 'student_guide');
                return await flowDynamic(msg);
            }
            if (isOption3 || isGedTrigger) {
                const msg = `📑 *MESA DE PARTES VIRTUAL (GED) - UNAC*\n\n` +
                    `La plataforma de Gestión Electrónica de Documentos (GED) es el canal oficial para todo trámite:\n\n` +
                    `🌐 *Portal GED:* https://posgradounac.edu.pe/GED/\n` +
                    `⏰ *Horario de recepción:* Lunes a Viernes de 08:00 a 16:00 horas.\n\n` +
                    `Puedes ingresar solicitudes de convalidación, registro de comprobantes, reclamos o cartas a la Dirección de Posgrado.`;
                await logInteraction(userId, body, msg, null, 'student_guide');
                return await flowDynamic(msg);
            }
            if (isOption4) {
                return await activateHumanHandoff(userId, flowDynamic);
            }
        }

        if (user.rol === 'egresado') {
            if (isOption1 || isGradosTrigger) {
                const msg = `🎓 *GRADOS Y TÍTULOS - POSGRADO UNAC*\n\n` +
                    `Para la obtención del grado académico de Maestro o Doctor:\n\n` +
                    `1️⃣ Aprobar el 100% de créditos del plan de estudios del programa.\n` +
                    `2️⃣ Acreditar el idioma extranjero correspondiente (Intermedio para Maestría / Avanzado para Doctorado).\n` +
                    `3️⃣ Elaborar, sustentar y aprobar la tesis de posgrado o trabajo de investigación.\n` +
                    `4️⃣ Presentar tu expediente de graduación mediante el portal GED: https://posgradounac.edu.pe/GED/\n\n` +
                    `Si requieres orientación con tu expediente de grado, escribe *asesor*. 👨‍💼`;
                await logInteraction(userId, body, msg, null, 'graduate_guide');
                return await flowDynamic(msg);
            }
            if (isOption2 || isConstanciasTrigger) {
                const msg = `📜 *CONSTANCIAS Y CERTIFICADOS DE ESTUDIOS*\n\n` +
                    `Trámites disponibles para egresados de posgrado:\n\n` +
                    `• *Certificado de Estudios de Posgrado*\n` +
                    `• *Constancia de Egresado*\n` +
                    `• *Constancia de No Adeudo (Académico y Biblioteca)*\n\n` +
                    `📌 *Procedimiento:* Paga la tasa respectiva en Scotiabank y adjunta la solicitud junto al comprobante en la mesa de partes GED: https://posgradounac.edu.pe/GED/`;
                await logInteraction(userId, body, msg, null, 'graduate_guide');
                return await flowDynamic(msg);
            }
            if (isOption3 || isGedTrigger) {
                const msg = `📑 *MESA DE PARTES VIRTUAL (GED) - UNAC*\n\n` +
                    `Ingresa tus expedientes de graduación, solicitudes de constancia o trámites a la Dirección de Posgrado:\n\n` +
                    `🌐 *Enlace:* https://posgradounac.edu.pe/GED/\n` +
                    `⏰ *Horario de atención:* Lunes a Viernes de 08:00 a 16:00 horas.`;
                await logInteraction(userId, body, msg, null, 'graduate_guide');
                return await flowDynamic(msg);
            }
            if (isOption4) {
                return await activateHumanHandoff(userId, flowDynamic);
            }
        }

        if (user.rol === 'postulante') {
            if (isOption1) {
                const msg = formatProgramsCatalogList('maestrias');
                await logInteraction(userId, body, msg, null, 'catalog');
                return await flowDynamic(msg);
            }
            if (isOption2) {
                const msg = formatProgramsCatalogList('especialidades');
                await logInteraction(userId, body, msg, null, 'catalog');
                return await flowDynamic(msg);
            }
            if (isOption3) {
                const msg = formatProgramsCatalogList('doctorados');
                await logInteraction(userId, body, msg, null, 'catalog');
                return await flowDynamic(msg);
            }
            if (isOption4) {
                return await activateHumanHandoff(userId, flowDynamic);
            }
        }

        // 2.4 Manejo de afirmaciones / negaciones huérfanas (sin confirmación previa activa)
        const isOrphanAffirmative = isAffirmativeReply(cleanBody) || /^(si|sí|claro|por favor|porfa|dale|ok|okay|vale|yes)$/i.test(cleanBody);
        const isOrphanNegative = /^(no|nop|para nada|ninguno|ninguna)$/i.test(cleanBody);

        if (isOrphanAffirmative) {
            if (user.rol === 'postulante') {
                return await flowDynamic(
                    `¡Perfecto, *${user.nombre || 'estimado'}*! 😊 ¿En qué te gustaría orientarte?\n\n` +
                    `1️⃣ Ver catálogo de *Maestrías*\n` +
                    `2️⃣ Ver catálogo de *Segundas Especialidades*\n` +
                    `3️⃣ Ver catálogo de *Doctorados*\n` +
                    `4️⃣ Hablar directamente con un *Asesor Humano*\n\n` +
                    `👉 _Escribe el número de tu preferencia o hazme tu consulta específica._`
                );
            } else if (user.rol === 'estudiante') {
                return await flowDynamic(
                    `¡Entendido, *${user.nombre || 'estimado'}*! 📚 ¿Con qué trámite te ayudamos?\n\n` +
                    `1️⃣ *Matrícula y Cronograma*\n` +
                    `2️⃣ *Pagos y Cuentas Bancarias*\n` +
                    `3️⃣ *Mesa de Partes Virtual (GED)*\n` +
                    `4️⃣ *Hablar con un Coordinador / Asesor*\n\n` +
                    `👉 _Responde con el número (1-4) o escribe tu trámite._`
                );
            } else if (user.rol === 'egresado') {
                return await flowDynamic(
                    `¡Excelente, *${user.nombre || 'estimado'}*! 🎓 ¿Qué gestión deseas realizar?\n\n` +
                    `1️⃣ *Grados y Títulos*\n` +
                    `2️⃣ *Constancias y Certificados*\n` +
                    `3️⃣ *Mesa de Partes Virtual (GED)*\n` +
                    `4️⃣ *Hablar con un Coordinador / Asesor*\n\n` +
                    `👉 _Responde con el número (1-4) o escribe tu consulta._`
                );
            } else {
                return await flowDynamic(
                    `¡Entendido! ¿En qué programa o trámite de Posgrado UNAC te gustaría que te oriente? 🎓`
                );
            }
        }

        if (isOrphanNegative) {
            return await flowDynamic(
                `Entendido, *${user.nombre || 'estimado'}*. Si necesitas información sobre admisión, matrículas o trámites de posgrado, estaré aquí para ayudarte. 😊\n\n` +
                `Si en algún momento prefieres hablar con una persona, solo escribe *asesor*. ¡Que tengas un excelente día! ✨`
            );
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
            const catResult = getContextForCategory(categoryIntent);
            console.log(`[Flow] Consulta general de categoría detectada: ${categoryIntent}`);
            if (catResult && typeof catResult === 'object') {
                pendingCategoryMenuSelections.set(userId, { ...catResult, _ts: Date.now() });
                await logInteraction(userId, body, catResult.text, null, 'catalog');
                return await flowDynamic(catResult.text);
            } else {
                await logInteraction(userId, body, catResult || '', null, 'catalog');
                return await flowDynamic(catResult || 'No se encontraron programas.');
            }
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

        // 4. Caché Semántico
        let embedding = null;
        const isEligibleForCache = body.trim().length >= 8 && !STOPWORDS_NO_CACHE.test(cleanBody);

        try {
            if (isEligibleForCache) {
                embedding = await getEmbedding(body);
                if (embedding) {
                    const cachedAnswer = await checkSemanticCache(embedding);
                    if (cachedAnswer) {
                        console.log(`[Cache] Coincidencia encontrada para: "${body}"`);
                        await logInteraction(userId, body, cachedAnswer, null, 'cache');
                        return await flowDynamic(cachedAnswer);
                    }
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
            const catCtx = getContextForCategory(categoryMatch);
            dynamicContext = (typeof catCtx === 'object') ? catCtx.text : (catCtx || '');
            // Enriquecer con datos de tipos_programas (costos, requisitos, duración)
            const enriched = getEnrichedContextForGrok(categoryMatch);
            if (enriched) dynamicContext += '\n' + enriched;
            console.log(`[RAG] Categoría detectada: ${categoryMatch}`);
        } else {
            const catalog = getCatalog();
            const numFacultades = catalog ? Object.keys(catalog).length : 0;
            const nombresFacultades = catalog ? Object.values(catalog).map(f => f.nombre).join(', ') : '';
            dynamicContext = `Contamos con Maestrías, Doctorados y Especialidades en ${numFacultades} facultades: ${nombresFacultades}.`;
            // Agregar contexto enriquecido de todos los tipos
            const enrichedM = getEnrichedContextForGrok('maestrias');
            const enrichedD = getEnrichedContextForGrok('doctorados');
            const enrichedE = getEnrichedContextForGrok('especialidades');
            if (enrichedM || enrichedD || enrichedE) {
                dynamicContext += '\nDatos de programas:\n' + (enrichedM || '') + (enrichedD || '') + (enrichedE || '');
            }
        }

        // 5.5 RAG 2.0 Complementario (Supabase Knowledge Base con Metadata)
        if (!embedding && isEligibleForCache) {
            try {
                embedding = await getEmbedding(body);
            } catch (embErr) {
                console.error('[Flow] Error obteniendo embedding para RAG 2.0:', embErr.message);
            }
        }
        if (embedding) {
            const filterMeta = {};
            if (categoryMatch) filterMeta.tipo = categoryMatch;

            const { data: documents } = await supabase.rpc('match_documents_filtered', {
                query_embedding: embedding,
                match_threshold: 0.45, // Calibrado para MiniLM en español
                match_count: 3,
                filter_meta: filterMeta
            });

            if (documents && documents.length > 0) {
                const extraContext = documents.map(d => d.content).join('\n\n');
                dynamicContext += `\n\n${extraContext}`;
                console.log(`[RAG 2.0] ${documents.length} fragmentos recuperados de Supabase.`);
            } else {
                // REGISTRO DE DUDA NO RESUELTA (Feedback Loop)
                console.log(`[RAG 2.0] ⚠️ Sin coincidencia clara. Registrando duda para entrenamiento...`);
                await supabase.from('unresolved_queries').insert({
                    query: body,
                    wa_id: userId,
                    user_name: user.nombre || null,
                    user_condition: user.rol || null,
                    embedding: embedding
                });
            }
        }

        // 6. Consulta Grok
        const response = await getGrokCompletion(user.nombre, body, dynamicContext, {
            maxTokens: 180,
            maxContextChars: 2500,
        });
        console.log(`[Grok] Respuesta cruda: "${response}"`);

        if (response) {
            // Guardar en Caché (solo si NO es solicitud de asesor)
            const isSolicitudAsesor = response.includes('[SOLICITUD_ASESOR]');
            if (embedding && !isSolicitudAsesor) await saveToCache(body, response, embedding);

            // Manejo de respuesta limpia
            const cleanResponse = response.replace('[SOLICITUD_ASESOR]', '').trim();

            if (isSolicitudAsesor && !cleanResponse) {
                // La IA no supo responder — preguntar al usuario si desea un asesor
                console.log(`[Flow] IA no pudo responder para ${userId}. Ofreciendo asesor.`);
                user.esperandoConfirmacionAsesor = true;
                saveUser(userId, user);
                await state.update({ pendingAdvisor: true });
                return await flowDynamic('Lo siento, no tengo suficiente información en mi sistema para responder eso con certeza. 😔\n\n¿Deseas que te comunique con un *asesor humano*? Uno de nuestros coordinadores se comunicará contigo en los próximos minutos para ayudarte personalmente. 👨‍💼📞\n\n👉 Responde *SÍ* para transferirte con un asesor o escribe tu consulta de otra manera.');
            } else {
                if (cleanResponse) await flowDynamic(cleanResponse);

                // Loguear interacción en chatbot_interactions
                await logInteraction(userId, body, cleanResponse, embedding, 'grok');

                // 7. Enviar Brochures automáticamente si se detectaron programas en lo que el usuario escribió
                const allMatchedPrograms = [...(programsMatch || [])];

                // Eliminar duplicados
                const uniquePrograms = Array.from(new Set(allMatchedPrograms.map(p => p.nombre)))
                    .map(nombre => allMatchedPrograms.find(p => p.nombre === nombre))
                    .slice(0, 3);

                // Filtrar programas que tengan brochure disponible
                const programsWithBrochure = uniquePrograms
                    .map(p => ({ ...p, brochureUrl: p.brochure }))
                    .filter(p => p.brochureUrl);

                if (programsWithBrochure.length === 1) {
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
                    console.log(`[Flow] ${programsWithBrochure.length} brochures encontrados. Mostrando lista.`);
                    const listItems = programsWithBrochure.map((p, i) => `*${i + 1}.* ${p.nombre}`).join('\n');

                    pendingBrochureSelections.set(userId, { ...programsWithBrochure, _ts: Date.now() });

                    await delay(1000);
                    await flowDynamic(
                        `📋 Encontré *${programsWithBrochure.length} brochures* disponibles:\n\n` +
                        listItems + '\n\n' +
                        '👉 Responde con el *número* del programa que deseas (ej: *1*), varios separados por coma (ej: *1, 3*), o escribe *todos* para recibirlos todos.'
                    );
                }

                // Si la IA además incluyó [SOLICITUD_ASESOR] con texto extra, ofrecer asesor sin forzar
                if (isSolicitudAsesor) {
                    console.log(`[Flow] IA sugirió derivación para ${userId}. Ofreciendo asesor.`);
                    await delay(800);
                    await flowDynamic(
                        '¿Deseas que te comunique con un *asesor humano*? Uno de nuestros coordinadores se comunicará contigo en los próximos minutos para ayudarte personalmente. 👨‍💼📞\n\n' +
                        '👉 Responde *SÍ* para transferirte con un asesor.'
                    );
                    user.esperandoConfirmacionAsesor = true;
                    saveUser(userId, user);
                    await state.update({ pendingAdvisor: true });
                }
            }
        } else {
            user.esperandoConfirmacionAsesor = true;
            saveUser(userId, user);
            await state.update({ pendingAdvisor: true });
            await flowDynamic(
                'Lo siento, no pude procesar tu consulta con exactitud. 😔\n\n' +
                '¿Deseas que te comunique con un *asesor humano*? Uno de nuestros coordinadores se comunicará contigo en los próximos minutos para ayudarte personalmente. 👨‍💼📞\n\n' +
                '👉 Responde *SÍ* para transferirte con un asesor o escribe tu consulta de otra manera.'
            );
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
    console.log('[Bot] Inicializando catálogo desde Supabase...');
    await initCatalog();

    const adapterFlow = createFlow([resetFlow, flowExamenAdmision, flowPasosInscripcion, flowExpedienteProcesar, welcomeFlow, solicitudAsesorFlow, mediaFlow])
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
            const { id: msgId, wa_id, text, media_url, sent_by, sent_by_name } = payload.new;
            console.log(`[Dashboard] 📩 Recibida solicitud de envío para ${wa_id} (Operador: ${sent_by_name || 'Desconocido'})`);

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

                // Trazabilidad en Audit Log: registrar el envío del operador
                await writeAudit({
                    actorId: sent_by || null,
                    actorUsername: sent_by_name || 'operador',
                    action: 'send_message',
                    targetType: 'message',
                    targetId: msgId ? String(msgId) : cleanWa,
                    details: {
                        wa_id: cleanWa,
                        has_media: !!media_url,
                        text_preview: text ? (text.length > 80 ? text.substring(0, 80) + '...' : text) : 'Archivo adjunto'
                    }
                });
            } catch (err) {
                console.error(`[Dashboard] ❌ ERROR al enviar a ${target}:`, err);
                _dashboardPendingSends.delete(`${cleanWa}:${text || ''}`);
            }
        })
        .subscribe();

    // Rutas modulares de Conocimiento, RAG y Revisión
    registerKnowledgeRoutes(adapterProvider.server, { supabase, getEmbedding });
    registerReviewRoutes(adapterProvider.server, { supabase, getEmbedding });

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    // Rutas modulares de Mensajería Externa, Administración / RBAC y Handoff
    registerMessagingRoutes(adapterProvider.server, { 
        handleCtx, 
        supabase, 
        supabaseData,
        getLeadsCounter, 
        incrementLeadsCounter, 
        apiQueue, 
        processApiQueue, 
        adapterProvider 
    });
    registerAuthRoutes(adapterProvider.server, { 
        login, 
        logout, 
        verifyToken, 
        listUsers, 
        createUser, 
        updateUser, 
        deleteUser, 
        getAudit, 
        getAgentStats, 
        writeAudit, 
        supabase 
    });

    try {
        httpServer(+PORT);
        console.log(`[Bot] Servidor listo en puerto ${PORT}`);
    } catch (e) { console.error('[Bot] Error en servidor:', e); }
};

main();
