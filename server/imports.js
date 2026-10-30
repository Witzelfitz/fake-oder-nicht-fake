import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contentRoot, validateQuestion } from './content.js';
import { createHash } from 'node:crypto';

export function curatedPack() { return JSON.parse(readFileSync(path.join(contentRoot, 'case-pack.json'), 'utf8')); }
const digest = q => createHash('sha256').update(JSON.stringify(q)).digest('hex');
export function previewImport(db, pack = curatedPack()) {
  return pack.cases.map(q => {
    const old = db.prepare('SELECT question_json,version FROM question_bank WHERE id=?').get(q.id);
    return { id: q.id, title: q.title, status: !old ? 'new' : digest(JSON.parse(old.question_json)) === digest(q) ? 'unchanged' : 'local-different', revision: old?.version ?? null };
  });
}
export function applyImport(db, uploadRoot, pack = curatedPack(), selectedIds = null) {
  const preview = previewImport(db, pack);
  const added = [];
  const questions = pack.cases.filter(q => (!selectedIds || selectedIds.includes(q.id)) && preview.find(p => p.id === q.id)?.status === 'new');
  for (const q of questions) validateQuestion(q, uploadRoot);
  db.exec('BEGIN IMMEDIATE');
  try {
    let position = db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM question_bank').get().n;
    for (const q of questions) {
      db.prepare('INSERT INTO question_bank (id,question_json,enabled,position) VALUES (?,?,1,?)').run(q.id, JSON.stringify(q), position++);
      added.push(q.id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { added, preserved: preview.filter(p => p.status !== 'new').map(p => p.id) };
}
