import { createQuizServer } from './app.js';
import { localAddresses } from './network.js';

const server = createQuizServer({ dbPath: process.env.DB_PATH, hostKey: process.env.HOST_KEY, publicUrl: process.env.PUBLIC_URL });
const port = Number(process.env.PORT || 3000);
await server.listen(port, process.env.HOST || '0.0.0.0');
console.log(`\nFAKE ODER NICHT FAKE? · Digimärt Alpnach · Stand 02\n\nLokal: http://localhost:${port}\nModeration: http://localhost:${port}/host\nFragen verwalten: http://localhost:${port}/admin\nModerationsschlüssel: ${server.hostKey}\n`);
for (const address of localAddresses(port)) console.log(`WLAN/LAN: ${address}`);
console.log('\nHandys und Laptop ins gleiche Netz. Erreichbare Adresse in der Moderation auswählen.\n');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (!stopping) { stopping = true; await server.close(); process.exit(0); } });
