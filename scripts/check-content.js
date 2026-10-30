import { loadDeck } from '../server/content.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const deck = loadDeck();
const provenance = JSON.parse(readFileSync(new URL('../content/provenance.json', import.meta.url), 'utf8'));
for (const asset of provenance.media) {
  const actual = createHash('sha256').update(readFileSync(new URL(`../content/${asset.asset}`, import.meta.url))).digest('hex');
  if (actual !== asset.sha256) throw new Error(`Prüfsumme stimmt nicht: ${asset.asset}`);
}
const counts = {};
for (const q of deck.questions) counts[q.type] = (counts[q.type] || 0) + 1;
console.log(`Inhalte gültig: ${deck.questions.length} Fragen · ${JSON.stringify(counts)} · Set ${deck.id}`);
if (deck.questions.some(q => !['photo', 'video'].includes(q.type))) throw new Error('Das Quiz darf nur Bilder und Videos enthalten.');
if (deck.questions.filter(q => q.answer === 'ai').length !== deck.questions.filter(q => q.answer === 'human').length) throw new Error('Echte und KI-Beispiele müssen ausgewogen sein.');
