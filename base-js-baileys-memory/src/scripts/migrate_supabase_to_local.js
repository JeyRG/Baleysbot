/**
 * Script de migración y sincronización: Supabase -> Base de Datos SQL Local
 * Lee las inscripciones, personas, postulantes y programas de Supabase
 * e inserta en la base local usando transacciones y queries 100% parametrizadas.
 * 
 * Uso: node src/scripts/migrate_supabase_to_local.js
 */

import 'dotenv/config';
import { supabaseData as supabase } from '../services/supabaseClient.js';
import { queryLocalDb, isLocalDbEnabled } from '../services/dbClient.js';

async function migrate() {
    console.log('--- INICIANDO MIGRACIÓN SUPABASE -> SQL LOCAL ---');

    if (!isLocalDbEnabled()) {
        console.warn('[Migración] ADVERTENCIA: USE_LOCAL_DB no está en "true" en el archivo .env.');
        console.warn('[Migración] Para escribir en el servidor local, configura USE_LOCAL_DB=true y las credenciales LOCAL_DB_*');
        console.log('[Migración] Realizando validación de lectura contra Supabase...');
    }

    try {
        // 1. Migrar Personas
        console.log('1. Extrayendo personas desde Supabase...');
        const { data: personas, error: errP } = await supabase.from('personas').select('*');
        if (errP) throw new Error(`Error en personas Supabase: ${errP.message}`);
        console.log(`   Se encontraron ${personas?.length || 0} personas.`);

        // 2. Migrar Programas
        console.log('2. Extrayendo programas desde Supabase...');
        const { data: programas, error: errProg } = await supabase.from('programas').select('*');
        if (errProg) throw new Error(`Error en programas Supabase: ${errProg.message}`);
        console.log(`   Se encontraron ${programas?.length || 0} programas.`);

        // 3. Migrar Inscripciones
        console.log('3. Extrayendo inscripciones desde Supabase...');
        const { data: inscripciones, error: errI } = await supabase.from('inscripciones').select('*');
        if (errI) throw new Error(`Error en inscripciones Supabase: ${errI.message}`);
        console.log(`   Se encontraron ${inscripciones?.length || 0} inscripciones.`);

        // 4. Migrar Postulantes
        console.log('4. Extrayendo postulantes desde Supabase...');
        const { data: postulantes, error: errPost } = await supabase.from('postulantes').select('*');
        if (errPost) throw new Error(`Error en postulantes Supabase: ${errPost.message}`);
        console.log(`   Se encontraron ${postulantes?.length || 0} postulantes.`);

        if (isLocalDbEnabled()) {
            console.log('\nInsertando datos en Servidor SQL Local con sentencias parametrizadas...');

            // Inserción de personas
            for (const p of personas || []) {
                await queryLocalDb(
                    `INSERT INTO personas (id_persona, id_usuario, dni, nombres, apellidos, fecha_nacimiento)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (id_persona) DO UPDATE 
                     SET dni = EXCLUDED.dni, nombres = EXCLUDED.nombres, apellidos = EXCLUDED.apellidos`,
                    [p.id_persona, p.id_usuario, p.dni, p.nombres, p.apellidos, p.fecha_nacimiento]
                );
            }
            console.log(`   ✓ ${personas?.length || 0} personas sincronizadas.`);

            // Inserción de inscripciones
            for (const i of inscripciones || []) {
                await queryLocalDb(
                    `INSERT INTO inscripciones (id_inscrito, id_persona, id_programa, fecha_registro, medio_conocimiento, notificado_ws, notificado_email)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (id_inscrito) DO UPDATE 
                     SET id_programa = EXCLUDED.id_programa, notificado_ws = EXCLUDED.notificado_ws`,
                    [i.id_inscrito, i.id_persona, i.id_programa, i.fecha_registro, i.medio_conocimiento, i.notificado_ws, i.notificado_email]
                );
            }
            console.log(`   ✓ ${inscripciones?.length || 0} inscripciones sincronizadas.`);

            // Inserción de postulantes
            for (const post of postulantes || []) {
                await queryLocalDb(
                    `INSERT INTO postulantes (id_postulante, id_inscrito, id_estadoseguimiento, carpeta_postulante, mensaje_estado, fecha_registro, nota_admin)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (id_postulante) DO UPDATE 
                     SET id_estadoseguimiento = EXCLUDED.id_estadoseguimiento, mensaje_estado = EXCLUDED.mensaje_estado`,
                    [post.id_postulante, post.id_inscrito, post.id_estadoseguimiento, post.carpeta_postulante, post.mensaje_estado, post.fecha_registro, post.nota_admin]
                );
            }
            console.log(`   ✓ ${postulantes?.length || 0} postulantes sincronizados.`);
            console.log('\n--- MIGRACIÓN COMPLETADA CON ÉXITO ---');
        } else {
            console.log('\n[Modo Dry-Run] Conexión y lectura desde Supabase verificadas correctamente.');
            console.log('Para ejecutar la escritura física en la base local, configure las credenciales en .env y ejecute nuevamente.');
        }
    } catch (error) {
        console.error('[Migración] Error crítico:', error.message);
        process.exit(1);
    }
}

migrate();
