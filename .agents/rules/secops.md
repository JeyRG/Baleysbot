# REGLA: SECOPS & SHIFT-LEFT SECURITY

## 1. Bases de Datos (MySQL y Supabase)
- **Cero Concatenación en SQL:** Todas las consultas SQL en `base-js-baileys-memory/src/services/` o scripts de migración deben estar parametrizadas mediante `?` o argumentos nombrados.
- **Validación de Esquema:** Toda migración DDL debe contemplar índices adecuados, constraints de clave foránea e idempotencia (`IF NOT EXISTS`).

## 2. Ingesta de Datos y Webhooks (WhatsApp / Baileys)
- Sanitizar y validar tipos en todos los mensajes entrantes antes de transferirlos a Groq/LLM o a la capa de persistencia.
- Tratar los outputs de los modelos de IA como datos no confiables (nunca evaluarlos con `eval()`, inyectarlos en HTML crudo ni pasarlos directamente a comandos de shell).

## 3. Dependencias y Cadena de Suministro
- Prohibida la instalación de nuevos paquetes npm sin previa verificación de legitimidad, tamaño y ejecución de `npm audit`.
- Ninguna clave de API, token de sesión o secreto debe estar en el código fuente ni en el bundle del cliente; usar variables de entorno del servidor.
