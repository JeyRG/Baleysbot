---
name: anti-ai-ui-ux
description: >-
  Use this skill when developing or refactoring frontend interfaces, dashboards, or web pages to avoid stereotypical AI-generated aesthetics (generic purple gradients, uniform 3-card layouts, excessive blur) and achieve crafted, high-density, accessible, human-designed digital products.
---

# Anti-AI UI/UX Design System & Craft Guidelines

## 1. Deconstrucción de Antipatrones "Hecho por IA"

| Antipatrón AI Típico | Reemplazo por Diseño Artesanal ("Human Crafted") |
| :--- | :--- |
| Gradiente violeta/fucsia (`indigo-600` a `purple-500`) sobre fondo negro plano | Paletas monocromáticas profundas (Zinc/Slate) con un único acento funcional de alto contraste (ej. Ámbar técnico, Azul Cobalto profundo o Esmeralda industrial). |
| Grid de 3 tarjetas idénticas con icono centrado y textos genéricos | Layouts asimétricos o modulares basados en jerarquía de información real (1 card hero con datos clave + panel lateral de métricas + lista densa). |
| Glassmorphism excesivo (`backdrop-blur-md` y bordes blancos traslúcidos en todo) | Superficies con elevación física: bordes finos de contraste (`border-neutral-800`), sombras multicapa y fondos sólidos o semitransparentes sutiles. |
| Textos de marketing abstractos ("Transform your workflow with AI") | Microcopy funcional, directo y orientado a acciones técnicas y métricas cuantificables. |
| Animaciones genéricas (`transition: all 0.3s ease`) | Transiciones con curvas de amortiguación real (`cubic-bezier(0.16, 1, 0.3, 1)` o spring sutil), microinteracciones en hover/focus. |

---

## 2. Fundamentos de Ejecución

### A. Tipografía y Escala Modular
- **Pairing intencional**:
  - Encabezados y UI: Tipografías grotesk o neo-grotesk contemporáneas (ej. *Inter*, *Plus Jakarta Sans*, *Geist*).
  - Métricas, código, hashes y logs: Monoespaciada precisa (ej. *JetBrains Mono*, *Geist Mono*).
- **Escala jerárquica estricta**:
  - `text-xs` (11-12px): Metadatos, timestamps, badges de estado.
  - `text-sm` (13-14px): Texto base de tablas, formularios y controles.
  - `text-base` (15-16px): Lectura de bloques.
  - `text-lg` a `text-2xl`: Títulos de sección y encabezados primarios. No inflar tamaños sin justificación.

### B. Paleta de Color y Superficies (Dark & Light)
```css
/* Tokens de superficie para Dark Mode artesanal */
:root {
  --bg-canvas: #090a0f;
  --bg-surface: #11131a;
  --bg-surface-raised: #181b24;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-focus: rgba(255, 255, 255, 0.2);
  --text-primary: #f0f2f5;
  --text-secondary: #9ba1b0;
  --text-muted: #5e6473;
  --accent-action: #2563eb;
  --accent-action-hover: #1d4ed8;
  --status-success: #10b981;
  --status-warning: #f59e0b;
  --status-danger: #ef4444;
}
```

### C. Densidad de Componentes (Inspiración Linear/Raycast/Supabase)
- **Tablas y Listas**:
  - Filas compactas (`py-2.5` a `py-3`), alineación numérica a la derecha con `font-mono`.
  - Estados hover claros sobre la fila completa (`hover:bg-surface-raised`).
- **Badges y Etiquetas de Estado**:
  - Tamaños reducidos, tipografía mono o semi-bold en mayúsculas pequeñas (`tracking-wider text-[11px]`).
  - Indicador de estado con punto (dot indicator) con pulso condicional sólo cuando sea un proceso activo en tiempo real.
- **Acciones y Botones**:
  - Botón primario: Fondo sólido de alto contraste con texto legible.
  - Botones secundarios: Fondo neutro con borde sutil.
  - Atajos de teclado visibles (ej. `⌘K`, `Esc`) estilizados con etiqueta `<kbd>`.

### D. Accesibilidad y Validación (WCAG AA/AAA)
1. Foco visible en todos los elementos interactivos: `focus-visible:ring-2 focus-visible:ring-offset-2`.
2. Contraste mínimo de texto: `4.5:1` para texto normal, `3:1` para elementos gráficos y texto grande.
3. Compatibilidad con lectores de pantalla mediante etiquetas semánticas (`<header>`, `<nav>`, `<main>`, `<aside>`, `aria-live` para actualizaciones en tiempo real).
