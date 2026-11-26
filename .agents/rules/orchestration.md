# REGLA: ORQUESTACIÓN Y TOPOLOGÍA MULTI-AGENTE

## 1. Topología de Roles y Pipeline
El desarrollo en BOT2703 sigue un modelo jerárquico por fases (Pipeline On-Demand):
1. **Coordinator:** Recibe el requerimiento, consulta el grafo en `graphify-out/` y desglosa tareas atómicas.
2. **Researcher (Read-only):** Investiga APIs, documentación o rastrea el flujo en el código sin mutar archivos.
3. **Developer:** Implementa código en slices atómicos dentro de `base-js-baileys-memory/` o `dashboard/`.
4. **SecOps Auditor:** Valida que no existan inyecciones SQL, datos sensibles expuestos ni vectores de inyección en webhooks.
5. **QA Tester:** Diseña y ejecuta pruebas de regresión, simulación en `test_bot.js` o unit tests.

## 2. Prohibición de Enjambres No Coordinados
- Está prohibido que múltiples agentes editen archivos concurrentemente sin orden secuencial.
- Toda mutación de código pasa por el ciclo: Coordinación → Implementación → SecOps & QA Gate → Sincronización Graphify.

## 3. Preservación del Contexto
- El Coordinador debe filtrar y proveer únicamente los fragmentos y subgrafos relevantes al agente asignado.
- La comunicación debe ser técnica, directa y desprovista de cortesías superfluas (cumplimiento de economía de tokens).
