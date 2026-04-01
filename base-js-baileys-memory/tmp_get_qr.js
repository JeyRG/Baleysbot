import axios from 'axios'
import 'dotenv/config'

const baseURL = process.env.EVOLUTION_URL || 'http://localhost:8080'
const apiKey = process.env.EVOLUTION_TOKEN || 'GlobalApiKeyParaLlamarALaApiDeEvolution'
const instanceName = process.env.EVOLUTION_INSTANCE || 'bot_inscripciones'

const getQR = async () => {
    try {
        const resp = await axios.get(`${baseURL}/instance/connect/${instanceName}`, {
            headers: { apikey: apiKey }
        })
        if (resp.data.base64) {
             console.log("✅ QR Code (Base64) Found!")
             // No imprimimos todo el base64 para no saturar
             console.log(resp.data.base64.substring(0, 100) + "...")
        } else {
             console.log("❌ No QR found in connect response.")
             console.log(JSON.stringify(resp.data, null, 2))
        }
    } catch (e) {
        console.error(`[QR] ❌ Error:`, e.response?.data || e.message)
    }
}

getQR()
