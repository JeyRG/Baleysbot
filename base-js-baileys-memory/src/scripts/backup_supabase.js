import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../services/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TABLES_TO_BACKUP = [
    'bot_settings',
    'students',
    'conversations',
    'messages',
    'chatbot_interactions',
    'unresolved_queries',
    'knowledge_base',
    'semantic_cache'
];

async function backupTable(tableName, backupDir) {
    console.log(`[Backup] Exportando tabla: ${tableName}...`);
    let allRows = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const from = page * pageSize;
        const to = from + pageSize - 1;

        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .range(from, to);

        if (error) {
            console.error(`[Backup] ❌ Error leyendo ${tableName}:`, error.message);
            break;
        }

        if (data && data.length > 0) {
            allRows.push(...data);
            page++;
            if (data.length < pageSize) hasMore = false;
        } else {
            hasMore = false;
        }
    }

    const filePath = path.join(backupDir, `${tableName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(allRows, null, 2), 'utf8');
    console.log(`[Backup] ✅ ${tableName}: ${allRows.length} registros guardados en ${filePath}`);
    return allRows.length;
}

async function runFullBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(process.cwd(), 'backups', `supabase_backup_${timestamp}`);

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    console.log(`=======================================================`);
    console.log(` INICIANDO BACKUP COMPLETO DE SUPABASE`);
    console.log(` Carpeta destino: ${backupDir}`);
    console.log(`=======================================================`);

    const summary = {};
    for (const table of TABLES_TO_BACKUP) {
        summary[table] = await backupTable(table, backupDir);
    }

    const summaryPath = path.join(backupDir, '_manifest.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
        created_at: new Date().toISOString(),
        supabase_url: process.env.SUPABASE_URL,
        tables: summary
    }, null, 2), 'utf8');

    console.log(`=======================================================`);
    console.log(` BACKUP FINALIZADO EXITOSAMENTE`);
    console.log(` Manifiesto: ${summaryPath}`);
    console.log(`=======================================================`);
}

runFullBackup()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('[Backup] ❌ Fallo crítico:', err);
        process.exit(1);
    });
