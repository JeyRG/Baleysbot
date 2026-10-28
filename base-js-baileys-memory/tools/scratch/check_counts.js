import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

async function check() {
    const { count: convs } = await supabase.from('conversations').select('*', { count: 'exact', head: true })
    const { count: msgs } = await supabase.from('messages').select('*', { count: 'exact', head: true })
    const { count: students } = await supabase.from('students').select('*', { count: 'exact', head: true })

    console.log({
        conversations: convs,
        messages: msgs,
        students: students
    })
}

check()
