import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

async function testInsert() {
    console.log('Testing insert into messages...')
    const { data: msg, error: msgErr } = await supabase.from('messages').insert({
        wa_id: '123456789@s.whatsapp.net',
        text: 'Test message ' + new Date().toISOString(),
        sender_type: 'user'
    }).select().single()

    if (msgErr) {
        console.error('Error inserting message:', msgErr)
        return
    }

    console.log('Message inserted:', msg)

    const { data: conv, error: convErr } = await supabase.from('conversations').select('*').eq('wa_id', '123456789@s.whatsapp.net').single()
    if (convErr) {
        console.error('Error finding conversation:', convErr)
    } else {
        console.log('Conversation linked successfully:', conv)
    }
}

testInsert()
