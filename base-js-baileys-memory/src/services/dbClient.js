/**
 * Cliente agnóstico y resiliente para la base de datos SQL local de inscripciones.
 * Soporta conexión por PostgreSQL (pg) o MySQL (mysql2) mediante carga dinámica.
 * Si las dependencias no están instaladas o USE_LOCAL_DB es false, permite fallback transparente.
 */

const DB_TYPE = process.env.LOCAL_DB_TYPE || process.env.DB_TYPE || 'mysql'; // 'mysql' | 'postgres'
const DB_HOST = process.env.DB_HOST || process.env.LOCAL_DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || process.env.LOCAL_DB_PORT || (DB_TYPE === 'mysql' ? '3306' : '5432'), 10);
const DB_USER = process.env.DB_USER || process.env.LOCAL_DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASS || process.env.DB_PASSWORD || process.env.LOCAL_DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || process.env.LOCAL_DB_NAME || 'inscripciones_db';
const USE_LOCAL_DB = process.env.USE_LOCAL_DB === 'true' || Boolean(process.env.DB_HOST);

let pgPool = null;
let mysqlPool = null;
let initPromise = null;

async function initPool() {
    if (!USE_LOCAL_DB) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            if (DB_TYPE === 'mysql') {
                const mysql = await import('mysql2/promise');
                mysqlPool = mysql.default.createPool({
                    host: DB_HOST,
                    port: DB_PORT,
                    user: DB_USER,
                    password: DB_PASSWORD,
                    database: DB_NAME,
                    waitForConnections: true,
                    connectionLimit: 10,
                    queueLimit: 0,
                });
                console.log(`[LocalSQL] Pool MySQL inicializado para ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
            } else {
                const pg = await import('pg');
                const { Pool } = pg.default || pg;
                pgPool = new Pool({
                    host: DB_HOST,
                    port: DB_PORT,
                    user: DB_USER,
                    password: DB_PASSWORD,
                    database: DB_NAME,
                    max: 10,
                    idleTimeoutMillis: 30000,
                });
                pgPool.on('error', (err) => {
                    console.error('[LocalSQL] Error inesperado en pool PostgreSQL:', err.message);
                });
                console.log(`[LocalSQL] Pool PostgreSQL inicializado para ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
            }
        } catch (e) {
            console.warn(`[LocalSQL] No se pudo inicializar el driver ${DB_TYPE}:`, e.message);
            console.warn('[LocalSQL] Se activará el fallback automático a Supabase.');
        }
    })();

    return initPromise;
}

// Iniciar en segundo plano si está activo
if (USE_LOCAL_DB) {
    initPool();
}

/**
 * Ejecuta una consulta SQL 100% parametrizada contra la base local.
 * @param {string} text Consulta SQL con marcadores ($1, $2 para PG o ? para MySQL)
 * @param {Array} params Parámetros sanitizados
 */
export async function queryLocalDb(text, params = []) {
    if (!USE_LOCAL_DB) {
        throw new Error('USE_LOCAL_DB no está activo');
    }

    await initPool();

    if (DB_TYPE === 'mysql') {
        if (!mysqlPool) throw new Error('mysql2 no está disponible');
        const mysqlQuery = text.replace(/\$\d+/g, '?');
        const [rows] = await mysqlPool.execute(mysqlQuery, params);
        return { rows };
    } else {
        if (!pgPool) throw new Error('pg no está disponible');
        const res = await pgPool.query(text, params);
        return res;
    }
}

export function isLocalDbEnabled() {
    return USE_LOCAL_DB;
}

export { pgPool, mysqlPool };
