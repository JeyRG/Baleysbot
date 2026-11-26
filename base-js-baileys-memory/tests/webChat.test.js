import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.SUPABASE_DATA_URL = process.env.SUPABASE_DATA_URL || 'https://example-data.supabase.co';
process.env.SUPABASE_DATA_KEY = process.env.SUPABASE_DATA_KEY || 'test-data-key';

const { registerWebChatRoutes } = await import('../src/routes/webChatRoutes.js');

test('webChatRoutes - Registro y funcionamiento de sesión y mensajes web', async (t) => {
    const routes = {};
    const mockServer = {
        post: (path, handler) => { routes[`POST ${path}`] = handler; },
        get: (path, handler) => { routes[`GET ${path}`] = handler; }
    };

    const mockMessages = [];
    const mockConversations = {};

    const mockSupabase = {
        from: (table) => ({
            select: () => ({
                eq: (col, val) => ({
                    maybeSingle: async () => ({
                        data: mockConversations[val] || null
                    }),
                    order: () => ({
                        limit: async (limit) => ({
                            data: mockMessages.filter(m => m && m.wa_id === val).slice(-limit)
                        })
                    })
                })
            }),
            insert: async (data) => {
                if (Array.isArray(data)) mockMessages.push(...data);
                else mockMessages.push(data);
                return { error: null };
            },
            upsert: async (data) => {
                mockConversations[data.wa_id] = { ...(mockConversations[data.wa_id] || {}), ...data };
                return { error: null };
            },
            update: (data) => ({
                eq: (col, val) => {
                    if (mockConversations[val]) {
                        mockConversations[val] = { ...mockConversations[val], ...data };
                    }
                    return Promise.resolve({ error: null });
                }
            })
        })
    };

    const mockGrokCompletion = async (name, text, ctx) => `Respuesta de prueba sobre posgrado para: ${text}`;

    registerWebChatRoutes(mockServer, {
        supabase: mockSupabase,
        getGrokCompletion: mockGrokCompletion
    });

    await t.test('POST /v1/chat/session genera nueva sesión con ID web_ y mensaje de bienvenida', async () => {
        let statusCode = 200;
        let responseBody = null;
        const res = {
            setHeader: () => {},
            end: (data) => { responseBody = JSON.parse(data); },
            status: (code) => { statusCode = code; return res; }
        };

        const handler = routes['POST /v1/chat/session'];
        assert.ok(handler, 'La ruta POST /v1/chat/session debe estar registrada');

        await handler({ body: {} }, res);

        assert.equal(statusCode, 200);
        assert.ok(responseBody.session_id.startsWith('web_'));
        assert.equal(responseBody.is_new, true);
        assert.equal(responseBody.messages.length, 1);
        assert.equal(responseBody.messages[0].sender_type, 'bot');
    });

    await t.test('POST /v1/chat/message guarda el mensaje y responde con bot si está en modo bot', async () => {
        const sessionId = 'web_test_123456';
        mockConversations[sessionId] = { wa_id: sessionId, status: 'bot', updated_at: new Date().toISOString() };

        let responseBody = null;
        const res = {
            setHeader: () => {},
            end: (data) => { responseBody = JSON.parse(data); }
        };

        const handler = routes['POST /v1/chat/message'];
        assert.ok(handler, 'La ruta POST /v1/chat/message debe estar registrada');

        await handler({ body: { visitorId: sessionId, text: 'Información de maestrías' } }, res);

        assert.equal(responseBody.session_id, sessionId);
        assert.equal(responseBody.status, 'bot');
        assert.ok(responseBody.reply.includes('Respuesta de prueba sobre posgrado'));

        // Verificar que los mensajes del usuario y del bot se guardaron en la BD simulada
        const userMsgs = mockMessages.filter(m => m.wa_id === sessionId && m.sender_type === 'user');
        const botMsgs = mockMessages.filter(m => m.wa_id === sessionId && m.sender_type === 'bot');
        assert.equal(userMsgs.length, 1);
        assert.equal(botMsgs.length, 1);
    });

    await t.test('POST /v1/chat/message no invoca bot si la conversación está en human_active', async () => {
        const sessionId = 'web_human_test';
        mockConversations[sessionId] = { wa_id: sessionId, status: 'human_active', updated_at: new Date().toISOString() };

        let responseBody = null;
        const res = {
            setHeader: () => {},
            end: (data) => { responseBody = JSON.parse(data); }
        };

        const handler = routes['POST /v1/chat/message'];
        await handler({ body: { visitorId: sessionId, text: 'Hola asesor' } }, res);

        assert.equal(responseBody.status, 'human_active');
        assert.equal(responseBody.message, null);
        assert.ok(responseBody.notice.includes('asesor humano'));
    });

    await t.test('POST /v1/chat/reset crea una nueva sesión y reinicia el contexto', async () => {
        let responseBody = null;
        const res = {
            setHeader: () => {},
            end: (data) => { responseBody = JSON.parse(data); }
        };

        const handler = routes['POST /v1/chat/reset'];
        await handler({ body: { visitorId: 'web_old_session' } }, res);

        assert.ok(responseBody.session_id.startsWith('web_'));
        assert.notEqual(responseBody.session_id, 'web_old_session');
        assert.equal(responseBody.is_new, true);
    });
});
