# REGLAS DE ARQUITECTURA Y OPERACIÓN - BOT2703

## 1. Topología y Contexto Previo (Graphify First)
- Antes de planear o ejecutar cambios estructurales, consultar el grafo local en [graphify-out/GRAPH_REPORT.md](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/graphify-out/GRAPH_REPORT.md) o [graphify-out/graph.json](file:///c:/Users/JEYSON/3D%20Objects/BOT2703/graphify-out/graph.json).
- Mantener el grafo sincronizado tras refactorizaciones importantes ejecutando `graphify update .`.
- Prohibida la lectura masiva indiscriminada de ficheros enteros si el grafo ya resuelve el árbol de dependencias.

## 2. Economía de Tokens y Comunicación
- Respuestas directas, técnicas y concisas. Sin saludos, cortesías ni despedidas.
- Entregar únicamente fragmentos de código modificados con su justificación técnica directa.
- El enrutamiento y compresión de contexto se asumen gestionados vía OmniRoute.

## 3. Estándares UI/UX (Anti-AI Look & Accesibilidad)
- Evitar plantillas visuales genéricas generadas por IA (gradientes púrpura/violeta repetitivos, glassmorphism excesivo, tarjetas idénticas de 3 columnas sin densidad informacional).
- Aplicar tokens de diseño consistentes, jerarquía tipográfica contrastada y microinteracciones de alta fidelidad.
- Cumplimiento de accesibilidad WCAG AA, soporte completo de estados interactivos y navegación por teclado.

## 4. SecOps & Shift-Left Security
- MySQL / Base de Datos: Parametrizar estrictamente todas las sentencias SQL (prohibida la concatenación de variables en queries).
- Sanitización de entradas provenientes de WhatsApp / Webhooks antes de pasarlas a servicios de negocio o IA.
- Auditoría previa a la instalación de paquetes npm (`npm audit`, verificación de superficie de ataque y tamaño de dependencias).

## 5. Herramientas MCP y Automatización
- Utilizar servidores MCP configurados (GitHub, Puppeteer, Filesystem) para inspección y validación autónoma antes de generar commits.
