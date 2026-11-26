# REGLA: QUALITY GATES Y DEFINITION OF DONE (DoD)

## 1. Criterios de Aceptación Obligatorios (Definition of Done)
Una tarea o sprint sólo se considera finalizado cuando:
- [ ] El código compila y ejecuta sin errores en Node.js y Next.js.
- [ ] SecOps ha validado la parametrización de consultas SQL y sanitización de inputs.
- [ ] Se han verificado las pruebas unitarias / funcionales pertinentes.
- [ ] La interfaz gráfica cumple con estándares Anti-AI (paleta estructurada, sin gradientes púrpuras genéricos, WCAG AA).
- [ ] No se han introducido supresiones silenciosas de errores (`@ts-ignore`, `eslint-disable` injustificados).

## 2. Sincronización del Grafo
- Tras cualquier cambio estructural o adición de nuevos módulos, se debe ejecutar `graphify update .` para mantener al día `graphify-out/GRAPH_REPORT.md` y `graphify-out/graph.json`.
- `SPRINT_REGISTRY.md` debe actualizarse reflejando los entregables y el estado de los tickets completados.
