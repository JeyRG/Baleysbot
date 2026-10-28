# BOT2703 — Sistema de Atención (Escuela de Posgrado UNAC)

Bot de WhatsApp con memoria (RAG) + ecosistema web (widget de chat + dashboards).

## Estructura del proyecto

```
BOT2703/
├── base-js-baileys-memory/   # Bot principal (Node.js + Baileys)
│   ├── src/                  #   Código fuente (app.js, servicios, scripts)
│   │   ├── app.js            #     Punto de entrada (PM2: "BotW")
│   │   ├── grokClient.js     #     Cliente de IA (Groq/Llama 3.3)
│   │   ├── services/         #     supabase, embeddings, knowledge, catalog
│   │   ├── scripts/          #     scrapeBrochures, trainKnowledgeBase (manual)
│   │   └── data/             #     brochures.json
│   ├── tools/                # Scripts de mantenimiento/debug (no producción)
│   │   └── scratch/          #   Pruebas y migraciones puntuales
│   ├── logs/                 # Logs de runtime (gitignored)
│   ├── programas.json        # Catálogo de programas
│   ├── schema.sql            # Estructura de tablas Supabase
│   └── .env                  # Credenciales (NO versionar)
│
├── chat-widget/              # Widget web (index.html, widget.js, widget.css)
├── dashboard/                # Dashboard Next.js (build + puerto 3004)
│
├── docs/                     # Documentación
│   ├── plan_de_trabajo.txt   #   Plan de integración chat web (4 fases)
│   ├── GUIA_DESPLIEGUE_VPS.txt #  Despliegue en VPS Ubuntu
│   └── supabase-schema.txt   #   Documentación del schema de BD
│
├── archive/                  # Código/docs antiguos (referencia, no activos)
│   ├── php-dashboard/        #   Dashboard PHP (no integrado actualmente)
│   ├── app_rc13.js           #   Versión vieja del bot
│   └── ...
├── graphify-out/             # Grafo de conocimiento (generado, gitignored)
└── README.md
```

## Puesta en marcha

### Bot (backend)
```bash
cd base-js-baileys-memory
npm install
# Crear .env con credenciales de Supabase y Groq (ver docs/GUIA_DESPLIEGUE_VPS.txt)
npm run dev            # desarrollo
pm2 start src/app.js --name BotW   # producción
```

### Dashboard (frontend)
```bash
cd dashboard
npm install
# Crear .env.local con credenciales de Supabase
npm run build
npm run start -- -p 3004
```

## Stack
Node.js 20 · Baileys (@builderbot) · Next.js · Supabase · Groq (Llama 3.3) · PM2 · Nginx

## Sistema de cuentas (superadmin + agentes)
El panel soporta múltiples agentes con usuario/contraseña, auditoría de acciones
y métricas de mensajes por día y por agente.
Ver guía de activación: `docs/sistema_cuentas.md`.

## Estado
En desarrollo. Próximo hito: integración del chat web (ver `docs/plan_de_trabajo.txt`).

## Seguridad
Los archivos `.env` / `.env.local` contienen credenciales y **no deben subirse a git**.
