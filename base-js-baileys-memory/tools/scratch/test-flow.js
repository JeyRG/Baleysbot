import 'dotenv/config';
import { createBot, createProvider, createFlow, addKeyword, MemoryDB } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';

const flowExpedienteProcesar = addKeyword('_event_action__').addAction(async (ctx, { flowDynamic }) => {
    await flowDynamic('Consultando...');
});

const flowExpediente = addKeyword(['\\b\\d{8}\\b'], { regex: true })
    .addAction(async (ctx, { state, gotoFlow }) => {
        const match = ctx.body.match(/\b\d{8}\b/);
        if (match) {
            await state.update({ dni: match[0] });
            return gotoFlow(flowExpedienteProcesar);
        }
    });

const welcomeFlow = addKeyword(['hola']).addAnswer('Hola mundo');

const main = async () => {
    const adapterFlow = createFlow([flowExpediente, flowExpedienteProcesar, welcomeFlow]);
    const adapterProvider = createProvider(BaileysProvider);
    const adapterDB = new MemoryDB();

    const bot = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });
    
    // Simulate incoming message
    setTimeout(() => {
        console.log('Sending mock message...');
        adapterProvider.emit('message', {
            from: '51927953033',
            body: 'hola, quierosaber mi estado de carpeta',
            name: 'Jeyson'
        });
    }, 2000);
};
main();
