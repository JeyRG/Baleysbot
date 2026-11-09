import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

// Soporte universal para WebSocket en Node.js < 22 y Node.js >= 22
if (!globalThis.WebSocket) {
    globalThis.WebSocket = WebSocket
}

const realtimeOptions = {
    realtime: {
        transport: WebSocket
    }
}

// Cliente para Memoria Semántica (El original)
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Supabase] Faltan credenciales en el archivo .env para la memoria')
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, realtimeOptions)

// Cliente para Datos (Programas, Inscripciones, etc.)
const supabaseDataUrl = process.env.SUPABASE_DATA_URL
const supabaseDataKey = process.env.SUPABASE_DATA_KEY

if (!supabaseDataUrl || !supabaseDataKey) {
    console.error('[Supabase] Faltan credenciales SUPABASE_DATA_URL o SUPABASE_DATA_KEY en el archivo .env')
}

export const supabaseData = createClient(supabaseDataUrl, supabaseDataKey, realtimeOptions)
