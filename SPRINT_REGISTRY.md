# REGISTRO DE SPRINTS DEL PROYECTO (SPRINT_REGISTRY.md)

## OBJETIVO GENERAL DEL PROYECTO
Construir e integrar un sistema centralizado, modular, seguro y de alta disponibilidad con **Arquitectura Híbrida**:
1. **Base de Datos Académica Universitaria (MySQL / Servidor Propio)**: Nutre la verificación de expedientes, inscripciones, postulantes, programas y estados (`epgunac_epgunac`), operando con consultas 100% parametrizadas vía `dbClient.js`.
2. **Base de Datos Operativa del Bot (Supabase)**: Mantiene la persistencia del bot (`conversations`, `messages`, embeddings vectoriales de `knowledge_base`, caché semántico, `audit_log`, `admin_users` y sesiones en tiempo real).
3. **Dashboard con Handover Bot-to-Human de Alta Fidelidad**: Panel operativo en tiempo real donde los operadores responden mensajes pausando el bot automáticamente, con indicadores de estado de conexión, reasignación y alertas visuales/sonoras.
4. **Control de Acceso Basado en Roles (RBAC)**: Autenticación robusta (Super Admin y Agentes/Operadores), protección de rutas API/Frontend y limitación de capacidades según privilegios.
5. **Sistema Integral de Trazabilidad (Audit Logs)**: Registro inmutable de acciones en backend y dashboard (quién, qué, cuándo, IP y detalles) para envíos de mensajes, handover, cambios de inscripciones y gestión de usuarios.
6. **Ciberseguridad Shift-Left & UI/UX Anti-AI**: Prevención de SQLi, XSS, rate-limiting, autenticación segura de cookies/tokens, sanitización de webhooks y diseño accesible (WCAG AA).

---

## PLANIFICACIÓN DE SPRINTS

### [x] Sprint 0: Descubrimiento, Topología con Graphify y Planificación de Arquitectura
- [x] Ejecución de Graphify AST en modo incremental/code-only sobre el workspace.
- [x] Análisis del schema relacional (PostgreSQL/Supabase vs MySQL) de inscripciones, postulantes y personas.
- [x] Evaluación de los sistemas actuales de backend (`base-js-baileys-memory`), dashboard (`Next.js 14`) y servicios de datos.
- [x] Formulación y creación del `SPRINT_REGISTRY.md`.

---

### [x] Sprint 1: Conexión a Base de Datos Universitaria Existente y Migración en Vivo
- [x] **Estado**: Completado (Conexión Verificada en Vivo)
- [x] **Tareas Realizadas**:
  - [x] Esquema DDL de referencia mapeado en [schema_local_sql.sql](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/migrations/schema_local_sql.sql).
  - [x] Capa agnóstica de conexión con queries parametrizadas y driver `mysql2` en [dbClient.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/services/dbClient.js).
  - [x] Conexión establecida con éxito a la base de datos `epgunac_epgunac` (31 tablas operativas encontradas: `inscripciones`, `personas`, `postulantes`, `programas`, `estados_seguimiento`, etc.).
  - [x] Servicio [inscriptionService.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/services/inscriptionService.js) verificado en vivo ejecutando consultas parametrizadas contra el servidor SQL universitario.

---

### [x] Sprint 2: Handover Bot-to-Human Bidireccional & Control en Tiempo Real
- [x] **Estado**: Completado
- [x] **Tareas**:
  - [x] Revisar y reforzar el ciclo de vida del estado de conversación (`status: 'bot' | 'human_active'`) en `app.js` y `MessageList.tsx`.
  - [x] Implementar endpoints en backend del bot para control explícito de handover (`POST /admin/conversations/handoff`) con verificación de sesión y registro de auditoría inmediato.
  - [x] Implementar temporizador configurable de auto-liberación por inactividad (`reset_inactive_conversations`) e integración con `adminApi.ts`.
  - [x] Añadir soporte para envío directo desde el dashboard con bypass inmediato de deduplicación y trazabilidad del operador (`sent_by`, `sent_by_name`).
- [x] **Resumen**: Implementado endpoint seguro `/admin/conversations/handoff` en el backend con token validation y escritura en `audit_log`, añadido método `adminApi.setHandoff` en frontend y reforzado el control de handover y resolución en `MessageList.tsx`.

---

### [x] Sprint 3: Sistema RBAC Integral y Protección de Rutas (Super Admin & Operadores)
- [x] **Estado**: Completado (Autenticación y Cuentas 100% en Supabase)
- [x] **Tareas Realizadas**:
  - [x] Aislamiento de cuentas en Supabase: Tablas `admin_users`, `admin_sessions` y triggers ejecutados directamente en Supabase vía API con `SUPABASE_ACCESS_TOKEN`.
  - [x] Creación del usuario Super Administrador inicial (`admin`) con hash nativo `scrypt` y sal de 16 bytes.
  - [x] Protección de endpoints administrativos (`GET /admin/users`, `POST /admin/users`, `PUT /admin/users/:id`, `DELETE /admin/users/:id`) con verificación estricta de token y rol `superadmin`.
  - [x] Guardas de seguridad en el frontend [ChatLayout.tsx](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/dashboard/src/components/chat/ChatLayout.tsx) bloqueando el acceso a gestión de cuentas a usuarios con rol `agent`.
- [x] **Resumen**: Cuentas, roles y sesiones desacopladas de MySQL y alojadas 100% en Supabase. MySQL se reserva exclusivamente para las consultas académicas de inscripciones.

---

### [x] Sprint 4: Auditoría Integral (Audit Logs) & Trazabilidad de Operaciones
- [x] **Estado**: Completado (Trazabilidad Centralizada en Supabase)
- [x] **Tareas Realizadas**:
  - [x] Tabla `audit_log` aprovisionada y operativa en Supabase con índices para consultas de alta velocidad.
  - [x] Captura en tiempo real de eventos de auditoría: logins exitosos, logins fallidos con IP, envíos manuales de operadores y acciones de handover (`handoff_pause_bot`, `handoff_resume_bot`).
  - [x] Visor interactivo en [AuditLog.tsx](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/dashboard/src/components/dashboard/AuditLog.tsx) con buscador en tiempo real, filtro semántico por acción e inspección de payloads JSON.
- [x] **Resumen**: Sistema de auditoría centralizado e inmutable en Supabase conectado en tiempo real al Dashboard.

---

### [x] Sprint 5: UI/UX Anti-AI, Ciberseguridad Integral & Pruebas End-to-End
- [x] **Estado**: Completado
- [x] **Tareas**:
  - [x] Refinar el diseño visual y resolver accesibilidad (WCAG AA), jerarquía tipográfica contrastada con Outfit/Inter, soporte completo de modos claro/oscuro y microinteracciones fluidas.
  - [x] Implementar cabeceras HTTP de seguridad en [next.config.mjs](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/dashboard/next.config.mjs): `Strict-Transport-Security` (HSTS), `X-Frame-Options` (anti clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy` y `Permissions-Policy`.
  - [x] Desactivar firma informativa `X-Powered-By` (`poweredByHeader: false`) para mitigar reconocimiento y enumeración de tecnologías.
  - [x] Sanitización exhaustiva de entradas de DNI, números y payloads para prevención estricta de SQLi y XSS en backend y frontend.
  - [x] Compilación de producción validada exitosamente con `next build` (cero errores de compilación, 5 rutas estáticas generadas).
  - [x] Sincronización del grafo arquitectural con `graphify update .` (569 nodos, 933 aristas, 40 comunidades).
- [x] **Resumen**: Construcción e integración completadas de extremo a extremo. El sistema opera con arquitectura desacoplada: MySQL universitario para consultas de postulantes e inscripciones, y Supabase para operación de mensajería, autenticación RBAC y trazabilidad de auditoría.

---

### [x] Sprint 6: Hotfix de Inferencia Groq & Resiliencia del LLM
- [x] **Estado**: Completado
- [x] **Tareas**:
  - [x] Diagnóstico de fallo HTTP 404 en la API de Groq: `llama-3.1-8b-instant` deprecado en la cuenta del usuario.
  - [x] Configuración de modelo activo verificado: `openai/gpt-oss-20b` como primario y `openai/gpt-oss-120b` como fallback automático en [.env](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/.env).
  - [x] Refactorización de [grokClient.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/grokClient.js) implementando función `executeGroqRequest`, reintentos automáticos de fallback ante fallos de modelo, y delimitación estricta de `max_tokens` (máx. 250) para prevenir violaciones de OTPM.
  - [x] Pruebas automatizadas de inferencia contextual exitosas (código 200, seguimiento de datos de posgrado UNAC y formateo WhatsApp conciso).
- [x] **Resumen**: Motor de inferencia Groq 100% restablecido y blindado con tolerancia a fallos mediante modelo dual.

---

### [x] Sprint 7: Modularización de Flujos y Reorganización de Rutas HTTP
- [x] **Estado**: Completado
- [x] **Tareas**:
  - [x] Desacoplar `welcomeFlow` y subflujos en módulos especializados: [flowExpediente.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/flows/flowExpediente.js) y [flowInscripcion.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/flows/flowInscripcion.js).
  - [x] Extraer los 17 endpoints HTTP monolíticos de `app.js` en controladores dedicados en `src/routes/`:
    - [knowledgeRoutes.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/routes/knowledgeRoutes.js) (RAG, unresolved, cache, simulador).
    - [reviewRoutes.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/routes/reviewRoutes.js) (Aprobación, corrección y estadísticas de interacción).
    - [authRoutes.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/routes/authRoutes.js) (Login, sesión, usuarios, auditoría y handoff).
    - [messagingRoutes.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/routes/messagingRoutes.js) (Envío de mensajes y encolamiento de leads).
  - [x] Extraer persistencia de datos de usuario y límites diarios en [userService.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/services/userService.js).
  - [x] Reducción drástica del tamaño de [app.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/app.js) de 2316 a 1461 líneas con validación de sintaxis 100% limpia.

---

### [x] Sprint 8: RAG 2.0 & Enriquecimiento del Dataset de Entrenamiento
- [x] **Estado**: Completado
- [x] **Tareas**:
  - [x] Aplicar índice GIN sobre columna `metadata` en tabla `knowledge_base` de Supabase ([rag_2_0.sql](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/migrations/rag_2_0.sql)).
  - [x] Crear e implementar función RPC `match_documents_filtered` para búsqueda semántica combinada con filtrado de metadatos JSONB (`@>`).
  - [x] Construir dataset estructurado [conocimiento_posgrado.json](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/data/conocimiento_posgrado.json) con metadatos de programas, costos bancarios, requisitos y modalidad presencial/híbrida.
  - [x] Refactorizar [train.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/train.js) para soportar ingesta estructurada JSON, deduplicación automática y vectorización con modelo local MiniLM.
  - [x] Calibrar `match_threshold` en [app.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/app.js) de 0.78 (demasiado restrictivo) a 0.45 para maximizar precisión en consultas académicas en español.

---

### [x] Sprint 9: Consola de Entrenamiento Activo en Dashboard
- [x] **Estado**: Completado
- [x] **Tareas**:
  - [x] Conexión de [KnowledgeManager.tsx](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/dashboard/src/components/dashboard/KnowledgeManager.tsx) con la API REST del bot (`/bot/knowledge`, `/bot/unresolved`, `/bot/cache`, `/bot/responses-review`).
  - [x] Flujo de aprobación (`/approve`) con inserción automática en `semantic_cache` y flujo de corrección (`/correct`) con inserción combinada en memoria semántica y `knowledge_base`.
  - [x] Implementación de endpoint de simulación y diagnóstico en tiempo real `POST /bot/simulate` en [knowledgeRoutes.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/routes/knowledgeRoutes.js).
  - [x] Verificación de compilación de producción con Next.js (`npm run build`: código 0, cero errores de tipado o linting).
  - [x] Sincronización del grafo arquitectural con `graphify update .` (596 nodos, 1000 aristas, 45 comunidades).

---

## RESUMEN EJECUTIVO DE ENTREGABLES
1. **Base de Datos Académica Universitaria**:
   - Conexión: [dbClient.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/services/dbClient.js) con queries parametrizadas a `epgunac_epgunac`.
   - Consulta de Expedientes: [inscriptionService.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/services/inscriptionService.js) verificado en vivo con registros de postulantes.
2. **Base de Datos del Bot y Panel (Supabase)**:
   - Cuentas y Auditoría: [admin_accounts.sql](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/migrations/admin_accounts.sql) aplicado directamente en Supabase vía Management API.
   - RAG 2.0 y Metadatos: [rag_2_0.sql](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/migrations/rag_2_0.sql) con índice GIN y RPC `match_documents_filtered`.
3. **Inferencia IA Resiliente (Groq)**:
   - Motor Dual: Primario `openai/gpt-oss-20b` con failover a `openai/gpt-oss-120b` en [grokClient.js](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/base-js-baileys-memory/src/grokClient.js).
4. **Flujos Conversacionales y Rutas Modulares**:
   - Separación estricta de controladores en `src/routes/` y flujos en `src/flows/`.
5. **Dashboard de Entrenamiento y Operaciones**:
   - [KnowledgeManager.tsx](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/dashboard/src/components/dashboard/KnowledgeManager.tsx) con soporte completo de active feedback loop.
   - `next build`: **Exitoso (Code 0)**
   - `graphify update .`: **Sincronizado (596 nodos, 1000 aristas, 45 comunidades)**
