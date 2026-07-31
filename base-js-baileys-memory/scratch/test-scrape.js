process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
async function test() {
    try {
        const res = await fetch('https://posgradounac.edu.pe/programas/programa-detalle.php?id=4');
        const html = await res.text();
        let brochureUrl = null;
        const matches = html.split('<a ');
        for (const m of matches) {
            if (m.includes('Descargar Brochure')) {
                const hrefMatch = m.match(/href="([^"]+)"/);
                if (hrefMatch) {
                    brochureUrl = hrefMatch[1];
                    break;
                }
            }
        }
        if (brochureUrl && !brochureUrl.startsWith('http')) {
            brochureUrl = brochureUrl.replace('../', '');
            if (!brochureUrl.startsWith('/')) brochureUrl = '/' + brochureUrl;
            brochureUrl = 'https://posgradounac.edu.pe' + brochureUrl;
        }
        console.log("FINAL URL:", brochureUrl);
    } catch (e) {
        console.error(e);
    }
}
test();
