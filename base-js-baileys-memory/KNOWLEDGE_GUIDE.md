# Guía de Nutrición de Conocimiento (Entrenamiento del Bot)

Este documento explica cómo "entrenar" o nutrir a tu bot de WhatsApp con información específica sobre costos, fechas, requisitos y cualquier otro dato de la Escuela de Posgrado UNAC usando **Supabase**.

## 🧠 ¿Cómo aprende el Bot?

Tu bot utiliza una arquitectura de **RAG (Generación Aumentada por Recuperación)**. Esto significa que antes de responder, busca en Supabase si existe información relevante para la pregunta del usuario.

Existen dos formas principales de nutrirlo:

---

### 1. Base de Conocimientos (Knowledge Base) - Recomendado para Datos Generales
Ideal para: Costos de maestrías, fechas de admisión, requisitos de grado, ubicación de locales.

*   **Cómo funciona**: Guardamos trozos de texto en la tabla `knowledge_base`. Cuando el usuario pregunta, el bot busca los trozos más parecidos y se los pasa a la IA (Grok) como "apuntes" para que responda con precisión.
*   **Ventaja**: Permite que el bot responda preguntas que no están en el archivo `programas.json`.

**Ejemplo de información a subir:**
> "El costo de inscripción para el proceso de admisión 2026 es de S/ 200 para todas las maestrías. El pago se realiza en el Scotiabank a la cuenta 000-3747336."

---

### 2. Caché Semántica (Semantic Cache) - Recomendado para Preguntas Frecuentes (FAQ)
Ideal para: Preguntas exactas con respuestas que quieres que sean SIEMPRE iguales y muy rápidas.

*   **Cómo funciona**: Guardamos el par "Pregunta -> Respuesta" en la tabla `semantic_cache`. Si alguien hace una pregunta idéntica o muy similar, el bot responde instantáneamente sin consultar a la IA, ahorrando costos de tokens.
*   **Ventaja**: Ahorro de dinero y velocidad extrema.

**Ejemplo:**
*   **Pregunta**: "¿Tienen doctorados en Salud?"
*   **Respuesta**: "Sí, contamos con el Doctorado en Salud Pública. Las inscripciones están abiertas hasta el 21 de marzo. ¿Deseas más información?"

---

## 🛠 Herramientas que implementaremos

Para que no tengas que usar SQL, crearemos una herramienta automática:

1.  **Script `npm run train`**: Un comando donde simplemente escribes el texto y nosotros nos encargamos de convertirlo a "vectores" y subirlo a Supabase.
2.  **Panel de Supabase**: Podrás ver y editar tus "conocimientos" directamente desde la web de Supabase en las tablas `knowledge_base` y `semantic_cache`.

---

## 🚀 Próximos Pasos

1.  **Modificar `app.js`**: Para que el bot empiece a "escuchar" a la tabla `knowledge_base` de Supabase.
2.  **Crear `train.js`**: El asistente que te ayudará a subir información fácilmente.
3.  **Primera carga**: Subiremos tus datos de costos y fechas para probar la memoria del bot.

¿Listo para empezar a nutrir a tu bot? 🤖✨
