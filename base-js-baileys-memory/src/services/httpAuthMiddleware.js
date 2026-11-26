/**
 * Middlewares reutilizables de autenticación y protección de endpoints HTTP
 * Compatible con Polka / Express en @builderbot/provider-baileys.
 */

export function extractBearerToken(req) {
    const authHeader = req.headers?.['authorization'] || req.headers?.['Authorization'] || '';
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    return '';
}

export function sendJsonResponse(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(payload));
}

/**
 * Envuelve un handler HTTP exigiendo sesión válida del Dashboard (superadmin o agent).
 */
export function withAdminAuth(verifyToken, handler, options = {}) {
    return async (req, res, ...rest) => {
        try {
            let token = extractBearerToken(req);
            if (!token && options.allowQueryToken && req.query?.token) {
                token = String(req.query.token).trim();
            }

            if (!token) {
                return sendJsonResponse(res, 401, { ok: false, error: 'Autenticación requerida' });
            }

            const user = await verifyToken(token);
            if (!user) {
                return sendJsonResponse(res, 401, { ok: false, error: 'Sesión inválida o expirada' });
            }

            if (options.requireSuperadmin && user.role !== 'superadmin') {
                return sendJsonResponse(res, 403, { ok: false, error: 'Se requieren permisos de Super Administrador' });
            }

            req.adminUser = user;
            return await handler(req, res, ...rest);
        } catch (err) {
            console.error('[HTTP Auth] Error verificando credenciales:', err.message);
            return sendJsonResponse(res, 500, { ok: false, error: 'Error interno de autenticación' });
        }
    };
}

// Rate limit en memoria por IP para webhooks externos
const webhookIpHits = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of webhookIpHits) {
        if (now - entry.start > 60_000) webhookIpHits.delete(ip);
    }
}, 5 * 60_000).unref?.();

export function checkWebhookIpRateLimit(req, maxPerMinute = 30) {
    const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now();
    const entry = webhookIpHits.get(ip) || { count: 0, start: now };
    if (now - entry.start > 60_000) {
        entry.count = 1;
        entry.start = now;
    } else {
        entry.count += 1;
    }
    webhookIpHits.set(ip, entry);
    return entry.count <= maxPerMinute;
}

/**
 * Verifica acceso a endpoints /v1/* mediante WEBHOOK_API_KEY o sesión Bearer de administrador.
 * Si allowLegacyWhenUnconfigured=true y WEBHOOK_API_KEY no está definida aún en .env,
 * permite el paso aplicando rate-limit por IP y emite advertencia de seguridad.
 */
export async function authorizeWebhookRequest(req, verifyToken, { allowLegacyWhenUnconfigured = false } = {}) {
    const configuredKey = process.env.WEBHOOK_API_KEY?.trim();
    const providedKey = (req.headers?.['x-api-key'] || req.headers?.['X-API-Key'] || '').toString().trim();

    if (configuredKey && providedKey && providedKey === configuredKey) {
        return { ok: true, mode: 'api_key' };
    }

    const bearer = extractBearerToken(req);
    if (bearer && typeof verifyToken === 'function') {
        const user = await verifyToken(bearer);
        if (user) return { ok: true, mode: 'admin_token', user };
    }

    if (!configuredKey && allowLegacyWhenUnconfigured) {
        console.warn('[SecOps] ⚠️ WEBHOOK_API_KEY no definida en .env; permitiendo /v1/enviar-datos en modo compatibilidad con rate-limit por IP.');
        return { ok: true, mode: 'legacy_unconfigured' };
    }

    return { ok: false };
}
