import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { io } from 'socket.io-client';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createQuizServer } from '../server/app.js';
import { projectRoot } from '../server/content.js';

const key = 'admin-test-key';
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const send = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, payload, (err, result) => err ? reject(err) : resolve(result)));
async function setup(t) {
  const folder = mkdtempSync(path.join(tmpdir(), 'fake-admin-test-'));
  const dbPath = path.join(folder, 'quiz.sqlite');
  const servers = [], sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    for (const s of servers) if (!s.stopped) await s.close();
    if (path.dirname(folder) === path.resolve(tmpdir()) && path.basename(folder).startsWith('fake-admin-test-')) rmSync(folder, { recursive: true, force: true });
  });
  async function start() {
    const server = createQuizServer({ dbPath, hostKey: key }); servers.push(server);
    await server.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${server.http.address().port}`;
    const api = async (route, method = 'GET', body) => fetch(`${base}/api/admin${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const room = async () => (await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostKey: key, duration: 15 }) })).json();
    const socket = async () => { const s = io(base, { transports: ['websocket'], reconnection: false }); sockets.push(s); await once(s, 'connect'); return s; };
    return { server, base, api, room, socket, stop: async () => { for (const s of sockets) s.disconnect(); await server.close(); server.stopped = true; } };
  }
  return { folder, dbPath, start };
}
const own = { type: 'text', title: 'Eigener Text', text: 'Eine eigene Geschichte.', answer: 'human', explanation: 'Von mir für den Stand verfasst.', enabled: true };

test('Fragenverwaltung schützt sämtliche Schreib- und Lesezugriffe und validiert Inhalte', async t => {
  const f = await (await setup(t)).start();
  for (const [route, method] of [['/questions', 'GET'], ['/questions', 'POST'], ['/media', 'POST'], ['/order', 'POST']]) {
    assert.equal((await fetch(`${f.base}/api/admin${route}`, { method })).status, 401);
  }
  const list = await (await f.api('/questions')).json(); assert.equal(list.questions.length, 8);
  assert.equal((await f.api('/questions', 'POST', { ...own, source: 'javascript:alert(1)' })).status, 400);
  assert.equal((await f.api('/questions', 'POST', { ...own, explanation: '' })).status, 400);
  assert.equal((await f.api('/questions', 'POST', { ...own, type: 'photo', asset: '../.env' })).status, 400);
  const response = await f.api('/questions', 'POST', own); assert.equal(response.status, 201);
  const q = await response.json(); assert.equal(q.version, 1);
  const update = await f.api(`/questions/${q.id}`, 'PUT', { ...q, text: 'Aktualisierte Geschichte.', enabled: false });
  assert.equal(update.status, 200); const changed = await update.json(); assert.equal(changed.version, 2);
  assert.equal((await f.api(`/questions/${q.id}`, 'PUT', q)).status, 409);
  assert.equal((await f.api(`/questions/${q.id}`, 'DELETE', { version: 1 })).status, 409);
  assert.equal((await f.api(`/questions/${q.id}`, 'DELETE', { version: 2 })).status, 200);
});

test('Bilder hochladen, Reihenfolge ändern und Löschen beeinflusst bestehende Runden nicht', async t => {
  const env = await setup(t), f = await env.start();
  const bytes = readFileSync(path.join(projectRoot, 'content/assets/mountain.jpg'));
  const upload = await fetch(`${f.base}/api/admin/media`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'image/jpeg' }, body: bytes });
  assert.equal(upload.status, 201); const { asset } = await upload.json();
  assert.match(asset, /^upload:[a-f0-9]{32}\.jpg$/);
  const bad = await fetch(`${f.base}/api/admin/media`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'image/png' }, body: '<svg onload="alert(1)" />' });
  assert.equal(bad.status, 400);
  const q = await (await f.api('/questions', 'POST', { ...own, type: 'photo', asset })).json();
  const entries = (await (await f.api('/questions')).json()).questions;
  assert.equal((await f.api('/order', 'POST', { ids: [q.id, ...entries.filter(e => e.id !== q.id).map(e => e.id)] })).status, 200);
  const oldRoom = await f.room();
  const host = await f.socket(); await send(host, 'watch', { room: oldRoom.room, hostToken: oldRoom.hostToken });
  const player = await f.socket(); await send(player, 'join', { room: oldRoom.room, nickname: 'Testgast' });
  await send(host, 'host:action', { action: 'start' });
  assert.equal((await fetch(`${f.base}/media/${oldRoom.room}/0`)).status, 200);
  assert.equal((await fetch(`${f.base}/media/${oldRoom.room}/1`)).status, 404);
  await f.api(`/questions/${q.id}`, 'DELETE', { version: q.version });
  assert.equal((await fetch(`${f.base}/media/${oldRoom.room}/0`)).status, 200);
  const stored = JSON.parse(f.server.db.prepare('SELECT deck_json FROM rooms WHERE id = ?').get(oldRoom.room).deck_json);
  assert.equal(stored.questions[0].id, q.id); assert.equal(stored.questions.length, 9);
  const fresh = await f.room();
  const freshDeck = JSON.parse(f.server.db.prepare('SELECT deck_json FROM rooms WHERE id = ?').get(fresh.room).deck_json);
  assert.equal(freshDeck.questions.length, 8);
  assert.equal(freshDeck.questions.some(e => e.id === q.id), false);
  await f.stop();
  const next = await env.start();
  assert.equal((await (await next.api('/questions')).json()).questions.length, 8);
  assert.equal((await fetch(`${next.base}/media/${oldRoom.room}/0`)).status, 200);
});

test('inaktive Fragen bleiben gespeichert; leere Bibliotheken werden nicht erneut vorbefüllt', async t => {
  const env = await setup(t), f = await env.start();
  const entries = (await (await f.api('/questions')).json()).questions;
  for (const q of entries) await f.api(`/questions/${q.id}`, 'PUT', { ...q, enabled: false });
  assert.equal((await (await fetch(`${f.base}/api/config`)).json()).questionCount, 0);
  assert.equal((await f.room()).error, 'Bitte zuerst mindestens eine Frage in der Fragenverwaltung aktivieren.');
  const disabled = (await (await f.api('/questions')).json()).questions;
  for (const q of disabled) await f.api(`/questions/${q.id}`, 'DELETE', { version: q.version });
  await f.stop(); const next = await env.start();
  assert.equal((await (await next.api('/questions')).json()).questions.length, 0);
});

test('Migration übernimmt v1-Räume und Antworten und behält deren alte Wertung', async t => {
  const env = await setup(t);
  const old = new DatabaseSync(env.dbPath);
  old.exec(`CREATE TABLE rooms (id TEXT PRIMARY KEY, host_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
    phase TEXT NOT NULL DEFAULT 'lobby', question_index INTEGER NOT NULL DEFAULT -1, deadline INTEGER,
    duration INTEGER NOT NULL, deck_id TEXT NOT NULL, deck_json TEXT NOT NULL, join_base TEXT NOT NULL);
    CREATE TABLE players (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), token_hash TEXT NOT NULL, nickname TEXT NOT NULL, joined_at INTEGER NOT NULL);
    CREATE TABLE answers (player_id TEXT NOT NULL REFERENCES players(id), question_id TEXT NOT NULL, choice TEXT NOT NULL, points INTEGER NOT NULL CHECK(points IN (0,1000)), answered_at INTEGER NOT NULL, PRIMARY KEY(player_id,question_id));
    INSERT INTO rooms VALUES ('123456', 'hash', 0, 'finished', 0, NULL, 25, 'old', '{"questions":[]}', 'http://localhost');
    INSERT INTO players VALUES ('old-player','123456','hash','Vorher',0);
    INSERT INTO answers VALUES ('old-player','q1','human',1000,0);`);
  old.close(); const f = await env.start();
  const result = f.server.db.prepare('SELECT * FROM answers').get(); assert.equal(result.points, 1000); assert.equal(result.base_points, 1000); assert.equal(result.elapsed_ms, null);
  assert.equal(f.server.db.prepare('SELECT scoring_version FROM rooms').get().scoring_version, 'classic-v1');
  f.server.db.prepare('UPDATE answers SET points = 1750').run();
  assert.equal(f.server.db.prepare('SELECT points FROM answers').get().points, 1750);
});

test('Spielstand-Reset erhält eigene Fragen und ihre Bilddateien', async t => {
  const env = await setup(t), f = await env.start();
  const image = readFileSync(path.join(projectRoot, 'content/assets/mountain.jpg'));
  const uploaded = await (await fetch(`${f.base}/api/admin/media`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'image/jpeg' }, body: image })).json();
  const q = await (await f.api('/questions', 'POST', { ...own, type: 'photo', asset: uploaded.asset })).json();
  await f.room(); await f.stop();
  const reset = spawnSync(process.execPath, ['scripts/reset-db.js', '--confirm'], { cwd: projectRoot, env: { ...process.env, DB_PATH: env.dbPath }, encoding: 'utf8' });
  assert.equal(reset.status, 0, reset.stderr);
  const next = await env.start();
  assert.equal(next.server.db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n, 0);
  assert.ok((await (await next.api('/questions')).json()).questions.some(entry => entry.id === q.id));
  assert.equal((await next.api(`/questions/${q.id}/media`)).status, 200);
});
