import path from 'node:path';
import { openDatabase } from '../server/database.js';

if (!process.argv.includes('--confirm')) {
  console.error('Server zuerst beenden. Dies löscht ALLE Spielräume, Spitznamen und Ergebnisse.\nAusführen mit: npm run db:reset -- --confirm');
  process.exit(1);
}
const file = path.resolve(process.env.DB_PATH || './data/quiz.sqlite');
const db = openDatabase(file);
db.exec('BEGIN IMMEDIATE; DELETE FROM answers; DELETE FROM players; DELETE FROM rooms; COMMIT;');
db.close();
console.log(`Spielstände gelöscht: ${file}\nDie Fragenbibliothek und hochgeladene Bilder bleiben erhalten.`);
