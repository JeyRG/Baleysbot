import fs from 'fs';
import path from 'path';
import { supabase } from './supabaseClient.js';

const SETTINGS_KEY = 'institutional_config';
const LOCAL_BACKUP_PATH = path.join(process.cwd(), 'bot_settings.backup.json');

export const DEFAULT_BOT_SETTINGS = {
    admision: {
        proceso_actual: '2026-II',
        cierre_inscripciones: 'Hasta el 10 de Agosto del 2026',
        fecha_examen: '19 y 20 de Agosto del 2026',
        fecha_entrevistas: '19 y 20 de Agosto del 2026',
        inicio_clases: '1 de Setiembre del 2026',
        nota_evaluacion: 'El proceso de admisión consta de dos etapas: Evaluación de Expediente (CV en plataforma GED) y Entrevista Personal virtual (no es examen escrito descalificatorio).'
    },
    pagos: {
        banco: 'Scotiabank',
        cuenta_general: '000-3747336',
        cci_general: '009-100-000003747336-90',
        cuenta_especialidad: '000-1797042',
        cci_especialidad: '009-100-000001797042-97',
        inscripcion_maestria: 'S/ 200',
        matricula_maestria: 'S/ 100',
        semestre_maestria: 'S/ 2100',
        duracion_maestria: '3 ciclos',
        inscripcion_doctorado: 'S/ 250',
        matricula_doctorado: 'S/ 100',
        semestre_doctorado: 'S/ 2100',
        duracion_doctorado: '6 ciclos',
        inscripcion_especialidad: 'S/ 120',
        matricula_especialidad: 'S/ 200',
        semestre_especialidad: 'S/ 1400',
        duracion_especialidad: '2 semestres'
    },
    modalidad_atencion: {
        modalidad_titulo: 'Presencial con Herramientas Tecnológicas',
        modalidad_resumen: '80% virtual / 20% presencial — Asistencia 1 vez al mes (clase híbrida). El grado académico se otorga con modalidad PRESENCIAL (cumple normativa SUNEDU).',
        horario_ged: 'Lunes a Viernes de 08:00 a 16:00 horas',
        telefono_soporte: '900969591',
        limite_leads_diario: 50
    },
    enlaces: {
        whatsapp_admision_general: 'https://chat.whatsapp.com/L3SLkM8yYgw2iCfcAOEzYI?s=cl&p=a&mlu=4&mlr=4',
        portal_inscripcion: 'https://posgradounac.edu.pe/INSCRIPCION/',
        portal_ged: 'https://posgradounac.edu.pe/GED/',
        portal_ged_login: 'https://posgradounac.edu.pe/GED/login.php',
        portal_requisitos: 'https://posgradounac.edu.pe/Admision/requisitos/requisitos_admision.php',
        portal_sga: 'https://sga.unac.edu.pe'
    },
    mensaje_api: {
        saludo_bienvenida: '🎓 ¡Hola {nombre}! Felicidades.\n*Somos de la Escuela de Posgrado de la UNAC*\n🚀 Ya te encuentras registrado para nuestro programa de *{programa}*.',
        titulo_detalles: '💥 *Detalles de Inscripción ({proceso_actual}):*',
        requisitos_texto: '📝 *REQUISITOS DE INSCRIPCIÓN:*\n1️⃣ Ficha de Postulante y Hoja de Vida llenadas virtualmente en nuestro sistema.\n2️⃣ Copia legible del DNI o Pasaporte.\n3️⃣ Foto actual a color (opcional).\n4️⃣ {documento_grado}\n\n*Nota:* Los grados del extranjero deben estar registrados en SUNEDU.',
        aviso_brochure: '📄 Te adjunto el brochure oficial del programa:',
        aviso_sin_brochure: '📍 Si deseas el brochure de este programa, escríbeme el nombre exacto o solicita un asesor.',
        pasos_inscripcion: '👉 *PASOS PARA FORMALIZAR TU INSCRIPCIÓN:*\n1️⃣ Realiza el pago en {banco} (Cta: {cuenta} / CCI: {cci}).\n2️⃣ Registra tus datos en el portal: {portal_inscripcion}\n3️⃣ Sube tu expediente digital en la plataforma GED: {portal_ged}\n\n¡Muchos éxitos en tu postulación!'
    }
};

let cachedSettings = structuredClone(DEFAULT_BOT_SETTINGS);
let lastMeta = {
    updated_at: null,
    updated_by_name: null,
    source: 'defaults'
};

function sanitizeString(val, fallback = '', maxLen = 2000) {
    if (typeof val !== 'string') return fallback;
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed.slice(0, maxLen) : fallback;
}

export function mergeWithDefaults(partial = {}) {
    const merged = structuredClone(DEFAULT_BOT_SETTINGS);
    if (!partial || typeof partial !== 'object') return merged;

    for (const section of Object.keys(DEFAULT_BOT_SETTINGS)) {
        const srcSection = partial[section];
        if (!srcSection || typeof srcSection !== 'object') continue;

        for (const [field, defaultVal] of Object.entries(DEFAULT_BOT_SETTINGS[section])) {
            if (typeof defaultVal === 'number') {
                const parsed = Number(srcSection[field]);
                merged[section][field] = Number.isFinite(parsed) && parsed > 0 && parsed <= 5000
                    ? Math.floor(parsed)
                    : defaultVal;
            } else {
                merged[section][field] = sanitizeString(srcSection[field], defaultVal, 2000);
            }
        }
    }
    return merged;
}

function readLocalBackup() {
    try {
        if (fs.existsSync(LOCAL_BACKUP_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(LOCAL_BACKUP_PATH, 'utf8'));
            if (parsed?.value) {
                return parsed;
            }
        }
    } catch (err) {
        console.warn('[Settings] No se pudo leer respaldo local:', err.message);
    }
    return null;
}

async function writeLocalBackup(payload) {
    try {
        await fs.promises.writeFile(LOCAL_BACKUP_PATH, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.warn('[Settings] No se pudo escribir respaldo local:', err.message);
    }
}

export async function initBotSettings() {
    const backup = readLocalBackup();
    if (backup?.value) {
        cachedSettings = mergeWithDefaults(backup.value);
        lastMeta = {
            updated_at: backup.updated_at || null,
            updated_by_name: backup.updated_by_name || null,
            source: 'local_backup'
        };
    }

    try {
        const { data, error } = await supabase
            .from('bot_settings')
            .select('value, updated_at, updated_by_name')
            .eq('key', SETTINGS_KEY)
            .maybeSingle();

        if (error) {
            console.warn('[Settings] Usando configuración en respaldo/por defecto (tabla bot_settings aún no disponible o error):', error.message);
            return cachedSettings;
        }

        if (data?.value) {
            cachedSettings = mergeWithDefaults(data.value);
            lastMeta = {
                updated_at: data.updated_at,
                updated_by_name: data.updated_by_name || 'Sistema',
                source: 'supabase'
            };
            await writeLocalBackup({ value: cachedSettings, ...lastMeta });
            console.log(`[Settings] Configuración institucional cargada desde Supabase (Proceso ${cachedSettings.admision.proceso_actual}).`);
        } else {
            // Sembrar configuración inicial en Supabase
            const now = new Date().toISOString();
            const { error: seedErr } = await supabase.from('bot_settings').upsert({
                key: SETTINGS_KEY,
                value: cachedSettings,
                updated_by_name: 'Sistema Inicial',
                updated_at: now
            }, { onConflict: 'key' });

            if (!seedErr) {
                lastMeta = { updated_at: now, updated_by_name: 'Sistema Inicial', source: 'supabase' };
                await writeLocalBackup({ value: cachedSettings, ...lastMeta });
            }
        }
    } catch (err) {
        console.warn('[Settings] Excepción cargando bot_settings, manteniendo valores seguros:', err.message);
    }

    return cachedSettings;
}

export function getBotSettings() {
    return cachedSettings;
}

export function getBotSettingsWithMeta() {
    return {
        settings: cachedSettings,
        meta: lastMeta
    };
}

export async function updateBotSettings(newPartialSettings, actor = {}) {
    const nextSettings = mergeWithDefaults(newPartialSettings);
    const now = new Date().toISOString();
    const actorName = actor.full_name || actor.username || 'Administrador';

    cachedSettings = nextSettings;
    lastMeta = {
        updated_at: now,
        updated_by_name: actorName,
        source: 'supabase'
    };

    await writeLocalBackup({ value: nextSettings, ...lastMeta });

    const { error } = await supabase.from('bot_settings').upsert({
        key: SETTINGS_KEY,
        value: nextSettings,
        updated_by: actor.id || null,
        updated_by_name: actorName,
        updated_at: now
    }, { onConflict: 'key' });

    if (error) {
        lastMeta.source = 'local_backup';
        console.warn('[Settings] Guardado en memoria y disco local; Supabase devolvió advertencia:', error.message);
        return { settings: cachedSettings, meta: lastMeta, persistedInDb: false, warning: error.message };
    }

    return { settings: cachedSettings, meta: lastMeta, persistedInDb: true };
}

/**
 * Construye un bloque compacto con las fechas, cuentas y enlaces vigentes
 * para inyectar siempre datos frescos en el contexto de Groq (RAG).
 */
export function buildInstitutionalContextSummary() {
    const s = cachedSettings;
    return [
        `PROCESO VIGENTE: Admisión ${s.admision.proceso_actual}.`,
        `FECHAS OFICIALES: Cierre de inscripciones: ${s.admision.cierre_inscripciones} | Examen/Evaluación: ${s.admision.fecha_examen} | Entrevistas: ${s.admision.fecha_entrevistas} | Inicio de clases: ${s.admision.inicio_clases}.`,
        `EVALUACIÓN DE ADMISIÓN: ${s.admision.nota_evaluacion}`,
        `CUENTAS ${s.pagos.banco.toUpperCase()}: Maestrías/Doctorados Cta ${s.pagos.cuenta_general} (CCI ${s.pagos.cci_general}) | Segundas Especialidades Cta ${s.pagos.cuenta_especialidad} (CCI ${s.pagos.cci_especialidad}).`,
        `ARANCELES BASE: Maestría (Inscripción ${s.pagos.inscripcion_maestria}, Matrícula ${s.pagos.matricula_maestria}, Semestre ${s.pagos.semestre_maestria}, Duración ${s.pagos.duracion_maestria}) | Doctorado (Inscripción ${s.pagos.inscripcion_doctorado}, Matrícula ${s.pagos.matricula_doctorado}, Semestre ${s.pagos.semestre_doctorado}, Duración ${s.pagos.duracion_doctorado}) | Segunda Especialidad (Inscripción ${s.pagos.inscripcion_especialidad}, Matrícula ${s.pagos.matricula_especialidad}, Semestre ${s.pagos.semestre_especialidad}, Duración ${s.pagos.duracion_especialidad}).`,
        `MODALIDAD: ${s.modalidad_atencion.modalidad_titulo} (${s.modalidad_atencion.modalidad_resumen}).`,
        `ENLACES OFICIALES: Inscripción: ${s.enlaces.portal_inscripcion} | GED: ${s.enlaces.portal_ged} | Requisitos: ${s.enlaces.portal_requisitos} | SGA: ${s.enlaces.portal_sga} |Horario GED: ${s.modalidad_atencion.horario_ged} | Soporte: ${s.modalidad_atencion.telefono_soporte}.`
    ].join('\n');
}

/**
 * Construye el mensaje unificado de "Paso a paso para admisión" usando parámetros vivos.
 */
export function buildAdmissionStepsMessage(tipoProgramaGetter = null) {
    const s = cachedSettings;
    const infoM = tipoProgramaGetter ? tipoProgramaGetter('maestrias') : null;
    const infoD = tipoProgramaGetter ? tipoProgramaGetter('doctorados') : null;
    const infoE = tipoProgramaGetter ? tipoProgramaGetter('especialidades') : null;

    const costoM = infoM?.costos || s.pagos.inscripcion_maestria;
    const costoD = infoD?.costos || s.pagos.inscripcion_doctorado;
    const costoE = infoE?.costos || s.pagos.inscripcion_especialidad;

    return `📌 *¡Paso a paso para completar tu proceso de admisión ${s.admision.proceso_actual}!* 🎓✨

*1️⃣ Realiza tu inscripción*
Ingresa al enlace oficial y completa tu registro con tus datos:
👉 ${s.enlaces.portal_inscripcion}

*2️⃣ Realiza el pago por derecho de admisión* 💳
• 🎓 *Maestría:* ${costoM}
• 📘 *Segunda Especialidad:* ${costoE}
• 🎖️ *Doctorado:* ${costoD}

🏦 *Banco:* ${s.pagos.banco}
• *Cuenta (Maestría/Doctorado):* ${s.pagos.cuenta_general} | *CCI:* ${s.pagos.cci_general}
• *Cuenta (Segunda Especialidad):* ${s.pagos.cuenta_especialidad} | *CCI:* ${s.pagos.cci_especialidad}

🔗 *Grupo oficial de WhatsApp (${s.admision.proceso_actual}):*
👉 ${s.enlaces.whatsapp_admision_general}

⚠️ Guarda tu voucher de pago, ya que lo necesitarás para el siguiente paso.

*3️⃣ Revisa los requisitos de admisión* 📄
Verifica la documentación según el programa al que postulas:
👉 ${s.enlaces.portal_requisitos}

*4️⃣ Sube tu expediente digital (GED)* 💻
Cuando tengas tus documentos listos, cárgalos en la plataforma GED con tu DNI:
👉 ${s.enlaces.portal_ged_login}

*5️⃣ Verifica el estado de tu carpeta* ✅
Revisa periódicamente la plataforma GED (${s.modalidad_atencion.horario_ged}) o escríbeme tu *DNI* para consultar el estado de tu expediente. Para atención adicional: ${s.modalidad_atencion.telefono_soporte}.`;
}
