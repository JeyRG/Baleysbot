import { withAdminAuth, sendJsonResponse } from '../services/httpAuthMiddleware.js';
import {
    getBotSettingsWithMeta,
    updateBotSettings,
    DEFAULT_BOT_SETTINGS
} from '../services/settingsService.js';
import { getCatalog, initCatalog } from '../services/catalogService.js';

/**
 * Rutas Administrativas para ver y editar la información operativa que nutre al Bot
 * (Fechas de admisión, cuentas bancarias, aranceles base, enlaces y sincronización de catálogo).
 */
export function registerSettingsRoutes(server, { verifyToken, writeAudit }) {
    // 1. Obtener configuración actual + resumen del catálogo cargado en memoria
    server.get('/bot/settings', withAdminAuth(verifyToken, async (req, res) => {
        try {
            const { settings, meta } = getBotSettingsWithMeta();
            const catalog = getCatalog();

            let facultiesCount = 0;
            let maestriasCount = 0;
            let doctoradosCount = 0;
            let especialidadesCount = 0;
            let brochuresCount = 0;

            if (catalog) {
                const facIds = Object.keys(catalog);
                facultiesCount = facIds.length;
                for (const fId of facIds) {
                    const f = catalog[fId];
                    const m = Object.values(f.maestrias || {});
                    const d = Object.values(f.doctorados || {});
                    const e = Object.values(f.especialidades || {});
                    maestriasCount += m.length;
                    doctoradosCount += d.length;
                    especialidadesCount += e.length;
                    brochuresCount += [...m, ...d, ...e].filter(p => p.brochure).length;
                }
            }

            return sendJsonResponse(res, 200, {
                ok: true,
                settings,
                defaults: DEFAULT_BOT_SETTINGS,
                meta,
                catalog_summary: {
                    faculties: facultiesCount,
                    maestrias: maestriasCount,
                    doctorados: doctoradosCount,
                    especialidades: especialidadesCount,
                    total_programs: maestriasCount + doctoradosCount + especialidadesCount,
                    with_brochure: brochuresCount
                }
            });
        } catch (err) {
            return sendJsonResponse(res, 500, { ok: false, error: err.message });
        }
    }));

    // 2. Actualizar configuración institucional del Bot en vivo + registrar auditoría
    server.put('/bot/settings', withAdminAuth(verifyToken, async (req, res) => {
        try {
            const incoming = req.body?.settings || req.body || {};
            const result = await updateBotSettings(incoming, req.adminUser);

            if (typeof writeAudit === 'function') {
                await writeAudit({
                    actorId: req.adminUser?.id || null,
                    actorUsername: req.adminUser?.username || 'admin',
                    action: 'update_bot_settings',
                    targetType: 'bot_settings',
                    targetId: 'institutional_config',
                    details: {
                        proceso_actual: result.settings.admision.proceso_actual,
                        cierre_inscripciones: result.settings.admision.cierre_inscripciones,
                        inicio_clases: result.settings.admision.inicio_clases,
                        persisted_in_db: result.persistedInDb
                    }
                });
            }

            return sendJsonResponse(res, 200, {
                ok: true,
                settings: result.settings,
                meta: result.meta,
                persisted_in_db: result.persistedInDb,
                warning: result.warning || null
            });
        } catch (err) {
            return sendJsonResponse(res, 500, { ok: false, error: err.message });
        }
    }));

    // 3. Forzar recarga inmediata del catálogo de programas desde Supabase
    server.post('/bot/settings/sync-catalog', withAdminAuth(verifyToken, async (req, res) => {
        try {
            await initCatalog();
            if (typeof writeAudit === 'function') {
                await writeAudit({
                    actorId: req.adminUser?.id || null,
                    actorUsername: req.adminUser?.username || 'admin',
                    action: 'sync_bot_catalog',
                    targetType: 'catalog',
                    targetId: 'programas',
                    details: { triggered_by: req.adminUser?.username }
                });
            }
            return sendJsonResponse(res, 200, { ok: true, message: 'Catálogo académico sincronizado exitosamente' });
        } catch (err) {
            return sendJsonResponse(res, 500, { ok: false, error: err.message });
        }
    }));
}
