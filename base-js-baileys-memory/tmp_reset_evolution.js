import axios from 'axios'
import 'dotenv/config'

const baseURL = process.env.EVOLUTION_URL || 'http://localhost:8080'
const apiKey = process.env.EVOLUTION_TOKEN || 'GlobalApiKeyParaLlamarALaApiDeEvolution'
const instanceName = process.env.EVOLUTION_INSTANCE || 'bot_inscripciones'

const resetInstance = async () => {
    try {
        console.log(`[Reset] Intentando borrar instancia: ${instanceName}...`)
        await axios.delete(`${baseURL}/instance/delete/${instanceName}`, {
            headers: { apikey: apiKey }
        })
        console.log(`[Reset] ✅ Instancia borrada.`)
    } catch (e) {
        // Ignorar
    }

    try {
        console.log(`[Reset] Recreando instancia: ${instanceName}...`)
        const resp = await axios.post(`${baseURL}/instance/create`, {
            instanceName: instanceName,
            token: apiKey,
            integration: "WHATSAPP-BAILEYS",
            qrcode: true
        }, {
            headers: { apikey: apiKey }
        })
        console.log(`[Reset] ✅ Instancia recreada correctamente.`)
        console.log(JSON.stringify(resp.data, null, 2))
    } catch (e) {
        console.error(`[Reset] ❌ Error al recrear instancia:`, e.response?.data || e.message)
    }
}

resetInstance()
