import test from 'node:test';
import assert from 'node:assert/strict';

// Proveer variables mínimas de entorno para importar clientes sin errores en entorno de prueba aislado
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.SUPABASE_DATA_URL = process.env.SUPABASE_DATA_URL || 'https://example-data.supabase.co';
process.env.SUPABASE_DATA_KEY = process.env.SUPABASE_DATA_KEY || 'test-data-key';

const {
    checkRateLimit,
    resetRateLimitsForTest,
    shouldBlockAutomatedFlow,
    setConversationStatusCache,
    isValidHumanName,
    appendConversationTurn,
    getRecentConversationTurns,
    clearConversationMemory
} = await import('../src/services/flowGuardService.js');

const {
    mergeWithDefaults,
    buildInstitutionalContextSummary,
    buildAdmissionStepsMessage
} = await import('../src/services/settingsService.js');

const {
    getGrokCompletion,
    isCircuitOpen,
    resetCircuitsForTest
} = await import('../src/grokClient.js');

const {
    withAdminAuth,
    authorizeWebhookRequest
} = await import('../src/services/httpAuthMiddleware.js');

const {
    checkInscriptionByDni,
    checkInscriptionLocal
} = await import('../src/services/inscriptionService.js');

test('isValidHumanName acepta nombres reales y rechaza preguntas o comandos disfrazados', () => {
    assert.equal(isValidHumanName('Juan Carlos Pérez López'), true);
    assert.equal(isValidHumanName('María del Carmen Ñiquen'), true);
    assert.equal(isValidHumanName('Quiero informacion de maestria en sistemas'), false);
    assert.equal(isValidHumanName('Cuanto cuesta el doctorado?'), false);
    assert.equal(isValidHumanName('hola buenas tardes'), false);
    assert.equal(isValidHumanName('72345678'), false);
});

test('checkRateLimit bloquea ráfagas > 5 mensajes y advierte una única vez por ventana', () => {
    resetRateLimitsForTest();
    const user = '51999000111';
    for (let i = 0; i < 5; i++) {
        assert.equal(checkRateLimit(user).isSpam, false);
    }
    const sixth = checkRateLimit(user);
    assert.equal(sixth.isSpam, true);
    assert.equal(sixth.shouldWarn, true);

    const seventh = checkRateLimit(user);
    assert.equal(seventh.isSpam, true);
    assert.equal(seventh.shouldWarn, false);
});

test('shouldBlockAutomatedFlow aplica política fail-closed ante human_active y ante caída de Supabase', async () => {
    resetRateLimitsForTest();

    // Caso 1: Conversación tomada por humano en caché / DB
    setConversationStatusCache('51988777666@s.whatsapp.net', 'human_active');
    const resHuman = await shouldBlockAutomatedFlow('51988777666@s.whatsapp.net', async () => {});
    assert.equal(resHuman.blocked, true);
    assert.equal(resHuman.reason, 'human_active');

    // Caso 2: Error de red en Supabase -> Fail-closed (nunca pisar posible conversación humana)
    const brokenSupabase = {
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({ data: null, error: { message: 'Network timeout' } })
                })
            })
        })
    };
    const resDbDown = await shouldBlockAutomatedFlow('51911222333', async () => {}, brokenSupabase);
    assert.equal(resDbDown.blocked, true);
    assert.equal(resDbDown.reason, 'human_active');

    // Caso 3: Conversación normal en modo bot
    const healthySupabase = {
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({ data: { status: 'bot' }, error: null })
                })
            })
        })
    };
    const resBotOk = await shouldBlockAutomatedFlow('51944555666', async () => {}, healthySupabase);
    assert.equal(resBotOk.blocked, false);
});

test('Ventana deslizante de memoria conversacional conserva máximo 4 turnos recientes', () => {
    const waId = '51900111222';
    clearConversationMemory(waId);

    appendConversationTurn(waId, 'user', 'Msg 1');
    appendConversationTurn(waId, 'assistant', 'Resp 1');
    appendConversationTurn(waId, 'user', 'Msg 2');
    appendConversationTurn(waId, 'assistant', 'Resp 2');
    appendConversationTurn(waId, 'user', 'Msg 3');

    const turns = getRecentConversationTurns(waId);
    assert.equal(turns.length, 4);
    assert.equal(turns[0].content, 'Resp 1');
    assert.equal(turns[3].content, 'Msg 3');
});

test('settingsService fusiona valores parciales y construye pasos y contexto dinámico', () => {
    const merged = mergeWithDefaults({
        admision: {
            proceso_actual: '2027-I',
            cierre_inscripciones: 'Hasta el 15 de Marzo del 2027'
        },
        modalidad_atencion: {
            limite_leads_diario: 80
        }
    });

    assert.equal(merged.admision.proceso_actual, '2027-I');
    assert.equal(merged.admision.cierre_inscripciones, 'Hasta el 15 de Marzo del 2027');
    assert.equal(merged.pagos.banco, 'Scotiabank');
    assert.equal(merged.modalidad_atencion.limite_leads_diario, 80);

    const ctxSummary = buildInstitutionalContextSummary();
    assert.match(ctxSummary, /PROCESO VIGENTE/);

    const stepsMsg = buildAdmissionStepsMessage(() => null);
    assert.match(stepsMsg, /Paso a paso para completar tu proceso de admisión/);
});

test('grokClient ejecuta failover automático y abre el Circuit Breaker tras 3 fallos seguidos', async () => {
    resetCircuitsForTest();
    const calls = [];

    // 3 peticiones donde el primario falla y el secundario responde
    for (let i = 0; i < 3; i++) {
        const data = await getGrokCompletion(
            [{ role: 'user', content: 'Hola' }],
            {
                apiKey: 'test-key',
                model: 'primary-broken-model',
                fallbackModel: 'secondary-healthy-model',
                _httpPost: async (_url, payload) => {
                    calls.push(payload.model);
                    if (payload.model === 'primary-broken-model') {
                        throw new Error('HTTP 503 Service Unavailable');
                    }
                    return { data: { choices: [{ message: { content: 'Respuesta OK' } }] } };
                }
            }
        );
        assert.equal(data.choices[0].message.content, 'Respuesta OK');
    }

    // El circuito del modelo primario debe estar abierto ahora
    assert.equal(isCircuitOpen('primary-broken-model'), true);
    assert.equal(isCircuitOpen('secondary-healthy-model'), false);

    // En la 4ta llamada debe saltar directo al modelo secundario sin tocar el primario
    calls.length = 0;
    await getGrokCompletion(
        [{ role: 'user', content: 'Segunda consulta' }],
        {
            apiKey: 'test-key',
            model: 'primary-broken-model',
            fallbackModel: 'secondary-healthy-model',
            _httpPost: async (_url, payload) => {
                calls.push(payload.model);
                return { data: { choices: [{ message: { content: 'Directo al fallback' } }] } };
            }
        }
    );
    assert.deepEqual(calls, ['secondary-healthy-model']);
});

test('httpAuthMiddleware protege rutas /bot/* y /v1/messages contra accesos no autenticados', async () => {
    const mockVerifyToken = async (tok) => (tok === 'valid-agent-token' ? { id: 'u1', username: 'agente1', role: 'agent' } : null);

    let capturedStatus = null;
    let capturedBody = '';
    const makeRes = () => ({
        set statusCode(code) { capturedStatus = code; },
        setHeader() {},
        end(str) { capturedBody = str; }
    });

    const protectedHandler = withAdminAuth(mockVerifyToken, async (_req, res) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
    }, { requireSuperadmin: true });

    // 1. Sin token -> 401
    await protectedHandler({ headers: {} }, makeRes());
    assert.equal(capturedStatus, 401);

    // 2. Token de agente en ruta de superadmin -> 403
    await protectedHandler({ headers: { authorization: 'Bearer valid-agent-token' } }, makeRes());
    assert.equal(capturedStatus, 403);
    assert.match(capturedBody, /Super Administrador/);

    // 3. /v1/messages sin API key ni Bearer -> bloqueado
    const webhookRes = await authorizeWebhookRequest({ headers: {} }, mockVerifyToken, { allowLegacyWhenUnconfigured: false });
    assert.equal(webhookRes.ok, false);
});

test('inscriptionService ejecuta 1 único LEFT JOIN parametrizado y hace fallback a Supabase si falla SQL local', async () => {
    const executedQueries = [];
    const mockQueryLocal = async (sql, params) => {
        executedQueries.push({ sql, params });
        return {
            rows: [{
                id_persona: 10,
                nombres: 'ANA',
                apellidos: 'TORRES',
                id_inscrito: 55,
                id_programa: 3,
                nombre_programa: 'Maestría en Ingeniería de Sistemas',
                postulante_inscrito_id: 55,
                id_estadoseguimiento: 3,
                mensaje_estado: 'Validado'
            }]
        };
    };

    const localRes = await checkInscriptionLocal('71234567', mockQueryLocal);
    assert.equal(executedQueries.length, 1);
    assert.match(executedQueries[0].sql, /LEFT JOIN inscripciones/);
    assert.deepEqual(executedQueries[0].params, ['71234567']);
    assert.equal(localRes.success, true);
    assert.equal(localRes.tieneExpediente, true);
    assert.equal(localRes.idEstadoSeguimiento, 3);

    // Fallback a Supabase cuando SQL local lanza error de red
    const mockSupabase = {
        from: (table) => ({
            select: () => ({
                eq: () => {
                    if (table === 'personas') return Promise.resolve({ data: [{ id_persona: 1, nombres: 'LUIS', apellidos: 'GOMEZ' }], error: null });
                    if (table === 'inscripciones') {
                        return {
                            order: () => ({
                                limit: async () => ({ data: [{ id_inscrito: 9, id_programa: 2, fecha_registro: '2026-08-01' }], error: null })
                            })
                        };
                    }
                    if (table === 'programas') return { maybeSingle: async () => ({ data: { nombre_programa: 'Doctorado en Administración' }, error: null }) };
                    if (table === 'postulantes') return Promise.resolve({ data: [], error: null });
                    return Promise.resolve({ data: [], error: null });
                }
            })
        })
    };

    const fbRes = await checkInscriptionByDni('70001111', {
        isLocalDbEnabled: () => true,
        queryLocalDb: async () => { throw new Error('ETIMEDOUT MySQL'); },
        supabase: mockSupabase
    });
    assert.equal(fbRes.success, true);
    assert.equal(fbRes.nombres, 'LUIS');
    assert.equal(fbRes.tieneExpediente, false);
});
