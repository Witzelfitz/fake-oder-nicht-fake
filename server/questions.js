import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fingerprintDeck, resolveAsset, validateQuestion } from './content.js';
import { curatedPack, previewImport, applyImport } from './imports.js';
import { readSettings, writeSettings } from './settings.js';

export function questionBank(db, initialDeck) {
  if (!db.prepare("SELECT value FROM quiz_meta WHERE key = 'bank_seeded'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      initialDeck.questions.forEach((q, i) => db.prepare('INSERT INTO question_bank (id, question_json, position) VALUES (?, ?, ?)').run(q.id, JSON.stringify(q), i));
      db.prepare("INSERT INTO quiz_meta (key, value) VALUES ('bank_seeded', '1')").run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const entries = () => db.prepare('SELECT * FROM question_bank ORDER BY position, id').all()
    .map(row => ({ ...JSON.parse(row.question_json), enabled: Boolean(row.enabled), position: row.position, version: row.version }));
  const deck = () => fingerprintDeck({ title: initialDeck.title, version: 1,
    questions: entries().filter(q => q.enabled && q.schemaVersion !== 3).map(({ enabled, position, version, ...q }) => q) });
  const learningDeck = (ids = null) => {
    if (ids && (!Array.isArray(ids) || ids.length > 200 || new Set(ids).size !== ids.length)) throw new Error('Ungültige Fallauswahl.');
    let cases = entries().filter(q => q.enabled && q.schemaVersion === 3 && q.status === 'published');
    if (ids) cases = ids.map(id => cases.find(q => q.id === id)).map(q => { if (!q) throw new Error('Ein ausgewählter Fall fehlt oder ist nicht freigegeben.'); return q; });
    return fingerprintDeck({ title: 'Fake oder nicht fake? · Der zweite Blick', version: 3,
      questions: cases.map(({ enabled, position, version, ...q }) => ({ ...q, revision: version })) });
  };
  return { entries, deck, learningDeck };
}

function cleanQuestion(body, id) {
  const text = (key, fallback = '') => typeof body[key] === 'string' ? body[key].trim() : fallback;
  const q = {
    id, type: body.type, title: text('title'), answer: body.answer,
    explanation: body.explanation === undefined ? (body.answer === 'ai' ? 'Mit KI erzeugt.' : 'Echt aufgenommen.') : text('explanation'),
    takeaway: text('takeaway') || 'Was hat euch überzeugt – und was hat euch getäuscht?',
    source: text('source') || '/sources.html#eigene-inhalte', credit: text('credit') || 'Eigenes Material der Moderation',
    license: text('license') || 'Nutzungsangaben bei der Moderation erfragen.'
  };
  if (q.type === 'text') q.text = text('text');
  else q.asset = text('asset');
  if (body.schemaVersion === 3) Object.assign(q, {
    schemaVersion: 3, axis: body.axis, prompt: text('prompt'), status: body.status || 'draft',
    alt: text('alt'), caption: text('caption'), simulation: body.simulation === true,
    limitation: text('limitation'), transfer: text('transfer'), privateNotes: text('privateNotes'),
    sources: Array.isArray(body.sources) ? body.sources : [],
    review: body.review && typeof body.review === 'object' ? body.review : null
  });
  return q;
}

function imageExtension(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return 'png';
  if (bytes.length > 16 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.length > 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length > 24 && bytes.toString('ascii', 4, 8) === 'ftyp' && /^(isom|iso[2-9]|mp4[12]|avc1)/.test(bytes.toString('ascii', 8, 12))) return 'mp4';
  return null;
}

export function installQuestionAdmin(app, { db, bank, uploadRoot, authenticate, legacy = false }) {
  const router = express.Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    if (!legacy && !/^\/(questions(?:\/|$)|media$|order$)/.test(req.path)) return res.sendStatus(404);
    if (!legacy && ['POST', 'PUT'].includes(req.method) && req.path.startsWith('/questions') && (!['photo', 'video'].includes(req.body?.type) || req.body?.schemaVersion === 3)) return res.status(400).json({ error: 'Bitte ein Bild oder Video wählen.' });
    next();
  });
  router.get('/questions', (_req, res) => res.json({ questions: bank.entries() }));
  router.get('/settings', (_req,res) => res.json(readSettings(db)));
  router.put('/settings', (req,res) => { try { res.json(writeSettings(db,req.body ?? {})); } catch (error) { res.status(400).json({error:error.message}); } });
  const profiles=()=>JSON.parse(db.prepare("SELECT value FROM quiz_meta WHERE key='event_profiles'").get()?.value||'[]');
  router.get('/profiles',(_req,res)=>res.json(profiles()));
  router.post('/profiles',(req,res)=>{
    const name=typeof req.body?.name==='string'?req.body.name.trim():'';
    if(!name||name.length>100)return res.status(400).json({error:'Bitte einen Profilnamen mit maximal 100 Zeichen angeben.'});
    const all=profiles();const old=all.find(p=>p.name===name);
    if(!old&&all.length>=20)return res.status(400).json({error:'Maximal 20 Anlassprofile.'});
    const profile={id:old?.id||randomBytes(8).toString('hex'),name,settings:readSettings(db)};
    const next=[...all.filter(p=>p.id!==profile.id),profile];db.prepare("INSERT INTO quiz_meta(key,value) VALUES('event_profiles',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));res.json(profile);
  });
  router.post('/profiles/:id/activate',(req,res)=>{const profile=profiles().find(p=>p.id===req.params.id);if(!profile)return res.status(404).json({error:'Anlassprofil nicht gefunden.'});res.json(writeSettings(db,profile.settings));});
  router.get('/import/preview', (_req,res) => res.json({ cases: previewImport(db), sets: curatedPack().sets }));
  router.post('/import/apply', (req,res) => {
    if (req.body?.confirm !== true) return res.status(400).json({error:'Import bitte ausdrücklich bestätigen. Bestehende Fassungen werden beibehalten.'});
    try { res.json(applyImport(db,uploadRoot)); } catch (error) { res.status(400).json({error:error.message}); }
  });
  router.post('/questions', (req, res) => {
    if (bank.entries().length >= 200) return res.status(400).json({ error: 'Maximal 200 Fragen pro Bibliothek.' });
    const q = cleanQuestion(req.body ?? {}, randomBytes(12).toString('hex'));
    try { validateQuestion(q, uploadRoot); } catch (error) { return res.status(400).json({ error: error.message }); }
    const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM question_bank').get().n;
    db.prepare('INSERT INTO question_bank (id, question_json, position, enabled) VALUES (?, ?, ?, ?)').run(q.id, JSON.stringify(q), position, req.body.enabled === false ? 0 : 1);
    res.status(201).json(bank.entries().find(entry => entry.id === q.id));
  });
  router.put('/questions/:id', (req, res) => {
    const old = db.prepare('SELECT * FROM question_bank WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Frage nicht gefunden.' });
    if (req.body?.version !== old.version) return res.status(409).json({ error: 'Die Frage wurde inzwischen geändert. Bitte die Liste neu laden.' });
    const q = cleanQuestion(req.body, req.params.id);
    try { validateQuestion(q, uploadRoot); } catch (error) { return res.status(400).json({ error: error.message }); }
    db.prepare('UPDATE question_bank SET question_json = ?, enabled = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(q), req.body.enabled === false ? 0 : 1, q.id);
    res.json(bank.entries().find(entry => entry.id === q.id));
  });
  router.delete('/questions/:id', (req, res) => {
    const old = db.prepare('SELECT * FROM question_bank WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Frage nicht gefunden.' });
    if (req.body?.version !== old.version) return res.status(409).json({ error: 'Die Frage wurde inzwischen geändert. Bitte die Liste neu laden.' });
    db.prepare('DELETE FROM question_bank WHERE id = ?').run(req.params.id);
    // Keep media: existing room snapshots may still refer to the old image.
    res.json({ ok: true });
  });
  router.post('/order', (req, res) => {
    const ids = req.body?.ids;
    const existing = bank.entries().map(q => q.id);
    if (!Array.isArray(ids) || ids.length !== existing.length || new Set(ids).size !== existing.length || ids.some(id => !existing.includes(id))) return res.status(400).json({ error: 'Die Liste hat sich geändert. Bitte neu laden.' });
    db.exec('BEGIN IMMEDIATE');
    try { ids.forEach((id, index) => db.prepare('UPDATE question_bank SET position = ? WHERE id = ?').run(index, id)); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ questions: bank.entries() });
  });
  router.post('/media', express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
    const ext = imageExtension(req.body);
    if (!ext) return res.status(400).json({ error: 'Bitte ein Bild (PNG, JPEG, WebP) oder ein MP4-Video hochladen.' });
    mkdirSync(uploadRoot, { recursive: true });
    const name = `${randomBytes(16).toString('hex')}.${ext}`;
    const asset = `upload:${name}`;
    writeFileSync(resolveAsset(asset, uploadRoot), req.body, { flag: 'wx' });
    res.status(201).json({ asset });
  });
  router.get('/questions/:id/media', (req, res) => {
    const entry = bank.entries().find(q => q.id === req.params.id);
    if (!entry || entry.type === 'text') return res.sendStatus(404);
    res.sendFile(resolveAsset(entry.asset, uploadRoot));
  });
  app.use('/api/admin', router);
}
