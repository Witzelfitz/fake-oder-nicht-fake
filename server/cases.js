export const MODES = ['learning-v1', 'workshop-v1', 'speed-streak-v2'];
export const AXES = {
  origin: [{ id: 'ai', label: 'Mit generativer KI' }, { id: 'human', label: 'Ohne generative KI' }, { id: 'insufficient', label: 'Mit diesen Infos nicht sicher' }],
  claim: [{ id: 'supported', label: 'Belegt' }, { id: 'refuted', label: 'Widerlegt' }, { id: 'open', label: 'Noch offen' }],
  context: [{ id: 'fits', label: 'Kontext passt' }, { id: 'misleading', label: 'Irreführender Kontext' }, { id: 'open', label: 'Noch offen' }]
};
export function validateCase(q, publishing = false) {
  const releasing=publishing||q.status==='published';
  if (q.schemaVersion !== 3 || !AXES[q.axis]) throw new Error('Fall braucht Schema 3 und eine gültige Frageart.');
  if (typeof q.prompt !== 'string' || !q.prompt.trim() || q.prompt.length > 1500) throw new Error('Eine konkrete Leitfrage fehlt oder ist zu lang.');
  if (!AXES[q.axis].some(x => x.id === q.answer)) throw new Error('Das Urteil passt nicht zur Frageart.');
  if (!['draft', 'published'].includes(q.status)) throw new Error('Status muss Entwurf oder freigegeben sein.');
  for (const [field, max] of Object.entries({ limitation: 2000, transfer: 1500, privateNotes: 4000 })) {
    if (q[field] !== undefined && (typeof q[field] !== 'string' || q[field].length > max)) throw new Error(`Ungültiges Feld ${field}.`);
  }
  if (!Array.isArray(q.sources) || q.sources.length > 5) throw new Error('Maximal fünf Quellenkarten pro Fall.');
  for (const source of q.sources) {
    for (const field of ['id', 'title', 'publisher', 'locator', 'supports', 'limitation', 'rights']) {
      if (typeof source[field] !== 'string' || (releasing&&!source[field].trim()) || source[field].length > 4000) throw new Error(`Quellenkarte: ${field} fehlt oder ist zu lang.`);
    }
    if (source.url) {
      let valid = false;
      try { const u = new URL(source.url); valid = u.protocol === 'https:' && !u.username && !u.password; } catch { /* invalid URL */ }
      if (!valid) throw new Error('Quellenkarte benötigt einen HTTPS-Link.');
    }
    if ((releasing||source.reviewedAt)&&!/^\d{4}-\d{2}-\d{2}$/.test(source.reviewedAt || '')) throw new Error('Prüfdatum der Quelle fehlt.');
    if (source.publishedAt && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(source.publishedAt)) throw new Error('Publikationsdatum der Quelle ist ungültig.');
  }
  if (releasing) {
    if (!q.sources.length || !q.limitation?.trim() || !q.transfer?.trim()) throw new Error('Freigabe braucht Quellenkarte, Grenze und Transferfrage.');
    if (q.review?.sources!==true || q.review?.rights!==true || q.review?.didactics!==true || !/^\d{4}-\d{2}-\d{2}$/.test(q.review?.reviewedAt||'') || typeof q.review?.reviewedBy!=='string' || !q.review.reviewedBy.trim()) throw new Error('Quellen, Rechte und Didaktik müssen ausdrücklich geprüft und dokumentiert sein.');
  }
}
export function publicCase(q, room, index) {
  return {
    id: q.id, revision: q.revision || q.version || 1, type: q.type, title: q.title,
    text: q.type === 'text' ? q.text : null, image: q.type !== 'text' ? `/media/${room}/${index}` : null,
    alt: q.alt || 'Fallmaterial zur gemeinsamen Prüfung', caption: q.caption || '',
    axis: q.axis, prompt: q.prompt, promptId: 'main', options: AXES[q.axis],
    simulation: q.simulation === true, simulationLabel: q.simulation === true ? 'Unterrichtssimulation · fiktives Beispiel' : null
  };
}
export function sourceCards(q) {
  return q.sources.map(s => ({ id: s.id, title: s.title, publisher: s.publisher, url: s.url || null,
    publishedAt: s.publishedAt || null, reviewedAt: s.reviewedAt, locator: s.locator,
    supports: s.supports, limitation: s.limitation, rights: s.rights }));
}
export function labelFor(q, choice) { return AXES[q.axis]?.find(x => x.id === choice)?.label || choice; }
