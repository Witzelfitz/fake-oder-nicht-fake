import { loadDeck } from '../server/content.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { curatedPack } from '../server/imports.js';
import { validateQuestion } from '../server/content.js';
const deck = loadDeck();
const provenance = JSON.parse(readFileSync(new URL('../content/provenance.json', import.meta.url), 'utf8'));
for (const asset of provenance.images) {
  const actual = createHash('sha256').update(readFileSync(new URL(`../content/${asset.asset}`, import.meta.url))).digest('hex');
  if (actual !== asset.sha256) throw new Error(`Prüfsumme stimmt nicht: ${asset.asset}`);
}
const counts = {};
for (const q of deck.questions) counts[q.type] = (counts[q.type] || 0) + 1;
console.log(`Inhalte gültig: ${deck.questions.length} Fragen · ${JSON.stringify(counts)} · Set ${deck.id}`);
const pack=curatedPack();
if(new Set(pack.cases.map(q=>q.id)).size!==pack.cases.length)throw new Error('Doppelte Lernfall-ID.');
for(const q of pack.cases)validateQuestion(q);
for(const set of pack.sets)if(set.caseIds.some(id=>!pack.cases.some(q=>q.id===id)))throw new Error(`Fallset ${set.id} ist unvollständig.`);
console.log(`Lernpaket gültig: ${pack.cases.length} Fälle · ${pack.sets.length} Sets. Import erfolgt nur ausdrücklich.`);
