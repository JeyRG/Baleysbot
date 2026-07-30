import { createProvider } from '@builderbot/bot'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'

const adapterProvider = createProvider(Provider);
console.log('sendMessage type:', typeof adapterProvider.sendMessage);
