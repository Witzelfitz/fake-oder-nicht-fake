import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { createQuizServer } from '../server/app.js';
import { loadDeck } from '../server/content.js';
import { applyMediaPack } from '../server/media-pack.js';

const headers = { Authorization: 'Bearer media-test', 'Content-Type': 'application/json' };
async function setup(t) {
  const server = createQuizServer({ dbPath: ':memory:', hostKey: 'media-test' });
  await server.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.http.address().port}`, sockets = [];
  t.after(async () => { for (const socket of sockets) socket.disconnect(); await server.close(); });
  const connect = async () => { const s = io(base, { transports: ['websocket'], reconnection: false }); sockets.push(s); await once(s, 'connect'); return s; };
  const send = (s, event, payload) => new Promise((resolve, reject) => s.timeout(3000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result)));
  return { server, base, connect, send };
}
test('Standardquiz hat zehn Medien, einfache Treffer und keine Quellen- oder Werkstattschritte', async t => {
  const f = await setup(t);
  const config = await (await fetch(f.base + '/api/config')).json();
  assert.equal(config.questionCount, 10); assert.ok(!Object.hasOwn(config, 'sets'));
  for (const path of ['/import/preview', '/publications', '/settings']) assert.equal((await fetch(f.base + '/api/admin' + path, { headers })).status, 404);
  assert.equal((await fetch(f.base + '/api/rooms', { method: 'POST', headers, body: JSON.stringify({ hostKey: 'media-test', mode: 'learning-v1' }) })).status, 400);
  const room = await (await fetch(f.base + '/api/rooms', { method: 'POST', headers, body: JSON.stringify({ hostKey: 'media-test' }) })).json();
  const host = await f.connect();
  const view = async () => (await f.send(host, 'watch', { room: room.room, hostToken: room.hostToken })).state;
  assert.equal((await view()).mode, 'simple-v1');
  const one = await f.connect(), two = await f.connect();
  await f.send(one, 'join', { room: room.room, nickname: 'Eins' }); await f.send(two, 'join', { room: room.room, nickname: 'Zwei' });
  await f.send(host, 'host:action', { action: 'start' });
  for (const [index, q] of loadDeck().questions.entries()) {
    const state = await view();
    assert.equal(state.phase, 'question'); assert.equal(state.question.id, q.id); assert.equal(state.reveal, null);
    assert.ok(!Object.hasOwn(state.question, 'answer')); assert.ok(!Object.hasOwn(state.question, 'source'));
    if (index < 9) assert.equal((await fetch(`${f.base}/media/${room.room}/${index + 1}`)).status, 404);
    if (q.type === 'video') {
      assert.equal(state.question.image, null);
      const res = await fetch(f.base + state.question.video, { headers: { Range: 'bytes=0-1023' } });
      assert.equal(res.status, 206); assert.match(res.headers.get('content-type'), /video\/mp4/);
      assert.match(res.headers.get('content-range'), /^bytes 0-1023\//); assert.equal((await res.arrayBuffer()).byteLength, 1024);
    } else assert.equal((await fetch(f.base + state.question.image)).status, 200);
    assert.equal((await f.send(one, 'answer', { questionId: q.id, choice: q.answer, points: 999999 })).ok, true);
    assert.equal((await f.send(two, 'answer', { questionId: q.id, choice: index ? q.answer : q.answer === 'ai' ? 'human' : 'ai' })).ok, true);
    await f.send(host, 'host:action', { action: 'reveal' });
    assert.equal((await view()).reveal.answer, q.answer);
    await f.send(host, 'host:action', { action: 'next' });
  }
  const state = await view(); assert.equal(state.phase, 'finished');
  assert.deepEqual(state.leaderboard.map(p => p.score), [10, 9]);
  assert.ok(state.leaderboard.every(p => p.speedBonus === 0 && p.streakBonus === 0 && p.avgMs === null));
});

test('MP4-Upload funktioniert ohne zusätzliche Pflichtfelder und bleibt geschützt', async t => {
  const f = await setup(t), bytes = readFileSync(new URL('../content/assets/round-04.mp4', import.meta.url));
  const upload = await fetch(f.base + '/api/admin/media', { method: 'POST', headers: { Authorization: headers.Authorization, 'Content-Type': 'video/mp4' }, body: bytes });
  assert.equal(upload.status, 201); const { asset } = await upload.json(); assert.match(asset, /^upload:[a-f0-9]{32}\.mp4$/);
  const create = body => fetch(f.base + '/api/admin/questions', { method: 'POST', headers, body: JSON.stringify(body) });
  const response = await create({ type: 'video', title: 'Eigener Clip', answer: 'ai', asset });
  assert.equal(response.status, 201); const question = await response.json();
  assert.equal((await fetch(`${f.base}/api/admin/questions/${question.id}/media`)).status, 401);
  const media = await fetch(`${f.base}/api/admin/questions/${question.id}/media`, { headers: { Authorization: headers.Authorization, Range: 'bytes=0-31' } });
  assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 32);
  assert.equal((await create({ type: 'photo', title: 'Falsches Format', answer: 'ai', asset })).status, 400);
  assert.equal((await create({ type: 'text', title: 'Text', answer: 'human', text: 'Nicht im Medienquiz.' })).status, 400);
});

test('Medienpaket ersetzt alte Fragen einmalig, sichert sie und erhält Änderungen bei Neustarts', async t => {
  const f = await setup(t), db = f.server.db;
  db.exec('DELETE FROM question_bank');
  db.prepare('INSERT INTO question_bank(id,question_json,position) VALUES(?,?,?)').run('old-question', JSON.stringify({ title: 'Alte eigene Fassung' }), 0);
  const result = applyMediaPack(db, loadDeck());
  assert.equal(result.archivedQuestions, 1); assert.equal(db.prepare('SELECT COUNT(*) n FROM question_bank').get().n, 10);
  const archive = JSON.parse(db.prepare("SELECT value FROM quiz_meta WHERE key='bank_archive_before_simple_20261030'").get().value);
  assert.equal(JSON.parse(archive.rows[0].question_json).title, 'Alte eigene Fassung');
  db.prepare('UPDATE question_bank SET enabled=0 WHERE id=?').run('media-01');
  assert.equal(applyMediaPack(db, loadDeck()).changed, false);
  assert.equal(db.prepare('SELECT enabled FROM question_bank WHERE id=?').get('media-01').enabled, 0);
});
