import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Supabase] Faltan credenciales en el archivo .env')
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey)
