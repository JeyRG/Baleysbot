/**
 * Rutas de Autenticación, RBAC, Auditoría y Handoff
 */
export function registerAuthRoutes(server, { 
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
}) {
    const sendJson = (res, status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
    };

    // 1. Login
    server.post('/admin/login', async (req, res) => {
        try {
            const { username, password } = req.body || {};
            const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
            const result = await login(username, password, { ip });
            return sendJson(res, result.status || (result.ok ? 200 : 401), result);
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });

    // 2. Logout
    server.post('/admin/logout', async (req, res) => {
        try {
            const token = (req.headers['authorization'] || '').replace('Bearer ', '');
            await logout(token);
            return sendJson(res, 200, { ok: true });
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });

    // 3. Sesión actual
    server.get('/admin/me', async (req, res) => {
        try {
            const token = (req.headers['authorization'] || '').replace('Bearer ', '');
            const user = await verifyToken(token);
            if (!user) return sendJson(res, 401, { ok: false, error: 'Sesión inválida' });
            return sendJson(res, 200, { ok: true, user });
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });

    // 4. Listar usuarios
    server.get('/admin/users', async (req, res) => {
        try {
            const token = (req.headers['authorization'] || '').replace('Bearer ', '');
            const result = await listUsers(token);
            return sendJson(res, result.status || 200, result);
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });

    // 5. Crear usuario
    server.post('/admin/users', async (req, res) => {
        try {
            const token = (req.headers['authorization'] || '').replace('Bearer ', '');
            const result = await createUser(token, req.body || {});
            return sendJson(res, result.status || 200, result);
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });

    // 6. Actualizar usuario
    server.put('/admin/users/:id', async (req, res) => {
        try {
            const token = (req.headers['authorization'] || '').replace('Bearer ', '');
            const result = await updateUser(token, req.params.id, req.body || {});
            return sendJson(res, result.status || 200, result);
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });

    // 7. Eliminar usuario
    server.delete('/admin/users/:id', async (req, res) => {
        try {
            const token = (req.headers['authorization'] || '').replace('Bearer ', '');
            const result = await deleteUser(token, req.params.id);
            return sendJson(res, result.status || 200, result);
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });

    // 8. Auditoría
    server.get('/admin/audit', async (req, res) => {
        try {
            const token = (req.headers['authorization'] || '').replace('Bearer ', '');
            const result = await getAudit(token, { limit: req.query?.limit });
            return sendJson(res, result.status || 200, result);
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });

    // 9. Métricas de agentes
    server.get('/admin/agent-stats', async (req, res) => {
        try {
            const token = (req.headers['authorization'] || '').replace('Bearer ', '');
            const result = await getAgentStats(token);
            return sendJson(res, result.status || 200, result);
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });

    // 10. Control Handover (Pausar/Reanudar Bot) con Auditoría
    server.post('/admin/conversations/handoff', async (req, res) => {
        try {
            const token = (req.headers['authorization'] || '').replace('Bearer ', '');
            const user = await verifyToken(token);
            if (!user) return sendJson(res, 401, { ok: false, error: 'Sesión inválida o expirada' });

            const { wa_id, status } = req.body || {};
            if (!wa_id || !['bot', 'human_active'].includes(status)) {
                return sendJson(res, 400, { ok: false, error: 'wa_id y status válido (bot o human_active) son requeridos' });
            }

            const cleanWa = wa_id.includes('@') ? wa_id.split('@')[0] : wa_id;
            const now = new Date().toISOString();

            const { error: updErr } = await supabase
                .from('conversations')
                .update({ 
                    status, 
                    last_activity_at: now,
                    updated_at: now 
                })
                .eq('wa_id', cleanWa);

            if (updErr) {
                return sendJson(res, 500, { ok: false, error: updErr.message });
            }

            await writeAudit({
                actorId: user.id,
                actorUsername: user.username,
                action: status === 'human_active' ? 'handoff_pause_bot' : 'handoff_resume_bot',
                targetType: 'conversation',
                targetId: cleanWa,
                details: { status, operator: user.full_name || user.username }
            });

            console.log(`[Handover] ${user.username} cambió estado de ${cleanWa} a: ${status}`);
            return sendJson(res, 200, { ok: true, status });
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    });
}
