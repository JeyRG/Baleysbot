import axios from 'axios'
import 'dotenv/config'

const baseURL = process.env.EVOLUTION_URL || 'http://localhost:8080'
const apiKey = process.env.EVOLUTION_TOKEN || 'GlobalApiKeyParaLlamarALaApiDeEvolution'

const checkInstances = async () => {
    try {
        const resp = await axios.get(`${baseURL}/instance/fetchInstances`, {
            headers: { apikey: apiKey }
        })
        console.log(JSON.stringify(resp.data, null, 2))
    } catch (e) {
        console.error(`[Check] ❌ Error:`, e.response?.data || e.message)
    }
}

checkInstances()
