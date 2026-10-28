# Sistema de Cuentas (Superadmin + Agentes)

Panel con roles para gestionar quién responde los mensajes del bot, con auditoría y métricas por día.

## Componentes

| Parte | Archivo | Función |
|---|---|---|
| Migración SQL | `base-js-baileys-memory/migrations/admin_accounts.sql` | Tablas `admin_users`, `audit_log`, `admin_sessions`, columnas `sent_by`/`sent_by_name` en `messages`, vista `agent_daily_stats` |
| Servicio de auth | `base-js-baileys-memory/src/services/adminAuth.js` | Hash scrypt de contraseñas, sesiones por token, CRUD y auditoría |
| Endpoints | `base-js-baileys-memory/src/app.js` (`/admin/*`) | login, logout, me, users CRUD, audit, agent-stats |
| Script superadmin | `base-js-baileys-memory/src/scripts/createSuperadmin.js` | Crea el primer superadmin |
| Cliente API | `dashboard/src/lib/adminApi.ts` | Llamadas desde el dashboard |
| Login | `dashboard/src/app/login/page.tsx` | Usuario + contraseña (reemplaza el PIN) |
| UI usuarios | `dashboard/src/components/dashboard/UsersManager.tsx` | Solo superadmin |
| UI auditoría | `dashboard/src/components/dashboard/AuditLog.tsx` | Solo superadmin |
| UI métricas | `dashboard/src/components/dashboard/AgentStats.tsx` | Mensajes por día/agente |

## Activación (paso a paso)

### 1. Aplicar la migración en Supabase
Abre Supabase → SQL Editor → pega y ejecuta el contenido de
`base-js-baileys-memory/migrations/admin_accounts.sql`.

### 2. Crear el superadmin
```bash
cd base-js-baileys-memory
node src/scripts/createSuperadmin.js superadmin "TuContraseñaSegura" "Tu Nombre"
```
> El usuario queda con rol `superadmin` (puede crear/editar/eliminar cuentas).

### 3. Reiniciar el bot
```bash
pm2 restart BotW
```

### 4. Entrar al panel
- Abre el dashboard → te redirige a `/login`
- Entra con el usuario y contraseña creados
- El menú lateral ahora muestra:
  - **Actividad Agentes** (todos): mensajes respondidos por día y por agente
  - **Cuentas** (solo superadmin): crear/modificar/eliminar agentes y cambiar contraseñas
  - **Auditoría** (solo superadmin): log de logins y cambios de cada usuario

## Cómo funciona la trazabilidad

1. Cada agente entra con su usuario/contraseña → el login queda registrado en `audit_log`.
2. Cuando un agente responde desde el Inbox, el mensaje se guarda en `messages` con
   `sent_by` (id) y `sent_by_name` (nombre) → la vista `agent_daily_stats` agrupa
   esos mensajes por día y por agente.
3. Las acciones sobre cuentas (crear, modificar, eliminar, login fallido) quedan en `audit_log`.

## Seguridad

- Contraseñas con **scrypt + salt** (nunca en texto plano, nunca expuestas al navegador).
- Sesiones con **token opaco** de 48 h en `admin_sessions`; al cambiar una contraseña o
  desactivar la cuenta, sus sesiones se cierran.
- RLS habilitado en `admin_users`, `audit_log` y `admin_sessions` con **deny-all**
  para la anon key del navegador; solo el backend del bot (service key) los toca.
- Las acciones de solo-superadmin se validan en el backend (`adminAuth.js`), no solo en la UI.

## Consideraciones

- El superadmin no puede desactivarse ni eliminarse a sí mismo.
- Los agentes (rol `agent`) ven el Inbox y la actividad, pero NO el menú de Cuentas ni Auditoría.
- La auditoría actual registra autenticación y gestión de cuentas. Extenderla a acciones
  sobre conocimiento (KnowledgeManager) requiere pasar el actor en esas llamadas.
