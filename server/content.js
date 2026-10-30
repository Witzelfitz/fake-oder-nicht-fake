import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const contentRoot = path.join(projectRoot, 'content');

export function resolveAsset(asset, uploadRoot) {
  if (typeof asset !== 'string') throw new Error('Bild fehlt.');
  if (asset.startsWith('upload:')) {
    const name = asset.slice(7);
    if (!uploadRoot || !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(name)) throw new Error('Ungültiger Bildverweis.');
    return path.join(uploadRoot, name);
  }
  const absolute = path.resolve(contentRoot, asset);
  if (!absolute.startsWith(contentRoot + path.sep)) throw new Error('Ungültiger Bildpfad.');
  return absolute;
}

export function validateQuestion(q, uploadRoot) {
  if (!['photo', 'text', 'poster'].includes(q.type)) throw new Error('Ungültiger Fragetyp.');
  if (!['ai', 'human'].includes(q.answer)) throw new Error('Bitte die richtige Herkunft auswählen.');
  const limits = { title: 160, explanation: 4000, takeaway: 1500, source: 1500, credit: 1000, license: 1000 };
  for (const [field, max] of Object.entries(limits)) {
    if (typeof q[field] !== 'string' || !q[field].trim() || q[field].length > max) throw new Error(`Feld ${field} fehlt oder ist zu lang (max. ${max} Zeichen).`);
  }
  if (q.type === 'text' && (typeof q.text !== 'string' || !q.text.trim() || q.text.length > 10000)) throw new Error('Text fehlt oder ist zu lang (max. 10’000 Zeichen).');
  if (q.type !== 'text' && !existsSync(resolveAsset(q.asset, uploadRoot))) throw new Error('Bitte ein vorhandenes Bild auswählen oder hochladen.');
  let sourceValid = /^\/sources\.html#[a-z-]+$/.test(q.source);
  try { const url = new URL(q.source); sourceValid ||= url.protocol === 'https:' && !url.username && !url.password; } catch { /* local sources are allowed above */ }
  if (!sourceValid) throw new Error('Die Quelle muss ein HTTPS-Link sein.');
}

export function fingerprintDeck(deck) {
  const { id: _id, ...body } = deck;
  return { ...body, id: createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16) };
}

export function loadDeck(file = path.join(contentRoot, 'questions.json')) {
  const deck = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(deck.questions) || deck.questions.length < 2) throw new Error('Mindestens zwei Fragen nötig.');
  const ids = new Set();
  for (const q of deck.questions) {
    if (!q.id || ids.has(q.id)) throw new Error('Frage-ID fehlt oder ist doppelt.');
    ids.add(q.id);
    validateQuestion(q);
  }
  return fingerprintDeck(deck);
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
