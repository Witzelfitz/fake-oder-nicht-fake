import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fingerprintDeck, resolveAsset, validateQuestion } from './content.js';

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
    questions: entries().filter(q => q.enabled).map(({ enabled, position, version, ...q }) => q) });
  return { entries, deck };
}

function cleanQuestion(body, id) {
  const text = (key, fallback = '') => typeof body[key] === 'string' ? body[key].trim() : fallback;
  const q = {
    id, type: body.type, title: text('title'), answer: body.answer,
    explanation: text('explanation'), takeaway: text('takeaway', 'Quelle und Kontext prüfen.') || 'Quelle und Kontext prüfen.',
    source: text('source') || '/sources.html#eigene-inhalte', credit: text('credit') || 'Eigenes Material der Moderation',
    license: text('license') || 'Nutzungsangaben bei der Moderation erfragen.'
  };
  if (q.type === 'text') q.text = text('text');
  else q.asset = text('asset');
  return q;
}

function imageExtension(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return 'png';
  if (bytes.length > 16 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.length > 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function installQuestionAdmin(app, { db, bank, uploadRoot, authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.get('/questions', (_req, res) => res.json({ questions: bank.entries() }));
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
  router.post('/media', express.raw({ type: () => true, limit: '12mb' }), (req, res) => {
    const ext = imageExtension(req.body);
    if (!ext) return res.status(400).json({ error: 'Bitte ein PNG-, JPEG- oder WebP-Bild hochladen.' });
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
