import { openDatabase } from '../server/database.js';
import { questionBank } from '../server/questions.js';
import { loadDeck } from '../server/content.js';
import { previewImport, applyImport } from '../server/imports.js';
import path from 'node:path';
const file = process.env.DB_PATH || './data/quiz.sqlite';
const db = openDatabase(file);
try {
  questionBank(db,loadDeck());
  for (const q of previewImport(db)) console.log(`${q.status.padEnd(16)} ${q.id} · ${q.title}`);
  if (process.argv.includes('--apply')) console.log(applyImport(db,path.join(path.dirname(path.resolve(file)),'uploads')));
  else console.log('\nVorschau. Mit --apply nur neue IDs ergänzen; lokale Fassungen bleiben erhalten.');
} finally { db.close(); }
