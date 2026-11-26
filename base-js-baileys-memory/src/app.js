import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import axios from 'axios';
import cors from 'cors';
import express from 'express';
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from '@builderbot/bot';
import { MemoryDB as Database } from '@builderbot/bot';
import { BaileysProvider as Provider } from '@builderbot/provider-baileys';
import {
    getGrokCompletion as originalGetGrokCompletion,
    getTokenUsageSummary,
    flushTokenUsageSync
} from './grokClient.js';

// Servicios
import { supabase, supabaseData } from './services/supabaseClient.js';
import { closeLocalDbPools } from './services/dbClient.js';
import { getEmbedding } from './services/embeddingService.js';
import {
    login,
    logout,
    verifyToken,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    getAudit,
    getAgentStats,
    writeAudit
} from './services/adminAuth.js';
import {
    initCatalog,
    findProgram,
    findPrograms,
    findFaculty,
    getContextForFaculty,
    findCategory,
    getContextForCategory,
    findProgramFuzzy,
    getAllProgramsGeneral,
    getTipoProgramaInfo,
    getEnrichedContextForGrok,
    getProgramsForFacultyCategory,
    getCatalog,
    formatProgramsCatalogList
} from './services/catalogService.js';
import {
    saveUser,
    loadUserData,
    flushUsersSync
} from './services/userService.js';
import {
    initBotSettings,
    getBotSettings,
    buildInstitutionalContextSummary,
    buildAdmissionStepsMessage
} from './services/settingsService.js';
import {
    withAdminAuth,
    sendJsonResponse
} from './services/httpAuthMiddleware.js';
import {
    shouldBlockAutomatedFlow,
    setConversationStatusCache,
    isValidHumanName,
    appendConversationTurn,
    getRecentConversationTurns,
    normalizeWaId
} from './services/flowGuardService.js';
import {
    recoverStuckLeadJobs,
    triggerLeadQueueWorker,
    stopLeadQueueWorker
} from './services/leadQueueService.js';

// Flujos Modulares
import { flowExpedienteProcesar } from './flows/flowExpediente.js';
import { resetFlow, mediaFlow, flowPasosInscripcion, flowExamenAdmision } from './flows/flowInscripcion.js';

// Rutas HTTP Modulares
import { registerKnowledgeRoutes } from './routes/knowledgeRoutes.js';
import { registerReviewRoutes } from './routes/reviewRoutes.js';
import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerMessagingRoutes } from './routes/messagingRoutes.js';
import { registerSettingsRoutes } from './routes/settingsRoutes.js';
import { registerWebChatRoutes } from './routes/webChatRoutes.js';

// Agente TLS aislado ÚNICAMENTE para descargas de PDFs en posgradounac.edu.pe si su cadena intermedia SSL falla
const unacLegacyHttpsAgent = new https.Agent({ rejectUnauthorized: false });

async function sendMediaWithScopedUnacFallback(sendFn, caption, mediaUrl) {
    if (!mediaUrl) return;
    try {
        await sendFn(caption, mediaUrl);
    } catch (err) {
        let isUnacHost = false;
        try {
            const parsed = new URL(mediaUrl);
            isUnacHost = parsed.protocol === 'https:' && parsed.hostname.endsWith('posgradounac.edu.pe');
        } catch {
            isUnacHost = false;
        }

        if (!isUnacHost) throw err;

        console.warn(`[Media TLS Fallback] Reintentando descarga aislada desde posgradounac.edu.pe para brochure...`);
        const tmpFile = path.join(os.tmpdir(), `brochure_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.pdf`);
        try {
            const response = await axios.get(mediaUrl, {
                responseType: 'arraybuffer',
                httpsAgent: unacLegacyHttpsAgent,
                timeout: 12_000,
                maxContentLength: 25 * 1024 * 1024
            });
            await fs.promises.writeFile(tmpFile, Buffer.from(response.data));
            await sendFn(caption, tmpFile);
        } finally {
            fs.promises.unlink(tmpFile).catch(() => {});
        }
    }
}

// Mapas de selecciones interactivas pendientes (todos estandarizados con _ts para limpieza automática)
const pendingBrochureSelections = new Map();     // userId -> { items: Array, _ts: number }
const pendingCategoryMenuSelections = new Map(); // userId -> { text, faculties, category, _ts: number }
const pendingProgramInfoSelections = new Map();  // userId -> { ...program, _ts: number }

function buildProgramExtraInfo(program) {
    if (!program) return '';

    const sections = [];
    if (program.descripcion) {
        sections.push(`*📖 Descripción:*\n${program.descripcion}`);
    }
    if (program.perfiles_programa) {
        sections.push(`*🎯 Perfil del Egresado:*\n${formatProgramField(program.perfiles_programa)}`);
    }
    if (sections.length === 0) return '';

    return `✨ *Conoce más de tu programa:*\n\n${sections.join('\n\n')}`;
}

function buildProgramDetailMessage(program) {
    if (!program) return '';
    const s = getBotSettings();

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

    if (program.tipo) {
        const tipoInfo = getTipoProgramaInfo(program.tipo);
        const fallbackDur = program.tipo === 'doctorados' ? s.pagos.duracion_doctorado : program.tipo === 'especialidades' ? s.pagos.duracion_especialidad : s.pagos.duracion_maestria;
        const fallbackInsc = program.tipo === 'doctorados' ? s.pagos.inscripcion_doctorado : program.tipo === 'especialidades' ? s.pagos.inscripcion_especialidad : s.pagos.inscripcion_maestria;
        const fallbackCiclo = program.tipo === 'doctorados' ? s.pagos.semestre_doctorado : program.tipo === 'especialidades' ? s.pagos.semestre_especialidad : s.pagos.semestre_maestria;

        const duracion = tipoInfo?.duracion || fallbackDur;
        const costos = tipoInfo?.costos || fallbackInsc;
        const costoCiclo = tipoInfo?.costo_ciclo || fallbackCiclo;

        let extraInfo = '';
        if (duracion) extraInfo += `⏳ *Duración:* ${duracion}\n`;
        if (costos) extraInfo += `💰 *Costo Inscripción:* ${costos}\n`;
        if (costoCiclo) extraInfo += `💵 *Costo por Ciclo:* ${costoCiclo}\n`;
        extraInfo += `🗓️ *Cierre de Inscripciones (${s.admision.proceso_actual}):* ${s.admision.cierre_inscripciones}\n`;

        if (extraInfo) {
            lines.push(`---\n${extraInfo.trim()}`);
        }

        if (tipoInfo?.requisitos) {
            lines.push(`---\n📄 *Requisitos Generales:*\n${tipoInfo.requisitos}`);
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

function compactContext(context, maxChars = 2500) {
    if (!context) return '';
    const compact = context
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n')
        .replace(/[ \t]+/g, ' ')
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
        'de', 'del', 'la', 'el', 'las', 'los', 'un', 'una', 'unos', 'unas', 'sobre', 'mas',
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

// --- Cron Job (Limpieza de conversaciones human_active inactivas) ---
setInterval(async () => {
    try {
        console.log('[Cron] Ejecutando reset_inactive_conversations...');
        const { error } = await supabase.rpc('reset_inactive_conversations', { timeout_minutes: 240 });
        if (error) console.error('[Cron] Error al limpiar inactivos:', error);
    } catch (e) {
        console.error('[Cron] Excepción:', e);
    }
}, 60 * 60 * 1000).unref?.();

const PORT = process.env.PORT ?? 3000;
const STOPWORDS_NO_CACHE = /^(si|sí|no|nop|ok|okay|vale|claro|ya|gracias|hola|buenas|informacion|programas|asesor|humano|1|2|3|4|5|todos|todas|ninguno|ninguna)$/i;

/**
 * Consulta de Caché Semántico (alimentado exclusivamente por respuestas aprobadas/corregidas en Dashboard)
 */
const checkSemanticCache = async (embedding) => {
    try {
        const { data, error } = await supabase.rpc('match_semantic_cache', {
            query_embedding: embedding,
            match_threshold: 0.95,
        });
        if (error) throw error;
        return data?.[0]?.answer || null;
    } catch (e) {
        console.error('[Cache] Error:', e.message || e);
        return null;
    }
};

/**
 * Wrapper para Groq con RAG Dinámico + Parámetros Institucionales Vivos + Ventana de Memoria Corta
 */
const getGrokCompletion = async (userName, message, context = '', options = {}) => {
    try {
        const institutionalSummary = buildInstitutionalContextSummary();
        const combinedContext = `${institutionalSummary}\n\n${context || ''}`.trim();
        const cleanContext = compactContext(combinedContext, options.maxContextChars ?? 2800);

        const systemPrompt = `Eres el Asesor Académico Virtual de la Escuela de Posgrado de la UNAC (Universidad Nacional del Callao).

REGLAS ESTRICTAS:
1. Responde SOLO con datos del contexto proporcionado. NUNCA inventes cifras, fechas ni requisitos.
2. Si el contexto tiene costos o cuentas → úsalos exactamente sin alterar cifras.
3. Si preguntan por fechas → da exactamente las del PROCESO VIGENTE del contexto.
4. Si preguntan por requisitos → lista los del contexto numerados y ordenados.
5. Responde en máximo 3-5 líneas concisas, directas y con buena estructura.
6. Si el usuario consulta por un tema, tecnología o especialidad académica afín a nuestras facultades (ej. ciberseguridad, big data, logística, finanzas, salud ocupacional), ORIENTA al postulante indicando qué programas oficiales afines ofrece la UNAC en esa facultad y cómo se vinculan. Solo si el usuario solicita expresamente hablar con una persona ("asesor", "humano") o si es un trámite administrativo personal que no puedes responder, responde únicamente [SOLICITUD_ASESOR].
7. No menciones otras universidades ni compares precios.
8. Trato cordial y profesional personalizado (${userName || 'estimado postulante'}), usa viñetas o negritas para nombres de programas.`;

        const historyTurns = Array.isArray(options.historyTurns) ? options.historyTurns : [];
        const messages = [
            { role: 'system', content: cleanContext ? `${systemPrompt}\n\nContexto disponible:\n${cleanContext}` : systemPrompt },
            ...historyTurns,
            { role: 'user', content: message }
        ];

        const grokResponse = await originalGetGrokCompletion(messages, {
            maxTokens: options.maxTokens ?? 180,
            temperature: options.temperature ?? 0.2,
            model: options.model,
        });
        return grokResponse.choices?.[0]?.message?.content || null;
    } catch (e) {
        console.error('[Grok] Error:', e.message || e);
        return null;
    }
};

/**
 * Sincroniza datos de estudiante y conversación en Supabase
 */
async function syncUserToSupabase(waId, user) {
    const cleanId = normalizeWaId(waId);
    try {
        await supabase.from('students').upsert({
            wa_id: cleanId,
            full_name: user?.nombre || null,
            student_condition: user?.rol || null,
            phone_number: cleanId,
            updated_at: new Date().toISOString()
        }, { onConflict: 'wa_id' });

        await supabase.from('conversations').upsert({
            wa_id: cleanId,
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
 * Activa la transferencia a un asesor humano en Supabase, actualiza caché local y notifica al usuario
 */
async function activateHumanHandoff(waId, flowDynamic) {
    const cleanId = normalizeWaId(waId);
    setConversationStatusCache(cleanId, 'human_active');
    try {
        await supabase
            .from('conversations')
            .update({ status: 'human_active', updated_at: new Date().toISOString() })
            .eq('wa_id', cleanId);
    } catch (e) {
        console.error('[Flow] Error activando human_active:', e.message);
    }
    return await flowDynamic([
        '👨‍💼 *Entendido. He transferido tu solicitud a un asesor humano.*',
        'Uno de nuestros coordinadores se comunicará contigo en los próximos minutos para ayudarte personalmente. Mientras tanto, puedes dejar tu consulta detallada aquí. 👇'
    ]);
}

/**
 * Loguea una interacción del bot para analítica y revisión en la consola de entrenamiento
 */
const logInteraction = async (waId, userQuery, botResponse, embedding, source = 'grok', customName = null, customCondition = null) => {
    try {
        const cleanId = normalizeWaId(waId);
        const u = loadUserData(cleanId);
        const nameToSave = customName || u?.nombre || null;
        const conditionToSave = customCondition || u?.rol || null;

        await supabase.from('chatbot_interactions').insert({
            wa_id: cleanId,
            user_name: nameToSave,
            user_condition: conditionToSave,
            user_query: userQuery,
            bot_response: botResponse || '',
            embedding: embedding || null,
            source: source,
        });
    } catch (e) {
        console.error('[Interactions] Error al loguear interacción:', e.message);
    }
};

// Auto-limpiar selecciones pendientes cada 5 minutos
setInterval(() => {
    const maxAge = 5 * 60 * 1000;
    const now = Date.now();
    for (const [key, val] of pendingBrochureSelections) {
        if (!val?._ts || now - val._ts > maxAge) pendingBrochureSelections.delete(key);
    }
    for (const [key, val] of pendingCategoryMenuSelections) {
        if (!val?._ts || now - val._ts > maxAge) pendingCategoryMenuSelections.delete(key);
    }
    for (const [key, val] of pendingProgramInfoSelections) {
        if (!val?._ts || now - val._ts > maxAge) pendingProgramInfoSelections.delete(key);
    }
}, 5 * 60 * 1000).unref?.();

const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const ASSETS_DIR = path.join(process.cwd(), 'assets');
const SAMPLE_FALLBACK = path.join(ASSETS_DIR, 'sample.png');

async function sendSafeMediaList(flowDynamic, items) {
    for (const item of items) {
        let mediaPath = item.path;
        if (!mediaPath || !fs.existsSync(mediaPath)) {
            mediaPath = fs.existsSync(SAMPLE_FALLBACK) ? SAMPLE_FALLBACK : null;
        }
        if (mediaPath) {
            try {
                await flowDynamic([{
                    body: item.caption || '',
                    media: mediaPath
                }]);
            } catch (err) {
                console.error('[Flow] Error al enviar media:', err.message);
                if (item.caption) await flowDynamic(item.caption);
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
 * LÓGICA DE ENVÍO AUTOMATIZADO DE LEADS (Alimentado desde bot_settings dinámicos)
 */
async function procesarEnvioMensaje(target, nombre, facultad, programa, provider) {
    console.log(`[Flow] Preparando envío para: ${nombre} - Programa: "${programa}"`);
    if (!provider || typeof provider.sendMessage !== 'function') {
        throw new Error('El objeto provider no está listo o no dispone de sendMessage');
    }

    const s = getBotSettings();
    const numero = target;
    const progStr = String(programa || '');
    const targetProgram = findProgramFuzzy(progStr);

    const groupLink = targetProgram?.link_ws || s.enlaces.whatsapp_admision_general;

    let precio = s.pagos.inscripcion_maestria;
    let duracion = s.pagos.duracion_maestria;
    let cuenta = s.pagos.cuenta_general;
    let cci = s.pagos.cci_general;
    let costo = s.pagos.semestre_maestria;
    let matricula = s.pagos.matricula_maestria;
    let reqDoc = 'Copia del Grado Académico de Bachiller.';

    const p = progStr.toLowerCase();
    if (p.includes('doctorado')) {
        precio = s.pagos.inscripcion_doctorado;
        duracion = s.pagos.duracion_doctorado;
        cuenta = s.pagos.cuenta_general;
        cci = s.pagos.cci_general;
        costo = s.pagos.semestre_doctorado;
        matricula = s.pagos.matricula_doctorado;
        reqDoc = 'Copia del Grado Académico de Maestro, Constancia de egresado de Maestría o Certificado de Estudios de Maestría.';
    } else if (p.includes('especialidad')) {
        precio = s.pagos.inscripcion_especialidad;
        duracion = s.pagos.duracion_especialidad;
        cuenta = s.pagos.cuenta_especialidad;
        cci = s.pagos.cci_especialidad;
        costo = s.pagos.semestre_especialidad;
        matricula = s.pagos.matricula_especialidad;
        reqDoc = 'Copia del Título Profesional universitario.';
    }

    // 1. Bienvenida
    const saludo = `🎓 ¡Hola ${nombre}! Felicidades.\n*Somos de la Escuela de Posgrado de la UNAC*\n🚀 Ya te encuentras registrado para nuestro programa de *${targetProgram ? targetProgram.nombre : progStr}*.`;
    await provider.sendMessage(numero, saludo, {});
    await delay(2500);

    // 2. Descripción y Perfil
    if (targetProgram) {
        let detallesExtra = '';
        if (targetProgram.descripcion) detallesExtra += `\n*📖 Descripción:*\n${targetProgram.descripcion}\n`;
        if (targetProgram.perfiles_programa) {
            const perfilFormat = formatSupabaseField(targetProgram.perfiles_programa);
            detallesExtra += `\n*🎯 Perfil del Egresado:*\n${perfilFormat}\n`;
        }

        if (detallesExtra) {
            await provider.sendMessage(numero, `✨ *Conoce más de tu programa:*\n${detallesExtra}`, {});
            await delay(2500);
        }
    }

    const infoText = `💥 *Detalles de Inscripción (${s.admision.proceso_actual}):*
📌 Inscripción: ${precio}
🏦 Banco: ${s.pagos.banco} (Cta: ${cuenta} / CCI: ${cci})
⏳ Duración: ${duracion}
📌 Matrícula: ${matricula}
💵 Costo Semestre: ${costo}

📅 *Fechas Clave:*
🖋 Inscripciones: ${s.admision.cierre_inscripciones}
📍 Evaluación / Examen: ${s.admision.fecha_examen}
🎒 Inicio Clases: ${s.admision.inicio_clases}

📍 *Modalidad:*
${s.modalidad_atencion.modalidad_titulo}
${s.modalidad_atencion.modalidad_resumen}

🔗 *Únete al grupo de WhatsApp oficial:*
${groupLink}`;

    await provider.sendMessage(numero, infoText, {});
    await delay(2000);

    if (targetProgram?.malla_curricular) {
        const mallaFormat = formatSupabaseField(targetProgram.malla_curricular);
        await provider.sendMessage(numero, `📚 *Malla Curricular:*\n${mallaFormat}`, {});
        await delay(2500);
    }

    const requirementsText = `📝 *REQUISITOS DE INSCRIPCIÓN:*
1️⃣ Ficha de Postulante y Hoja de Vida llenadas virtualmente en nuestro sistema.
2️⃣ Copia legible del DNI o Pasaporte.
3️⃣ Foto actual a color (opcional).
4️⃣ ${reqDoc}

*Nota:* Los grados del extranjero deben estar registrados en SUNEDU.`;

    await provider.sendMessage(numero, requirementsText, {});
    await delay(2500);

    // 3. Brochure
    if (targetProgram?.brochure) {
        await provider.sendMessage(numero, `📄 Te adjunto el brochure oficial del programa:`, {});
        await delay(1200);
        await sendMediaWithScopedUnacFallback(
            (caption, mediaSrc) => provider.sendMessage(numero, caption, {
                media: mediaSrc,
                fileName: `brochure-${targetProgram.nombre}.pdf`.replace(/\s+/g, '_')
            }),
            'Brochure Oficial 📄',
            targetProgram.brochure
        );
    } else {
        await provider.sendMessage(numero, `📍 Si deseas el brochure de este programa, escríbeme el nombre exacto o solicita un asesor.`, {});
    }
    await delay(2000);

    // 4. Siguientes pasos dinámicos
    await provider.sendMessage(numero, buildAdmissionStepsMessage(getTipoProgramaInfo), {});
}


const welcomeFlow = addKeyword([EVENTS.WELCOME, /.*/])
    .addAction(async (ctx, { flowDynamic, state, gotoFlow, endFlow }) => {
        const userId = ctx.from;
        const body = ctx.body?.trim() || '';
        if (!body) return;

        // --- GUARDA UNIFICADA: RATE LIMIT + HANDOVER HUMANO (FAIL-SAFE) ---
        const guard = await shouldBlockAutomatedFlow(userId, flowDynamic);
        if (guard.blocked) {
            return endFlow();
        }

        const settings = getBotSettings();
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
                return await activateHumanHandoff(userId, flowDynamic);
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

        // --- GATING 1: IDENTIFICACIÓN OBLIGATORIA (NOMBRE COMPLETO VALIDADO) ---
        const greetings = ['hola', 'buenas', 'inicio', 'comenzar', 'hi', 'hello', 'buenos dias', 'buenas tardes', 'buenas noches'];

        if (!user.nombre || user.esperandoNombre) {
            const validName = isValidHumanName(body);

            if (user.esperandoNombre && !greetings.includes(cleanBody) && validName) {
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

            // Preservar consulta sustantiva si el usuario escribió su duda directamente antes de identificarse
            if (!greetings.includes(cleanBody) && body.length > 6 && !user.pendingInitialQuery) {
                user.pendingInitialQuery = body;
            }

            if (user.esperandoNombre && !validName && body.length > 2 && !greetings.includes(cleanBody)) {
                saveUser(userId, user);
                return await flowDynamic(
                    'Para continuar y resolver tu consulta, por favor indícame primero tu *nombre y apellido* (solo letras, sin preguntas).\n\nEjemplo: _Juan Pérez López_ ✍️'
                );
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

            if (isPostulante || isEstudiante || isEgresado) {
                const savedInitialQuery = user.pendingInitialQuery || null;
                user.rol = isPostulante ? 'postulante' : isEstudiante ? 'estudiante' : 'egresado';
                user.esperandoRol = false;
                user.pendingInitialQuery = null;
                saveUser(userId, user);
                await syncUserToSupabase(userId, user);

                if (isPostulante) {
                    await flowDynamic(
                        `¡Excelente, *${user.nombre}*! 🎓 Como *Postulante*, te presento nuestra oferta académica (${settings.admision.proceso_actual}):\n\n` +
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
                    const promptSuffix = savedInitialQuery
                        ? `\n\n💡 _Recuerdo que consultaste sobre: "${savedInitialQuery}". Escríbelo o elige una opción abajo para responderte al instante._`
                        : '';
                    return await flowDynamic(
                        `✨ *Modo Asistente Activo*\n` +
                        `Puedes hacerme cualquier pregunta o elegir una opción:\n\n` +
                        `1️⃣ Ver catálogo de *Maestrías*\n` +
                        `2️⃣ Ver catálogo de *Segundas Especialidades*\n` +
                        `3️⃣ Ver catálogo de *Doctorados*\n` +
                        `4️⃣ Hablar con un *Asesor Humano*\n\n` +
                        `👉 _Escribe un número (1-4), el nombre de un programa o tu consulta._${promptSuffix}`
                    );
                }

                if (isEstudiante) {
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
                }

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

        const mentionsExpediente = /(expediente|estado de mi|mi inscripci|verificar.*inscripci|verificar.*expediente|consultar.*inscripci|consultar.*expediente|revisar.*expediente|revisar.*inscripci|ver.*estado|mi.*estado|saber.*si.*estoy|estoy.*inscrito|inscripcion.*activa|fui.*admitido|admitido|si me.*inscrib)/i.test(bodyLower);

        if (dniMatch && (isDniOnly || mentionsExpediente || mentionsDni || esperandoDni)) {
            console.log(`[Flow] DNI detectado: ${dniMatch[0]}, redirigiendo a expediente...`);
            await state.update({ dni: dniMatch[0], esperandoDni: false });
            return gotoFlow(flowExpedienteProcesar);
        }

        if (esperandoDni && !dniMatch) {
            await state.update({ esperandoDni: false });
        }

        if (mentionsExpediente && !dniMatch) {
            await state.update({ esperandoDni: true });
            return await flowDynamic('🔍 *VERIFICACIÓN DE EXPEDIENTE E INSCRIPCIÓN*\n\nPuedo consultarte el estado de tu inscripción y el avance de tu carpeta de postulante.\n\nPor favor, escríbeme tu número de *DNI* (8 dígitos) para continuar.');
        }

        // 1. Manejo de Agradecimientos
        const thanks = ['gracias', 'muchas gracias', 'gracias asesor', 'perfecto gracias', 'ok gracias', 'entendido gracias'];
        if (thanks.some(t => bodyLower.includes(t))) {
            return await flowDynamic(`¡De nada, *${user.nombre || 'estimado'}*! 😊 Fue un gusto ayudarte. Si tienes más dudas en el futuro, aquí estaré. ¡Que tengas un excelente día! 🎓✨`);
        }

        // 1.5. Manejo estandarizado de selección de brochures pendiente ({ items: Array, _ts })
        if (pendingBrochureSelections.has(userId)) {
            const pendingEntry = pendingBrochureSelections.get(userId);
            const pendingItems = Array.isArray(pendingEntry?.items)
                ? pendingEntry.items
                : (Array.isArray(pendingEntry) ? pendingEntry : []);

            const selections = cleanBody
                .split(/[,\s]+/)
                .map(str => parseInt(str.trim(), 10))
                .filter(n => !Number.isNaN(n));

            if (pendingItems.length > 0 && selections.length > 0 && selections.every(n => n >= 1 && n <= pendingItems.length)) {
                pendingBrochureSelections.delete(userId);
                for (const num of selections) {
                    const selected = pendingItems[num - 1];
                    try {
                        const detailMsg = buildProgramDetailMessage(selected) || buildProgramExtraInfo(selected);
                        if (detailMsg) {
                            await flowDynamic(detailMsg);
                            await delay(1200);
                        }
                        if (selected.brochureUrl || selected.brochure) {
                            const mediaTarget = selected.brochureUrl || selected.brochure;
                            await sendMediaWithScopedUnacFallback(
                                (caption, mediaSrc) => flowDynamic([{ body: caption, media: mediaSrc }]),
                                `📄 *Brochure Oficial:* ${selected.nombre}`,
                                mediaTarget
                            );
                            await delay(1200);
                        }
                    } catch (brochErr) {
                        console.error(`[Flow] Error al enviar brochure seleccionado:`, brochErr.message);
                    }
                }
                return;
            } else if (pendingItems.length > 0 && (cleanBody === 'todos' || cleanBody === 'todas')) {
                pendingBrochureSelections.delete(userId);
                for (const item of pendingItems) {
                    try {
                        const extraInfo = buildProgramExtraInfo(item);
                        if (extraInfo) {
                            await flowDynamic(extraInfo);
                            await delay(1200);
                        }
                        if (item.brochureUrl || item.brochure) {
                            const mediaTarget = item.brochureUrl || item.brochure;
                            await sendMediaWithScopedUnacFallback(
                                (caption, mediaSrc) => flowDynamic([{ body: caption, media: mediaSrc }]),
                                `📄 *Brochure Oficial:* ${item.nombre}`,
                                mediaTarget
                            );
                            await delay(1200);
                        }
                    } catch (brochErr) {
                        console.error(`[Flow] Error al enviar brochure múltiple:`, brochErr.message);
                    }
                }
                return;
            } else if (cleanBody === 'ninguno' || cleanBody === 'no' || cleanBody === 'cancelar') {
                pendingBrochureSelections.delete(userId);
                return await flowDynamic('✅ Entendido, no se enviarán brochures. ¿En qué más puedo ayudarte?');
            }
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
                } else if (Array.isArray(menuData?.faculties) && index > 0 && index <= menuData.faculties.length) {
                    const selectedFaculty = menuData.faculties[index - 1];
                    const programsList = getProgramsForFacultyCategory(selectedFaculty, menuData.category);
                    pendingCategoryMenuSelections.delete(userId);
                    await logInteraction(userId, body, programsList, null, 'catalog');
                    return await flowDynamic(programsList);
                } else {
                    return await flowDynamic(`❌ Número inválido. Por favor, elige un número del 1 al ${menuData?.faculties?.length || 1}, o 0 para cancelar.`);
                }
            }
            if (['cancelar', 'salir', 'no', 'ninguno'].includes(cleanBody)) {
                pendingCategoryMenuSelections.delete(userId);
                return await flowDynamic('✅ Menú cancelado. ¿En qué más puedo ayudarte?');
            }
            pendingCategoryMenuSelections.delete(userId);
        }

        // 1.6. Confirmación pendiente de programa individual
        if (pendingProgramInfoSelections.has(userId)) {
            const pending = pendingProgramInfoSelections.get(userId);
            if (isAffirmativeReply(cleanBody) || /\b(envia|envía|mandalo|mándalo|todos)\b/.test(cleanBody)) {
                pendingProgramInfoSelections.delete(userId);
                if (pending?.brochureUrl) {
                    await sendMediaWithScopedUnacFallback(
                        (caption, mediaSrc) => flowDynamic([{ body: caption, media: mediaSrc }]),
                        `📄 *Brochure Oficial:* ${pending.nombre}`,
                        pending.brochureUrl
                    );
                } else {
                    await flowDynamic('No encontré un brochure oficial disponible para este programa.');
                }
                return;
            }
            if (['no', 'ninguno', 'cancelar'].includes(cleanBody)) {
                pendingProgramInfoSelections.delete(userId);
                return await flowDynamic('✅ Perfecto. Si luego deseas la malla o el brochure, me lo indicas.');
            }
            pendingProgramInfoSelections.delete(userId);
        }

        // 2. Detección directa de solicitud de asesor humano
        const asesorKeywords = ['solicitud asesor', 'quiero un asesor', 'necesito un asesor', 'ayuda humana', 'hablar con alguien', 'quiero hablar con una persona', 'necesito ayuda real', 'agente humano', 'operador', 'hablar con un humano', 'comunicarme con un asesor', 'asesor'];
        if (asesorKeywords.some(k => cleanBody === k || bodyLower.includes(k) && k.length > 6)) {
            console.log(`[Handoff] Usuario ${userId} solicitó asesor humano directamente.`);
            return await activateHumanHandoff(userId, flowDynamic);
        }

        // 2.1 Atajo prioritario: "necesito informacion" o "programas"
        const isInfoTrigger = /\b(necesito\s+informaci[oó]n|quiero\s+informaci[oó]n|m[aá]s\s+informaci[oó]n|dame\s+informaci[oó]n|informaci[oó]n\s+general)\b/i.test(bodyLower);
        const isProgramasTrigger = /\b(programas?|oferta\s+acad[eé]mica|qu[eé]\s+programas?)\b/i.test(bodyLower);

        if ((isInfoTrigger || isProgramasTrigger) && !/\b(maestr[ií]as?|doctorados?|especialidades?)\b/i.test(bodyLower)) {
            await flowDynamic(`📄 *OFERTA ACADÉMICA Y PROCESO DE ADMISIÓN (${settings.admision.proceso_actual}) - UNAC*\nAquí tienes la información oficial:`);
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

        // 2.2 Atajos de Catálogos
        const isMaestriasTrigger = /\b(informaci[oó]n\s+maestr[ií]as?|maestr[ií]as?)\b/i.test(bodyLower);
        if (isMaestriasTrigger && !findProgram(body) && !/\b(costo|precio|requisito|fecha|cuando|cuanto|dura)\b/i.test(bodyLower)) {
            const msg = formatProgramsCatalogList('maestrias');
            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }

        const isEspecialidadesTrigger = /\b(informaci[oó]n\s+(?:segundas?\s+)?especialidades?|(?:segundas?\s+)?especialidades?)\b/i.test(bodyLower);
        if (isEspecialidadesTrigger && !findProgram(body) && !/\b(costo|precio|requisito|fecha|cuando|cuanto|dura)\b/i.test(bodyLower)) {
            const msg = formatProgramsCatalogList('especialidades');
            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }

        const isDoctoradosTrigger = /\b(informaci[oó]n\s+doctorados?|doctorados?)\b/i.test(bodyLower);
        if (isDoctoradosTrigger && !findProgram(body) && !/\b(costo|precio|requisito|fecha|cuando|cuanto|dura)\b/i.test(bodyLower)) {
            const msg = formatProgramsCatalogList('doctorados');
            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }

        // 2.3 Opciones Guiadas y Menú por Rol
        const isOption1 = /^(1|uno|opci[oó]n\s*1)$/i.test(cleanBody);
        const isOption2 = /^(2|dos|opci[oó]n\s*2)$/i.test(cleanBody);
        const isOption3 = /^(3|tres|opci[oó]n\s*3)$/i.test(cleanBody);
        const isOption4 = /^(4|cuatro|opci[oó]n\s*4)$/i.test(cleanBody);

        const isMatriculaTrigger = /\b(matr[ií]cula|cronograma|inscribir\s+cursos|asignaturas|sga)\b/i.test(bodyLower);
        const isPagosTrigger = /\b(pagos?|cuotas?|scotiabank|banco|comprobante|voucher|arancel)\b/i.test(bodyLower);
        const isGedTrigger = /\b(ged|mesa\s+de\s+partes|tr[aá]mite\s+virtual)\b/i.test(bodyLower);
        const isGradosTrigger = /\b(grados?|t[ií]tulos?|tesis|graduaci[oó]n|sustentaci[oó]n|diploma)\b/i.test(bodyLower);
        const isConstanciasTrigger = /\b(constancias?|certificados?|no\s+adeudo)\b/i.test(bodyLower);

        if (user.rol === 'estudiante') {
            if (isOption1 || isMatriculaTrigger) {
                const msg = `📅 *MATRÍCULA Y CRONOGRAMA ACADÉMICO - POSGRADO UNAC*\n\n` +
                    `• *Sistema SGA (Matrícula en línea):* ${settings.enlaces.portal_sga}\n` +
                    `• *Inicio de clases (${settings.admision.proceso_actual}):* ${settings.admision.inicio_clases}\n` +
                    `• *Requisitos:* Estar al día con las cuotas académicas y registrar tus asignaturas en el SGA.\n\n` +
                    `¿Deseas ayuda adicional o comunicarte con coordinación? Responde *asesor*. 👨‍💼`;
                await logInteraction(userId, body, msg, null, 'student_guide');
                return await flowDynamic(msg);
            }
            if (isOption2 || isPagosTrigger) {
                const msg = `💳 *PAGOS Y CUENTAS BANCARIAS - POSGRADO UNAC*\n\n` +
                    `• *Entidad:* Banco ${settings.pagos.banco} (Ventanilla, Agentes o App).\n` +
                    `• *Cuenta Maestrías/Doctorados:* ${settings.pagos.cuenta_general} (CCI: ${settings.pagos.cci_general})\n` +
                    `• *Cuenta Segundas Especialidades:* ${settings.pagos.cuenta_especialidad} (CCI: ${settings.pagos.cci_especialidad})\n` +
                    `• *Validación obligatoria:* Registra todo comprobante en la plataforma GED: ${settings.enlaces.portal_ged}\n\n` +
                    `⚠️ Conserva tu voucher o constancia digital para cualquier gestión académica.`;
                await logInteraction(userId, body, msg, null, 'student_guide');
                return await flowDynamic(msg);
            }
            if (isOption3 || isGedTrigger) {
                const msg = `📑 *MESA DE PARTES VIRTUAL (GED) - UNAC*\n\n` +
                    `La plataforma de Gestión Electrónica de Documentos (GED) es el canal oficial para todo trámite:\n\n` +
                    `🌐 *Portal GED:* ${settings.enlaces.portal_ged}\n` +
                    `⏰ *Horario de recepción:* ${settings.modalidad_atencion.horario_ged}.\n\n` +
                    `Puedes ingresar solicitudes de convalidación, registro de comprobantes, reclamos o cartas a la Dirección de Posgrado.`;
                await logInteraction(userId, body, msg, null, 'student_guide');
                return await flowDynamic(msg);
            }
            if (isOption4) return await activateHumanHandoff(userId, flowDynamic);
        }

        if (user.rol === 'egresado') {
            if (isOption1 || isGradosTrigger) {
                const msg = `🎓 *GRADOS Y TÍTULOS - POSGRADO UNAC*\n\n` +
                    `Para la obtención del grado académico de Maestro o Doctor:\n\n` +
                    `1️⃣ Aprobar el 100% de créditos del plan de estudios del programa.\n` +
                    `2️⃣ Acreditar el idioma extranjero correspondiente (Intermedio para Maestría / Avanzado para Doctorado).\n` +
                    `3️⃣ Elaborar, sustentar y aprobar la tesis de posgrado o trabajo de investigación.\n` +
                    `4️⃣ Presentar tu expediente de graduación mediante el portal GED: ${settings.enlaces.portal_ged}\n\n` +
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
                    `📌 *Procedimiento:* Paga la tasa respectiva en ${settings.pagos.banco} y adjunta la solicitud junto al comprobante en la mesa de partes GED: ${settings.enlaces.portal_ged}`;
                await logInteraction(userId, body, msg, null, 'graduate_guide');
                return await flowDynamic(msg);
            }
            if (isOption3 || isGedTrigger) {
                const msg = `📑 *MESA DE PARTES VIRTUAL (GED) - UNAC*\n\n` +
                    `Ingresa tus expedientes de graduación, solicitudes de constancia o trámites a la Dirección de Posgrado:\n\n` +
                    `🌐 *Enlace:* ${settings.enlaces.portal_ged}\n` +
                    `⏰ *Horario de atención:* ${settings.modalidad_atencion.horario_ged}.`;
                await logInteraction(userId, body, msg, null, 'graduate_guide');
                return await flowDynamic(msg);
            }
            if (isOption4) return await activateHumanHandoff(userId, flowDynamic);
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
            if (isOption4) return await activateHumanHandoff(userId, flowDynamic);
        }

        // 2.4 Manejo de afirmaciones / negaciones huérfanas
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
            }
            return await flowDynamic('¡Entendido! ¿En qué programa o trámite de Posgrado UNAC te gustaría que te oriente? 🎓');
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

        // --- DETECCIÓN DE INTENCIONES ESPECÍFICAS (RESPUESTA DIRECTA CON SETTINGS DINÁMICOS) ---
        const asksCost = /\b(costo|cuesta|precio|pago|monto|cuanto|cuánto|tarifa|arancel|valor|pagar|banco|cuenta|cci)\b/i.test(bodyLower);
        const asksReqs = /\b(requisito|documento|necesito para|que piden|que se pide|que solicitan|qué necesito|qué debo presentar|documentos)\b/i.test(bodyLower);
        const asksDates = /\b(fecha|cuando|cuándo|plazo|inicio|inicio de clases|cronograma|calendario|cierre|inscripcion cierra|hasta cuando)\b/i.test(bodyLower);
        const asksModality = /\b(modalidad|presencial|virtual|distancia|hibrido|híbrido|clases|como son las clases|como funciona)\b/i.test(bodyLower);
        const asksDuration = /\b(cuanto dura|cuánto dura|duración|duracion|cuantos años|cuántos años|cuantos semestres|ciclos|semestres|tiempo)\b/i.test(bodyLower)
            && /\b(maestria|doctorado|especialidad|programa|posgrado)\b/i.test(bodyLower);
        const asksNextSteps = /\b(que hago|qué hago|que sigue|qué sigue|ahora que|ya (pague|pagué|me inscribi|me inscribí)|pasos a seguir|cual es el siguiente paso)\b/i.test(bodyLower);

        if (asksNextSteps && !matchedProgram) {
            const msg = buildAdmissionStepsMessage(getTipoProgramaInfo);
            await logInteraction(userId, body, msg, null, 'settings');
            return await flowDynamic(msg);
        }

        if (asksDates && !matchedProgram) {
            const msg = `🗓️ *CRONOGRAMA OFICIAL DE ADMISIÓN (${settings.admision.proceso_actual}) - UNAC*\n\n` +
                `• 🖋 *Cierre de Inscripciones:* ${settings.admision.cierre_inscripciones}\n` +
                `• 📍 *Examen / Evaluación:* ${settings.admision.fecha_examen}\n` +
                `• 🎙️ *Entrevistas:* ${settings.admision.fecha_entrevistas}\n` +
                `• 🎒 *Inicio de Clases:* ${settings.admision.inicio_clases}\n\n` +
                `👉 *Inscríbete en:* ${settings.enlaces.portal_inscripcion}`;
            await logInteraction(userId, body, msg, null, 'settings');
            return await flowDynamic(msg);
        }

        if (asksCost && categoryIntent && !matchedProgram) {
            const tipoInfo = getTipoProgramaInfo(categoryIntent);
            const label = categoryIntent === 'maestrias' ? 'MAESTRÍA' : categoryIntent === 'doctorados' ? 'DOCTORADO' : 'SEGUNDA ESPECIALIDAD';
            const insc = tipoInfo?.costos || (categoryIntent === 'doctorados' ? settings.pagos.inscripcion_doctorado : categoryIntent === 'especialidades' ? settings.pagos.inscripcion_especialidad : settings.pagos.inscripcion_maestria);
            const ciclo = tipoInfo?.costo_ciclo || (categoryIntent === 'doctorados' ? settings.pagos.semestre_doctorado : categoryIntent === 'especialidades' ? settings.pagos.semestre_especialidad : settings.pagos.semestre_maestria);
            const dur = tipoInfo?.duracion || (categoryIntent === 'doctorados' ? settings.pagos.duracion_doctorado : categoryIntent === 'especialidades' ? settings.pagos.duracion_especialidad : settings.pagos.duracion_maestria);
            const cta = tipoInfo?.numero_cuenta || (categoryIntent === 'especialidades' ? `${settings.pagos.cuenta_especialidad} (CCI: ${settings.pagos.cci_especialidad})` : `${settings.pagos.cuenta_general} (CCI: ${settings.pagos.cci_general})`);

            let msg = `💰 *Costos de ${label} - UNAC (${settings.admision.proceso_actual})*\n\n`;
            msg += `📌 *Inscripción:* ${insc}\n`;
            msg += `💵 *Costo por semestre:* ${ciclo}\n`;
            msg += `⏳ *Duración:* ${dur}\n`;
            msg += `🏦 *Cuenta ${settings.pagos.banco}:* ${cta}\n`;
            msg += `\n¿Deseas más información o te explico los pasos de inscripción? 🎓`;

            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }

        if (asksReqs && categoryIntent && !matchedProgram) {
            const tipoInfo = getTipoProgramaInfo(categoryIntent);
            if (tipoInfo?.requisitos) {
                const label = categoryIntent === 'maestrias' ? 'Maestría' : categoryIntent === 'doctorados' ? 'Doctorado' : 'Segunda Especialidad';
                const msg = `📄 *Requisitos de ${label} - UNAC*\n\n${tipoInfo.requisitos}\n\n*Sube tus documentos en:* ${settings.enlaces.portal_ged} ✅`;
                await logInteraction(userId, body, msg, null, 'catalog');
                return await flowDynamic(msg);
            }
        }

        if (asksDuration && categoryIntent && !matchedProgram) {
            const tipoInfo = getTipoProgramaInfo(categoryIntent);
            const dur = tipoInfo?.duracion || (categoryIntent === 'doctorados' ? settings.pagos.duracion_doctorado : categoryIntent === 'especialidades' ? settings.pagos.duracion_especialidad : settings.pagos.duracion_maestria);
            const label = categoryIntent === 'maestrias' ? 'Maestría' : categoryIntent === 'doctorados' ? 'Doctorado' : 'Segunda Especialidad';
            const msg = `⏳ *Duración de ${label} - UNAC*\n\n📚 ${dur}${tipoInfo?.creditos ? `\n📖 Créditos: ${tipoInfo.creditos}` : ''}\n\n🎓 ${settings.modalidad_atencion.modalidad_resumen}`;
            await logInteraction(userId, body, msg, null, 'catalog');
            return await flowDynamic(msg);
        }

        if (asksModality && !matchedProgram) {
            const msg = `🎓 *Modalidad de Estudios - UNAC Posgrado*\n\n📍 *${settings.modalidad_atencion.modalidad_titulo}*\n\n${settings.modalidad_atencion.modalidad_resumen}\n\n¿Hay algo más en lo que pueda orientarte? 😊`;
            await logInteraction(userId, body, msg, null, 'settings');
            return await flowDynamic(msg);
        }

        if (!matchedProgram && matchedPrograms.length === 0 && isCategoryOnlyRequest(bodyLower, categoryIntent)) {
            const menuObj = getContextForCategory(categoryIntent);
            if (menuObj && typeof menuObj === 'object') {
                pendingCategoryMenuSelections.set(userId, { ...menuObj, _ts: Date.now() });
                await logInteraction(userId, body, menuObj.text, null, 'catalog');
                return await flowDynamic(menuObj.text);
            } else {
                await logInteraction(userId, body, menuObj || '', null, 'catalog');
                return await flowDynamic(menuObj || 'No se encontraron programas.');
            }
        }

        const isGeneralPosgradoQuery = /\b(programas?|oferta|posgrado|que\s+ofrecen|que\s+tienen)\b/i.test(bodyLower)
            && !categoryIntent && !matchedProgram && matchedPrograms.length === 0;
        if (isGeneralPosgradoQuery) {
            const generalMsg = getAllProgramsGeneral();
            await logInteraction(userId, body, generalMsg, null, 'catalog');
            return await flowDynamic(generalMsg);
        }

        if (matchedProgram && matchedPrograms.length === 1) {
            const detailMessage = buildProgramDetailMessage(matchedProgram);
            if (detailMessage) {
                await flowDynamic(detailMessage);
            }

            const brochureUrl = matchedProgram.brochure;
            if (brochureUrl) {
                await delay(1000);
                try {
                    await sendMediaWithScopedUnacFallback(
                        (caption, mediaSrc) => flowDynamic([{ body: caption, media: mediaSrc }]),
                        `📄 *Brochure Oficial:* ${matchedProgram.nombre}`,
                        brochureUrl
                    );
                } catch (brochErr) {
                    console.error(`[Flow] Error al enviar brochure:`, brochErr.message);
                }
            }

            appendConversationTurn(userId, 'user', body);
            appendConversationTurn(userId, 'assistant', detailMessage || matchedProgram.nombre);
            await logInteraction(userId, body, detailMessage || matchedProgram.nombre, null, 'catalog');
            return;
        }

        if (categoryIntent && isGeneralCategoryRequest(bodyLower, categoryIntent, matchedProgram)) {
            const catResult = getContextForCategory(categoryIntent);
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
            const programsWithBrochure = slicedPrograms.map(p => ({ ...p, brochureUrl: p.brochure }));

            const catalogList = programsWithBrochure.map((program, index) => {
                const facultyLabel = program.facultad ? ` - ${program.facultad}` : '';
                return `*${index + 1}.* ${program.nombre}${facultyLabel}`;
            }).join('\n');

            pendingBrochureSelections.set(userId, { items: programsWithBrochure, _ts: Date.now() });

            return await flowDynamic(
                `📋 Encontré varios programas en la base de datos:\n\n${catalogList}\n\n👉 Responde con el *número* del programa que deseas revisar.`
            );
        }

        if (facultyMatch) {
            let facultyPrograms = [];
            if (categoryIntent && facultyMatch[categoryIntent]) {
                Object.values(facultyMatch[categoryIntent]).forEach(p => {
                    facultyPrograms.push({ ...p, facultad: facultyMatch.nombre, tipo: categoryIntent, brochureUrl: p.brochure });
                });
            } else {
                ['maestrias', 'doctorados', 'especialidades'].forEach(cat => {
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

                pendingBrochureSelections.set(userId, { items: slicedPrograms, _ts: Date.now() });

                const filterLabel = categoryIntent ? ` (${categoryIntent.toUpperCase()})` : '';
                return await flowDynamic(
                    `📋 Programas en la *${facultyMatch.nombre}*${filterLabel}:\n\n${catalogList}\n\n👉 Responde con el *número* del programa que deseas revisar.`
                );
            }

            return await flowDynamic(getContextForFaculty(facultyMatch));
        }

        // 4. Caché Semántico (Solo respuestas validadas desde Dashboard)
        let embedding = null;
        const isEligibleForCache = body.trim().length >= 8 && !STOPWORDS_NO_CACHE.test(cleanBody);

        try {
            if (isEligibleForCache) {
                embedding = await getEmbedding(body);
                if (embedding) {
                    const cachedAnswer = await checkSemanticCache(embedding);
                    if (cachedAnswer) {
                        console.log(`[Cache] Coincidencia validada encontrada para: "${body}"`);
                        appendConversationTurn(userId, 'user', body);
                        appendConversationTurn(userId, 'assistant', cachedAnswer);
                        await logInteraction(userId, body, cachedAnswer, embedding, 'cache');
                        return await flowDynamic(cachedAnswer);
                    }
                }
            }
        } catch (e) {
            console.error('[Flow] Error en embedding/cache:', e.message);
        }

        // 5. RAG Dinámico (Catálogo + Knowledge Base Vectorial)
        const programsMatch = matchedPrograms;
        const categoryMatch = categoryIntent;
        let dynamicContext = '';

        if (programsMatch && programsMatch.length > 0) {
            dynamicContext = programsMatch.map(p => `Programa: ${p.nombre}. Info: ${p.descripcion || ''}.`).join('\n');
        } else if (facultyMatch) {
            dynamicContext = getContextForFaculty(facultyMatch);
        } else if (categoryMatch) {
            const catCtx = getContextForCategory(categoryMatch);
            dynamicContext = (typeof catCtx === 'object') ? catCtx.text : (catCtx || '');
            const enriched = getEnrichedContextForGrok(categoryMatch);
            if (enriched) dynamicContext += '\n' + enriched;
        } else {
            const catalog = getCatalog();
            const numFacultades = catalog ? Object.keys(catalog).length : 0;
            const nombresFacultades = catalog ? Object.values(catalog).map(f => f.nombre).join(', ') : '';
            dynamicContext = `Contamos con Maestrías, Doctorados y Segundas Especialidades en ${numFacultades} facultades: ${nombresFacultades}.`;
            const enrichedM = getEnrichedContextForGrok('maestrias');
            const enrichedD = getEnrichedContextForGrok('doctorados');
            const enrichedE = getEnrichedContextForGrok('especialidades');
            if (enrichedM || enrichedD || enrichedE) {
                dynamicContext += '\nDatos generales de programas:\n' + (enrichedM || '') + (enrichedD || '') + (enrichedE || '');
            }
        }

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
                match_threshold: 0.45,
                match_count: 3,
                filter_meta: filterMeta
            });

            if (documents && documents.length > 0) {
                const extraContext = documents.map(d => d.content).join('\n\n');
                dynamicContext += `\n\n${extraContext}`;
                console.log(`[RAG 2.0] ${documents.length} fragmentos recuperados de Supabase.`);
            }
        }

        // 6. Consulta Groq con ventana corta de memoria conversacional
        const historyTurns = getRecentConversationTurns(userId);
        const response = await getGrokCompletion(user.nombre, body, dynamicContext, {
            maxTokens: 180,
            maxContextChars: 2800,
            historyTurns
        });
        console.log(`[Grok] Respuesta generada: "${response}"`);

        const registerUnresolvedQuery = async () => {
            try {
                await supabase.from('unresolved_queries').insert({
                    query: body,
                    wa_id: normalizeWaId(userId),
                    user_name: user.nombre || null,
                    user_condition: user.rol || null,
                    embedding: embedding || null
                });
            } catch (unresErr) {
                console.error('[Unresolved] Error registrando duda:', unresErr.message);
            }
        };

        if (response) {
            // IMPORTANTE: Por política de calidad, NO se auto-inserta la respuesta de Groq en semantic_cache.
            // Solo las respuestas aprobadas (/approve) o corregidas (/correct) desde el Dashboard entran al caché.
            const isSolicitudAsesor = response.includes('[SOLICITUD_ASESOR]');
            const cleanResponse = response.replace('[SOLICITUD_ASESOR]', '').trim();

            if (isSolicitudAsesor && !cleanResponse) {
                console.log(`[Flow] IA sin certeza para ${userId}. Registrando duda y ofreciendo asesor.`);
                await registerUnresolvedQuery();
                await logInteraction(userId, body, '[SOLICITUD_ASESOR]', embedding, 'grok_unresolved');
                user.esperandoConfirmacionAsesor = true;
                saveUser(userId, user);
                await state.update({ pendingAdvisor: true });
                return await flowDynamic(
                    'Lo siento, no tengo suficiente información verificada en mi sistema para responder eso con total certeza. 😔\n\n' +
                    '¿Deseas que te comunique con un *asesor humano*? Uno de nuestros coordinadores se comunicará contigo en los próximos minutos para ayudarte personalmente. 👨‍💼📞\n\n' +
                    '👉 Responde *SÍ* para transferirte con un asesor o escribe tu consulta con más detalle.'
                );
            }

            if (cleanResponse) {
                await flowDynamic(cleanResponse);
                appendConversationTurn(userId, 'user', body);
                appendConversationTurn(userId, 'assistant', cleanResponse);
            }

            await logInteraction(userId, body, cleanResponse, embedding, 'grok');

            // 7. Enviar Brochures automáticamente si se detectaron programas
            const allMatchedPrograms = [...(programsMatch || [])];
            const uniquePrograms = Array.from(new Set(allMatchedPrograms.map(p => p.nombre)))
                .map(nombre => allMatchedPrograms.find(p => p.nombre === nombre))
                .slice(0, 3);

            const programsWithBrochure = uniquePrograms
                .map(p => ({ ...p, brochureUrl: p.brochure }))
                .filter(p => p.brochureUrl);

            if (programsWithBrochure.length === 1) {
                try {
                    await delay(1000);
                    await sendMediaWithScopedUnacFallback(
                        (caption, mediaSrc) => flowDynamic([{ body: caption, media: mediaSrc }]),
                        `📄 *Brochure Oficial:* ${programsWithBrochure[0].nombre}`,
                        programsWithBrochure[0].brochureUrl
                    );
                } catch (brochErr) {
                    console.error(`[Flow] Error al enviar brochure:`, brochErr.message);
                }
            } else if (programsWithBrochure.length > 1) {
                const listItems = programsWithBrochure.map((p, i) => `*${i + 1}.* ${p.nombre}`).join('\n');
                pendingBrochureSelections.set(userId, { items: programsWithBrochure, _ts: Date.now() });

                await delay(1000);
                await flowDynamic(
                    `📋 Encontré *${programsWithBrochure.length} brochures* disponibles:\n\n` +
                    listItems + '\n\n' +
                    '👉 Responde con el *número* del programa que deseas (ej: *1*), varios separados por coma (ej: *1, 3*), o escribe *todos* para recibirlos todos.'
                );
            }

            if (isSolicitudAsesor) {
                await registerUnresolvedQuery();
                await delay(800);
                await flowDynamic(
                    '¿Deseas que te comunique con un *asesor humano* para ampliar esta información? 👨‍💼📞\n\n' +
                    '👉 Responde *SÍ* para transferirte con un asesor.'
                );
                user.esperandoConfirmacionAsesor = true;
                saveUser(userId, user);
                await state.update({ pendingAdvisor: true });
            }
        } else {
            await registerUnresolvedQuery();
            await logInteraction(userId, body, '[FALLO_INFERENCIA_LLM]', embedding, 'grok_error');
            user.esperandoConfirmacionAsesor = true;
            saveUser(userId, user);
            await state.update({ pendingAdvisor: true });
            await flowDynamic(
                'Lo siento, en este momento tuve un inconveniente procesando tu consulta. 😔\n\n' +
                '¿Deseas que te comunique con un *asesor humano*? Uno de nuestros coordinadores te atenderá personalmente en breve. 👨‍💼📞\n\n' +
                '👉 Responde *SÍ* para transferirte con un asesor o intenta nuevamente en unos segundos.'
            );
        }
    });


const main = async () => {
    console.log('[Bot] Inicializando parámetros institucionales y catálogo...');
    await Promise.all([
        initBotSettings(),
        initCatalog()
    ]);

    const adapterFlow = createFlow([
        resetFlow,
        flowExamenAdmision,
        flowPasosInscripcion,
        flowExpedienteProcesar,
        welcomeFlow,
        mediaFlow
    ]);
    const adapterProvider = createProvider(Provider);
    const adapterDB = new Database();

    let botStatus = { connected: false, waiting_qr: false };
    const attachedCallSockets = new WeakSet();

    adapterProvider.on('require_action', (payload) => {
        if (payload.type === 'qr') {
            console.log(`[Bot] ⚡ NUEVO QR RECIBIDO`);
            botStatus.connected = false;
            botStatus.waiting_qr = true;
            fs.promises.writeFile(path.join(process.cwd(), 'last_qr.txt'), payload.value, 'utf8').catch(() => {});
        }
    });

    adapterProvider.on('ready', async () => {
        console.log('[Bot] ✅ Conexión WhatsApp establecida y lista.');
        botStatus.connected = true;
        botStatus.waiting_qr = false;

        const qrPath = path.join(process.cwd(), 'bot.qr.png');
        const lastQrPath = path.join(process.cwd(), 'last_qr.txt');
        fs.promises.unlink(qrPath).catch(() => {});
        fs.promises.unlink(lastQrPath).catch(() => {});

        // Evitar duplicar el listener de llamadas en reconexiones de socket
        const sock = adapterProvider.getInstance?.() || adapterProvider.vendor;
        if (sock?.ev && !attachedCallSockets.has(sock)) {
            attachedCallSockets.add(sock);
            console.log('[Bot] 🛡️ Listener único de llamadas entrantes activado.');
            sock.ev.on('call', async (callEvents) => {
                for (const call of callEvents) {
                    if (call.status === 'offer') {
                        console.log(`[Baileys Call] 📞 Llamada entrante de ${call.from}. Rechazando educadamente...`);
                        try {
                            await sock.rejectCall(call.id, call.from);
                        } catch (e) {
                            console.warn('[Baileys Call] Error rechazando llamada:', e.message);
                        }

                        try {
                            const politeMessage = '📞 *Aviso Automático - Escuela de Posgrado UNAC*\n\nEstimado(a) postulante, esta línea opera exclusivamente como central digital de atención por mensajería. No es posible responder llamadas de voz directamente.\n\nPor favor, déjanos tu consulta detallada por *mensaje de texto o nota de voz* aquí mismo y un asesor te responderá a la brevedad.\n\n¡Muchas gracias por tu comprensión!';
                            await adapterProvider.sendMessage(call.from, politeMessage, {});
                        } catch (sendErr) {
                            console.warn('[Baileys Call] Error enviando mensaje post-llamada:', sendErr.message);
                        }
                    }
                }
            });
        }

        // Reanudar cola durable de leads pendientes tras inicio o reconexión
        await recoverStuckLeadJobs();
        triggerLeadQueueWorker(adapterProvider, procesarEnvioMensaje, (num) => {
            saveUser(num, { infoEnviada: true });
        });
    });

    adapterProvider.on('auth_failure', (error) => {
        console.error('[Bot] ❌ Error de autenticación:', error);
        botStatus.connected = false;
        botStatus.waiting_qr = false;
    });

    // --- PERSISTENCIA OPTIMIZADA DE MENSAJES ENTRANTES (2 roundtrips en vez de 3) ---
    adapterProvider.on('message', async (ctx) => {
        if (ctx.from === 'status@broadcast') return;
        if (ctx.body?.startsWith('_event_')) return;

        const cleanFrom = normalizeWaId(ctx.from);
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
        if (!msgText) return;

        try {
            await supabase.from('conversations').upsert({
                wa_id: cleanFrom,
                updated_at: new Date().toISOString()
            }, { onConflict: 'wa_id' });

            await supabase.from('messages').insert({
                wa_id: cleanFrom,
                text: msgText,
                media_url: ctx.url || null,
                sender_type: 'user'
            });
        } catch (e) {
            console.error('[Dashboard Sync] Error al persistir mensaje entrante:', e.message);
        }
    });

    // --- INTERCEPTOR DE MENSAJES SALIENTES CON DEDUPLICACIÓN SEGURA ---
    const originalSendMessage = adapterProvider.sendMessage;
    const _dashboardPendingSends = new Set();

    adapterProvider.sendMessage = async (number, message, options) => {
        const result = await originalSendMessage.call(adapterProvider, number, message, options);
        const cleanNumber = normalizeWaId(number);
        const dedupKey = `${cleanNumber}:${typeof message === 'string' ? message : ''}`;

        if (_dashboardPendingSends.has(dedupKey)) {
            _dashboardPendingSends.delete(dedupKey);
            supabase.from('conversations')
                .update({ updated_at: new Date().toISOString() })
                .eq('wa_id', cleanNumber)
                .then(() => {})
                .catch(() => {});
            return result;
        }

        try {
            await supabase.from('conversations').upsert({
                wa_id: cleanNumber,
                updated_at: new Date().toISOString()
            }, { onConflict: 'wa_id' });

            await supabase.from('messages').insert({
                wa_id: cleanNumber,
                text: typeof message === 'string' ? message : (options?.media ? '📎 Archivo enviado' : 'Mensaje automático'),
                media_url: typeof options?.media === 'string' && options.media.startsWith('http') ? options.media : null,
                sender_type: 'bot'
            });
        } catch (e) {
            console.error('[Dashboard Sync] Error al persistir respuesta del Bot:', e.message);
        }

        return result;
    };

    // --- SERVIDOR HTTP E INTEGRACIÓN SEGURA CON EL DASHBOARD ---
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);

    adapterProvider.server.use(cors({
        origin: (origin, cb) => {
            if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
                return cb(null, true);
            }
            return cb(new Error('Origen CORS no permitido'));
        }
    }));
    adapterProvider.server.use(express.json({ limit: '2mb' }));

    adapterProvider.server.use((req, res, next) => {
        const reqOrigin = req.headers?.origin;
        if (!reqOrigin || allowedOrigins.length === 0 || allowedOrigins.includes(reqOrigin)) {
            res.setHeader('Access-Control-Allow-Origin', reqOrigin || '*');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            return res.end();
        }
        next();
    });

    // Endpoints protegidos de estado y QR
    adapterProvider.server.get('/bot/qr', withAdminAuth(verifyToken, (req, res) => {
        const qrPath = path.join(process.cwd(), 'bot.qr.png');
        if (fs.existsSync(qrPath)) {
            res.sendFile(qrPath);
        } else {
            res.statusCode = 404;
            res.end('QR no encontrado.');
        }
    }, { allowQueryToken: true }));

    adapterProvider.server.get('/bot/status', withAdminAuth(verifyToken, async (req, res) => {
        const qrPath = path.join(process.cwd(), 'bot.qr.png');
        const hasQrFile = fs.existsSync(qrPath);

        let qr_base64 = null;
        if (hasQrFile) {
            try {
                const buffer = await fs.promises.readFile(qrPath);
                qr_base64 = `data:image/png;base64,${buffer.toString('base64')}`;
            } catch (e) {
                console.error('[Dashboard] Error convirtiendo QR a Base64:', e.message);
            }
        }

        return sendJsonResponse(res, 200, {
            connected: botStatus.connected,
            waiting_qr: botStatus.waiting_qr || hasQrFile,
            qr_base64,
            timestamp: new Date().toISOString()
        });
    }));

    adapterProvider.server.get('/bot/token-usage', withAdminAuth(verifyToken, (req, res) => {
        try {
            return sendJsonResponse(res, 200, getTokenUsageSummary());
        } catch (error) {
            return sendJsonResponse(res, 500, { error: error.message });
        }
    }));

    // --- ESCUCHA REALTIME DE MENSAJES DEL DASHBOARD CON REPORTE DE FALLOS DE ENTREGA ---
    const subscribeDashboardChannel = () => {
        const channel = supabase.channel('dashboard-send')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'sender_type=eq.dashboard' }, async (payload) => {
                const { id: msgId, wa_id, text, media_url, sent_by, sent_by_name } = payload.new;
                if (!wa_id || wa_id.startsWith('web_')) return;

                const cleanWa = normalizeWaId(wa_id);
                const target = wa_id.includes('@') ? wa_id : `${cleanWa}@s.whatsapp.net`;
                const dedupKey = `${cleanWa}:${text || ''}`;

                _dashboardPendingSends.add(dedupKey);

                try {
                    if (!botStatus.connected) {
                        throw new Error('WhatsApp (Baileys) se encuentra desconectado en este momento');
                    }

                    if (media_url) {
                        const isAudio = /\.(ogg|opus|mp3|wav|m4a|aac|webm)(\?.*)?$/i.test(media_url) || (payload.new.media_type === 'audio' || payload.new.media_type === 'voice_note');
                        const isDoc = /\.(pdf|docx?|xlsx?|pptx?|txt)(\?.*)?$/i.test(media_url) || payload.new.media_type === 'document';
                        const sock = adapterProvider.getInstance?.() || adapterProvider.vendor;

                        if (isAudio && sock?.sendMessage) {
                            await sock.sendMessage(target, {
                                audio: { url: media_url },
                                mimetype: 'audio/ogg; codecs=opus',
                                ptt: true
                            });
                        } else if (isDoc && sock?.sendMessage) {
                            const filename = payload.new.metadata?.filename || 'Documento_Posgrado_UNAC.pdf';
                            await sock.sendMessage(target, {
                                document: { url: media_url },
                                mimetype: payload.new.metadata?.mime || 'application/pdf',
                                fileName: filename,
                                caption: text || ''
                            });
                        } else {
                            await adapterProvider.sendMessage(target, text || 'Archivo adjunto', { media: media_url });
                        }
                    } else {
                        await adapterProvider.sendMessage(target, text, {});
                    }

                    // Confirmar estado de entrega en Supabase (falla silenciosamente si la columna aún no fue migrada)
                    if (msgId) {
                        supabase.from('messages')
                            .update({ delivery_status: 'sent', delivery_error: null })
                            .eq('id', msgId)
                            .then(() => {})
                            .catch(() => {});
                    }

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
                    const errMsg = err?.message || 'Error desconocido al despachar en WhatsApp';
                    console.error(`[Dashboard] ❌ ERROR al despachar mensaje ${msgId} a ${target}:`, errMsg);
                    if (msgId) {
                        supabase.from('messages')
                            .update({ delivery_status: 'failed', delivery_error: errMsg })
                            .eq('id', msgId)
                            .then(() => {})
                            .catch(() => {});
                    }
                } finally {
                    // Garantiza que nunca queden claves huérfanas en memoria (incluso en audios/PDFs o fallos)
                    _dashboardPendingSends.delete(dedupKey);
                }
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('[Realtime] Canal dashboard-send suscrito correctamente.');
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn(`[Realtime] Canal dashboard-send en estado ${status}. Reintentando en 5s...`);
                    setTimeout(() => {
                        supabase.removeChannel(channel).catch(() => {});
                        subscribeDashboardChannel();
                    }, 5000);
                }
            });
    };

    subscribeDashboardChannel();

    // Registro de rutas administrativas protegidas
    registerKnowledgeRoutes(adapterProvider.server, { supabase, getEmbedding, verifyToken, writeAudit });
    registerReviewRoutes(adapterProvider.server, { supabase, getEmbedding, verifyToken, writeAudit });
    registerSettingsRoutes(adapterProvider.server, { verifyToken, writeAudit });
    registerWebChatRoutes(adapterProvider.server, { supabase, getGrokCompletion, getEmbedding });

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    registerMessagingRoutes(adapterProvider.server, {
        handleCtx,
        supabase,
        supabaseData,
        verifyToken,
        dispatchLeadFn: procesarEnvioMensaje,
        onLeadSent: (num) => saveUser(num, { infoEnviada: true }),
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
    } catch (e) {
        console.error('[Bot] Error iniciando servidor HTTP:', e);
    }

    // --- CIERRE ORDENADO (GRACEFUL SHUTDOWN) ---
    let shuttingDown = false;
    const gracefulShutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[Bot] Señal ${signal} recibida. Ejecutando cierre ordenado...`);
        stopLeadQueueWorker();
        flushUsersSync();
        flushTokenUsageSync();
        await closeLocalDbPools();
        process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
};

process.on('uncaughtException', (err) => console.error('[FatalGuard] Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('[FatalGuard] Unhandled Rejection:', reason));

main();
