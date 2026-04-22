<?php
/**
 * Bot Dashboard - Configuración General
 */

// Supabase Configuration
define('SUPABASE_URL', getenv('SUPABASE_URL') ?: 'TU_URL_AQUI');
define('SUPABASE_KEY', getenv('SUPABASE_KEY') ?: 'TU_CLAVE_AQUI'); // Usar variable de entorno

// Site Settings
define('SITE_NAME', 'Bot2703 Premium Dashboard');
define('SITE_THEME', 'dark');

// Display Settings
define('MAX_RECENT_MESSAGES', 10);
?>
