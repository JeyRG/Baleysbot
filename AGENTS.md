# REGLAS DE ARQUITECTURA Y OPERACIÓN - BOT2703

## 1. Topología y Contexto Previo (Graphify First)
- Antes de planear o ejecutar cambios estructurales, consultar el grafo local en [graphify-out/GRAPH_REPORT.md](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/graphify-out/GRAPH_REPORT.md) o [graphify-out/graph.json](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/graphify-out/graph.json).
- Mantener el grafo sincronizado tras refactorizaciones importantes ejecutando `graphify update .`.
- Prohibida la lectura masiva indiscriminada de ficheros enteros si el grafo ya resuelve el árbol de dependencias.

## 2. Orquestación Multi-Agente (Pipeline Jerárquico On-Demand)
- Se establece una arquitectura de 5 roles especializados:
  1. **Coordinator (`coordinator`):** Tech Lead, planificación con Graphify, gestión de `SPRINT_REGISTRY.md` y quality gates.
  2. **Developer (`developer`):** Implementación de código en slices atómicos (Node/Baileys backend y Next.js dashboard).
  3. **Researcher (`researcher`):** Investigación en modo solo lectura (docs oficiales, APIs, RAG y análisis de código).
  4. **SecOps Auditor (`security-auditor`):** Auditoría estricta de inyección SQL, escape de webhooks y control de dependencias.
  5. **QA Tester (`test-engineer`):** Validación funcional, test suites y pruebas de regresión en simulador.
- Las reglas detalladas residen en [.agents/rules/orchestration.md](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/.agents/rules/orchestration.md).

## 3. Economía de Tokens y Comunicación
- Respuestas directas, técnicas y concisas. Sin saludos, cortesías ni despedidas.
- Entregar únicamente fragmentos de código modificados con su justificación técnica directa.
- El enrutamiento y compresión de contexto se asumen gestionados vía OmniRoute.

## 4. Estándares UI/UX (Anti-AI Look & Accesibilidad)
- Evitar plantillas visuales genéricas generadas por IA (gradientes púrpura/violeta repetitivos, glassmorphism excesivo, tarjetas idénticas de 3 columnas sin densidad informacional).
- Aplicar tokens de diseño consistentes, jerarquía tipográfica contrastada y microinteracciones de alta fidelidad.
- Cumplimiento de accesibilidad WCAG AA, soporte completo de estados interactivos y navegación por teclado.

## 5. SecOps & Shift-Left Security
- MySQL / Base de Datos: Parametrizar estrictamente todas las sentencias SQL (prohibida la concatenación de variables en queries).
- Sanitización de entradas provenientes de WhatsApp / Webhooks antes de pasarlas a servicios de negocio o IA.
- Auditoría previa a la instalación de paquetes npm (`npm audit`, verificación de superficie de ataque y tamaño de dependencias).
- Reglas detalladas en [.agents/rules/secops.md](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/.agents/rules/secops.md).

## 6. Herramientas MCP, Quality Gates y Automatización
- Utilizar servidores MCP configurados (GitHub, Puppeteer, Filesystem) para inspección y validación autónoma antes de generar commits.
- Criterios de cierre y Definition of Done definidos en [.agents/rules/quality-gate.md](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/.agents/rules/quality-gate.md).
