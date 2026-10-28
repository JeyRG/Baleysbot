import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

async function clearCache() {
    console.log('Limpiando semantic_cache...')
    const { error } = await supabase.from('semantic_cache').delete().filter('id', 'not.is', null)
    if (error) console.error('Error:', error)
    else console.log('Caché limpiado con éxito.')
}

clearCache()
