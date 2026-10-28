// Crea (o actualiza) el usuario SUPERADMIN inicial.
// Uso:  node src/scripts/createSuperadmin.js <usuario> <contraseña> ["Nombre"]
// Requiere que la migración migrations/admin_accounts.sql ya esté aplicada en Supabase.

import 'dotenv/config';
import { supabase } from '../services/supabaseClient.js';
import { hashPassword } from '../services/adminAuth.js';

const [username, password, fullName] = process.argv.slice(2);

if (!username || !password) {
    console.error('Uso: node src/scripts/createSuperadmin.js <usuario> <contraseña> ["Nombre completo"]');
    process.exit(1);
}
if (String(password).length < 6) {
    console.error('La contraseña debe tener al menos 6 caracteres.');
    process.exit(1);
}

async function main() {
    const password_hash = hashPassword(password);

    const { data, error } = await supabase
        .from('admin_users')
        .upsert(
            { username, password_hash, full_name: fullName || 'Super Admin', role: 'superadmin', active: true },
            { onConflict: 'username' }
        )
        .select('id, username, role, active')
        .single();

    if (error) {
        console.error('Error creando el superadmin:', error.message);
        console.error('¿Aplicaste la migración migrations/admin_accounts.sql en Supabase?');
        process.exit(1);
    }

    console.log('Superadmin listo:', data);
    console.log(`Ya puedes iniciar sesión en el panel con usuario "${username}".`);
    process.exit(0);
}

main();
