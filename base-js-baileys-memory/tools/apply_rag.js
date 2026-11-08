import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

async function run() {
    const sqlPath = path.resolve('migrations/rag_2_0.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    const projectRef = 'lwuoshrkrdwjuwvqdcwd';
    const token = process.env.SUPABASE_ACCESS_TOKEN;

    if (!token) {
        throw new Error('SUPABASE_ACCESS_TOKEN no encontrado en .env');
    }

    console.log(`Aplicando migración RAG 2.0 a Supabase (${projectRef})...`);
    const res = await axios.post(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        { query: sql },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    console.log('✅ Migración aplicada exitosamente:', res.data);
}

run().catch(err => {
    console.error('❌ Error aplicando migración:', err.response?.data || err.message);
    process.exit(1);
});
