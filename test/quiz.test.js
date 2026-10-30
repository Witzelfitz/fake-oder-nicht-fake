import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createQuizServer } from '../server/app.js';
import { loadDeck } from '../server/content.js';

const deck = { id: 'integration-v1', title: 'Test', questions: [
  { id: 'test-1', type: 'text', title: 'Frage eins', text: 'Ein kurzer Text.', answer: 'ai', explanation: 'GEHEIME AUFLÖSUNG', takeaway: 'Quelle prüfen', source: 'https://example.org', credit: 'Test', license: 'Test' },
  { id: 'test-2', type: 'text', title: 'Frage zwei', text: 'Ein weiterer Text.', answer: 'human', explanation: 'Auflösung zwei', takeaway: 'Kontext prüfen', source: 'https://example.org', credit: 'Test', license: 'Test' }
] };
const send = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, payload, (err, result) => err ? reject(err) : resolve(result)));
async function fixture(t, options = {}) {
  const server = createQuizServer({ legacy: true, deck, dbPath: ':memory:', hostKey: 'test-host-secret', ...options });
  await server.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.http.address().port}`;
  const sockets = [];
  let closed = false;
  const stop = async () => { if (closed) return; closed = true; for (const s of sockets) s.disconnect(); await server.close(); };
  t.after(stop);
  async function connect() {
    const socket = io(base, { transports: ['websocket'], reconnection: false });
    sockets.push(socket); await once(socket, 'connect'); return socket;
  }
  async function room() {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostKey: 'test-host-secret', duration: 15, mode: 'speed-streak-v2' }) });
    assert.equal(response.status, 201); return response.json();
  }
  async function host(roomInfo) {
    const socket = await connect();
    assert.equal((await send(socket, 'watch', { room: roomInfo.room, hostToken: roomInfo.hostToken })).ok, true);
    return socket;
  }
  async function join(roomInfo, name = 'Bergfuchs') {
    const socket = await connect(); const result = await send(socket, 'join', { room: roomInfo.room, nickname: name });
    assert.equal(result.ok, true); return { socket, ...result };
  }
  async function snapshot(roomInfo) {
    const socket = await connect(); const result = await send(socket, 'watch', { room: roomInfo.room });
    socket.disconnect(); return result.state;
  }
  return { server, base, connect, room, host, join, snapshot, stop };
}

test('das echte Fragenset enthält alle Medien, beide Herkunftstypen und vorhandene Assets', () => {
  const loaded = loadDeck();
  assert.equal(loaded.questions.length, 10);
  assert.deepEqual(new Set(loaded.questions.map(q => q.type)), new Set(['photo', 'video']));
  assert.equal(loaded.questions.filter(q => q.answer === 'ai').length, 5);
  assert.equal(loaded.questions.filter(q => q.type === 'video').length, 4);
});

test('HTTP schützt Moderation, validiert Eingaben und liefert lokale Assets sowie QR ohne externe Dienste', async t => {
  const f = await fixture(t);
  const post = data => fetch(`${f.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await post({ hostKey: 'wrong' })).status, 403);
  assert.equal((await post({ hostKey: 'test-host-secret', duration: 0 })).status, 400);
  assert.equal((await post({ hostKey: 'test-host-secret', joinBase: 'javascript:alert(1)' })).status, 400);
  assert.equal((await fetch(`${f.base}/content/questions.json`)).status, 404);
  assert.equal((await fetch(`${f.base}/server/app.js`)).status, 404);
  assert.equal((await fetch(`${f.base}/sample`)).status, 200);
  const qr = await fetch(`${f.base}/api/qr?url=${encodeURIComponent(f.base)}`);
  assert.equal(qr.headers.get('content-type'), 'image/png'); assert.ok((await qr.arrayBuffer()).byteLength > 500);
  const page = await fetch(`${f.base}/host`); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('Lösungen und Punkte bleiben bis zur Auflösung geheim, Antworten zählen nur einmal', async t => {
  const f = await fixture(t); const room = await f.room(); const host = await f.host(room);
  const one = await f.join(room, 'Eins'); const two = await f.join(room, 'Zwei');
  assert.equal((await send(host, 'host:action', { action: 'start' })).ok, true);
  const before = await f.snapshot(room);
  assert.equal(before.question.id, 'test-1'); assert.equal(before.reveal, null); assert.deepEqual(before.leaderboard, []);
  assert.ok(!JSON.stringify(before).includes('GEHEIME AUFLÖSUNG'));
  assert.ok(!Object.hasOwn(before.question, 'answer'));
  assert.equal((await send(one.socket, 'answer', { questionId: 'test-1', choice: 'ai', points: 999999 })).ok, true);
  assert.equal((await send(one.socket, 'answer', { questionId: 'test-1', choice: 'human' })).ok, false);
  assert.equal((await send(two.socket, 'answer', { questionId: 'test-1', choice: 'human' })).ok, true);
  const rejoined = await send(one.socket, 'join', { room: room.room, playerId: one.playerId, playerToken: one.playerToken });
  assert.equal(rejoined.state.me.score, null); assert.deepEqual(rejoined.state.me.answer, { choice: 'ai' });
  assert.equal((await send(host, 'host:action', { action: 'reveal' })).ok, true);
  const after = await f.snapshot(room);
  assert.equal(after.reveal.answer, 'ai'); assert.ok(after.leaderboard[0].score >= 1000 && after.leaderboard[0].score <= 1500);
  assert.equal(after.leaderboard[1].score, 0); assert.equal(after.answeredCount, 2);
  assert.equal((await send(one.socket, 'answer', { questionId: 'test-1', choice: 'ai' })).ok, false);
});

test('Beamer und Mitspielende können nicht moderieren, fremde Zugänge oder veraltete Fragen verwenden', async t => {
  const f = await fixture(t); const room = await f.room(); const host = await f.host(room);
  const player = await f.join(room); const viewer = await f.connect();
  await send(viewer, 'watch', { room: room.room });
  assert.equal((await send(viewer, 'host:action', { action: 'start' })).ok, false);
  assert.equal((await send(player.socket, 'host:action', { action: 'start', hostToken: room.hostToken })).ok, false);
  assert.equal((await send(viewer, 'watch', { room: room.room, hostToken: 'wrong' })).ok, false);
  assert.equal((await send(viewer, 'join', { room: room.room, playerId: player.playerId, playerToken: 'wrong' })).ok, false);
  await send(host, 'host:action', { action: 'start' });
  assert.equal((await send(viewer, 'answer', { questionId: 'test-1', choice: 'ai' })).ok, false);
  assert.equal((await send(player.socket, 'answer', { questionId: 'test-2', choice: 'human' })).ok, false);
  assert.equal((await send(player.socket, 'answer', { questionId: 'test-1', choice: 'maybe' })).ok, false);
  const late = await f.connect(); assert.equal((await send(late, 'join', { room: room.room, nickname: 'Zu spät' })).ok, false);
});

test('Spitznamen werden geprüft; Wiederverbinden erhält Identität und gespeicherte Antwort', async t => {
  const f = await fixture(t); const room = await f.room(); const host = await f.host(room);
  const bad = await f.connect();
  assert.equal((await send(bad, 'join', { room: room.room, nickname: '<img src=x>' })).ok, false);
  const player = await f.join(room, 'Füchsli');
  assert.equal((await send(bad, 'join', { room: room.room, nickname: 'Füchsli' })).ok, false);
  await send(host, 'host:action', { action: 'start' });
  await send(player.socket, 'answer', { questionId: 'test-1', choice: 'ai' }); player.socket.disconnect();
  const fresh = await f.connect();
  const response = await send(fresh, 'join', { room: room.room, playerId: player.playerId, playerToken: player.playerToken });
  assert.equal(response.ok, true); assert.equal(response.state.playerCount, 1); assert.equal(response.state.me.answer.choice, 'ai');
});

test('Frist wird serverseitig erzwungen und eine laufende Frage automatisch aufgelöst', async t => {
  const f = await fixture(t); const room = await f.room(); const host = await f.host(room); const player = await f.join(room);
  await send(host, 'host:action', { action: 'start' });
  const revealed = new Promise(resolve => player.socket.on('state', state => { if (state.phase === 'reveal') resolve(state); }));
  // Real timer path with a shortened persisted deadline, rearmed through a normal watch.
  f.server.db.prepare('UPDATE rooms SET deadline = ? WHERE id = ?').run(Date.now() + 100, room.room);
  await f.snapshot(room);
  const result = await Promise.race([revealed, new Promise((_, reject) => setTimeout(() => reject(new Error('Kein Timer-Reveal')), 2000).unref())]);
  assert.equal(result.phase, 'reveal');
  assert.equal((await send(player.socket, 'answer', { questionId: 'test-1', choice: 'ai' })).ok, false);
});

test('Stand-Rangliste vergleicht vollständige Runden und trennt Antwortzeiten; Tempo entscheidet mit', async t => {
  const f = await fixture(t); const room = await f.room(); const host = await f.host(room);
  const p1 = await f.join(room, 'Alpha'); const p2 = await f.join(room, 'Beta'); await f.join(room, 'Ohne Antworten');
  await send(host, 'host:action', { action: 'start' });
  for (const q of deck.questions) {
    for (const [player, elapsed] of [[p1, 3000], [p2, 9000]]) {
      f.server.db.prepare('UPDATE rooms SET started_at = ?, deadline = ? WHERE id = ?').run(Date.now() - elapsed, Date.now() - elapsed + 15000, room.room);
      await send(player.socket, 'answer', { questionId: q.id, choice: q.answer });
    }
    await send(host, 'host:action', { action: 'reveal' });
    await send(host, 'host:action', { action: 'next' });
  }
  const state = await f.snapshot(room); assert.equal(state.phase, 'finished');
  assert.equal(state.globalLeaderboard.length, 2);
  assert.deepEqual(state.globalLeaderboard.map(p => p.rank), [1, 2]);
  assert.equal(state.globalLeaderboard[0].id, p1.playerId);
  assert.ok(state.globalLeaderboard[0].score > state.globalLeaderboard[1].score);
  assert.equal(state.globalLeaderboard[0].bestStreak, 2);
  assert.equal(state.globalLeaderboard[0].streakBonus, 100);
  const other = await f.room(); const otherHost = await f.host(other); await f.join(other, 'Neue Gruppe');
  assert.equal((await f.snapshot(other)).phase, 'lobby');
  assert.equal((await (await fetch(`${f.base}/api/leaderboard?duration=15`)).json()).entries.length, 2);
  assert.equal((await (await fetch(`${f.base}/api/leaderboard?duration=25`)).json()).entries.length, 0);
  assert.equal((await send(otherHost, 'host:action', { action: 'next' })).ok, false);
});

test('SQLite überlebt Neustarts inklusive Raum, Moderationszugang und Antwort', async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'fake-quiz-test-'));
  let first, second;
  t.after(async () => {
    await first?.stop(); await second?.stop();
    if (path.dirname(folder) === path.resolve(tmpdir()) && path.basename(folder).startsWith('fake-quiz-test-')) rmSync(folder, { recursive: true, force: true });
  });
  const dbPath = path.join(folder, 'quiz.sqlite');
  first = await fixture(t, { dbPath }); const room = await first.room(); const host = await first.host(room); const player = await first.join(room);
  await send(host, 'host:action', { action: 'start' }); await send(player.socket, 'answer', { questionId: 'test-1', choice: 'ai' });
  const persistedPoints = first.server.db.prepare('SELECT points FROM answers WHERE player_id = ?').get(player.playerId).points;
  await first.stop();
  second = await fixture(t, { dbPath }); const restoredHost = await second.host(room);
  const s = await second.connect(); const restored = await send(s, 'join', { room: room.room, playerId: player.playerId, playerToken: player.playerToken });
  assert.equal(restored.ok, true); assert.equal(restored.state.me.answer.choice, 'ai');
  await send(restoredHost, 'host:action', { action: 'reveal' });
  assert.equal((await second.snapshot(room)).leaderboard[0].score, persistedPoints);
});

test('eine ausgelassene Frage unterbricht die Trefferfolge', async t => {
  const extended = { ...deck, questions: [...deck.questions, { ...deck.questions[0], id: 'test-3' }] };
  const f = await fixture(t, { deck: extended }); const room = await f.room(); const host = await f.host(room); const p = await f.join(room);
  await send(host, 'host:action', { action: 'start' });
  await send(p.socket, 'answer', { questionId: 'test-1', choice: 'ai' });
  await send(host, 'host:action', { action: 'reveal' }); await send(host, 'host:action', { action: 'next' });
  await send(host, 'host:action', { action: 'reveal' }); await send(host, 'host:action', { action: 'next' });
  await send(p.socket, 'answer', { questionId: 'test-3', choice: 'ai' });
  await send(host, 'host:action', { action: 'reveal' });
  const stored = f.server.db.prepare("SELECT streak, streak_bonus FROM answers WHERE player_id = ? AND question_id = 'test-3'").get(p.playerId);
  assert.equal(stored.streak, 1); assert.equal(stored.streak_bonus, 0);
});
