import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

if (!process.argv.includes('--confirm')) {
  console.error('Server zuerst beenden. Dies löscht ALLE Spielräume, Spitznamen und Ergebnisse.\nAusführen mit: npm run db:reset -- --confirm');
  process.exit(1);
}
const file = path.resolve(process.env.DB_PATH || './data/quiz.sqlite');
for (const name of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(name)) rmSync(name);
console.log(`Quiz-Daten gelöscht: ${file}`);
