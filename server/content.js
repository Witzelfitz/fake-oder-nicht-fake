import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const contentRoot = path.join(projectRoot, 'content');

export function loadDeck(file = path.join(contentRoot, 'questions.json')) {
  const deck = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(deck.questions) || deck.questions.length < 2) throw new Error('Mindestens zwei Fragen nötig.');
  const ids = new Set();
  for (const q of deck.questions) {
    if (!q.id || ids.has(q.id)) throw new Error('Frage-ID fehlt oder ist doppelt.');
    ids.add(q.id);
    if (!['photo', 'text', 'poster'].includes(q.type)) throw new Error(`Ungültiger Typ: ${q.id}`);
    if (!['ai', 'human'].includes(q.answer)) throw new Error(`Ungültige Lösung: ${q.id}`);
    for (const field of ['title', 'explanation', 'takeaway', 'source', 'credit', 'license']) {
      if (typeof q[field] !== 'string' || !q[field].trim()) throw new Error(`${q.id}: ${field} fehlt.`);
    }
    if (q.type === 'text' && !q.text) throw new Error(`${q.id}: Text fehlt.`);
    if (q.type !== 'text') {
      const absolute = path.resolve(contentRoot, q.asset ?? '');
      if (!absolute.startsWith(contentRoot + path.sep) || !existsSync(absolute)) throw new Error(`${q.id}: Bild fehlt oder liegt ausserhalb von content/.`);
    }
    if (!/^https:\/\//.test(q.source) && q.source !== '/sources.html#ki-beispiele') throw new Error(`${q.id}: HTTPS-Quellenlink oder lokale Herkunftsseite nötig.`);
  }
  const id = createHash('sha256').update(JSON.stringify(deck)).digest('hex').slice(0, 16);
  return { ...deck, id };
}

export function publicQuestion(q, roomId, index) {
  if (!q) return null;
  return {
    id: q.id, type: q.type, title: q.title,
    text: q.type === 'text' ? q.text : null,
    image: q.type !== 'text' ? `/media/${roomId}/${index}` : null,
    alt: q.type === 'poster' ? 'Werbeplakat für die Quizfrage' : 'Fotomotiv für die Quizfrage'
  };
}
