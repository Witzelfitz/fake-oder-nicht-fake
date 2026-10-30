import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { openDatabase } from './database.js';
import { loadDeck, publicQuestion, projectRoot, contentRoot } from './content.js';

const hash = value => createHash('sha256').update(String(value ?? '')).digest('hex');
const matches = (value, expected) => timingSafeEqual(Buffer.from(hash(value)), Buffer.from(expected));
const token = () => randomBytes(32).toString('hex');
const roomCode = value => typeof value === 'string' && /^\d{6}$/.test(value) ? value : null;
const nickname = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
const fail = message => { throw new Error(message); };

export function createQuizServer(options = {}) {
  const db = openDatabase(options.dbPath ?? './data/quiz.sqlite');
  const deck = options.deck ?? loadDeck();
  const hostKey = options.hostKey || token().slice(0, 16);
  const hostHash = hash(hostKey);
  const publicUrl = options.publicUrl?.replace(/\/$/, '');
  if (publicUrl && !/^https?:\/\/[^\s]+$/.test(publicUrl)) throw new Error('PUBLIC_URL muss eine HTTP(S)-Adresse sein.');
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'Cache-Control': 'no-store'
    });
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  const http = createServer(app);
  const io = new Server(http, { maxHttpBufferSize: 8192, serveClient: true });
  const timers = new Map();
  const limits = new Map();
  function rate(key, max, windowMs = 60000) {
    const now = Date.now();
    let entry = limits.get(key);
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + windowMs }; limits.set(key, entry); }
    return ++entry.count <= max;
  }
  const cleanup = setInterval(() => { for (const [key, entry] of limits) if (entry.until < Date.now()) limits.delete(key); }, 60000);
  cleanup.unref();

  const getRoom = id => db.prepare('SELECT * FROM rooms WHERE id = ?').get(String(id ?? ''));
  const roomDeck = room => JSON.parse(room.deck_json);
  const getPlayers = id => db.prepare('SELECT id, nickname FROM players WHERE room_id = ? ORDER BY joined_at, id').all(id);
  const getAnswer = (player, q) => db.prepare('SELECT choice, points FROM answers WHERE player_id = ? AND question_id = ?').get(player, q);
  function leaderboard(id) {
    return db.prepare(`SELECT p.id, p.nickname, COALESCE(SUM(a.points), 0) AS score,
      COUNT(a.question_id) AS answered, COALESCE(SUM(CASE WHEN a.points > 0 THEN 1 ELSE 0 END), 0) AS correct
      FROM players p LEFT JOIN answers a ON a.player_id = p.id WHERE p.room_id = ?
      GROUP BY p.id ORDER BY score DESC, p.joined_at ASC, p.id ASC`).all(id)
      .map((p, i, rows) => ({ ...p, rank: i && rows[i - 1].score === p.score ? rows.findIndex(x => x.score === p.score) + 1 : i + 1 }));
  }
  function globalLeaderboard() {
    return db.prepare(`SELECT p.id, p.nickname, r.id AS room, SUM(a.points) AS score,
      COUNT(a.question_id) AS answered, SUM(CASE WHEN a.points > 0 THEN 1 ELSE 0 END) AS correct
      FROM players p JOIN rooms r ON r.id = p.room_id JOIN answers a ON a.player_id = p.id
      WHERE r.phase = 'finished' AND r.deck_id = ?
      GROUP BY p.id HAVING COUNT(a.question_id) = ?
      ORDER BY score DESC, r.created_at ASC, p.id ASC LIMIT 20`).all(deck.id, deck.questions.length)
      .map((p, i, rows) => ({ ...p, rank: rows.findIndex(x => x.score === p.score) + 1 }));
  }
  function view(room, identity = {}) {
    const questions = roomDeck(room).questions;
    const q = questions[room.question_index];
    const players = getPlayers(room.id);
    const answeredCount = q ? db.prepare('SELECT COUNT(*) AS n FROM answers a JOIN players p ON p.id = a.player_id WHERE p.room_id = ? AND a.question_id = ?').get(room.id, q.id).n : 0;
    const revealed = room.phase === 'reveal' || room.phase === 'finished';
    const me = players.find(p => p.id === identity.playerId);
    const myAnswer = me && q ? getAnswer(me.id, q.id) : null;
    return {
      room: room.id, phase: room.phase, index: room.question_index, total: questions.length,
      duration: room.duration, deadline: room.deadline, serverTime: Date.now(),
      joinUrl: `${room.join_base}/?code=${room.id}`,
      players: room.phase === 'lobby' ? players : [], playerCount: players.length, answeredCount,
      question: publicQuestion(q, room.id, room.question_index),
      reveal: q && revealed ? {
        answer: q.answer, explanation: q.explanation, takeaway: q.takeaway,
        source: q.source, credit: q.credit, license: q.license,
        votes: db.prepare(`SELECT a.choice, COUNT(*) AS n FROM answers a JOIN players p ON p.id = a.player_id WHERE p.room_id = ? AND a.question_id = ? GROUP BY a.choice`).all(room.id, q.id)
      } : null,
      leaderboard: revealed ? leaderboard(room.id) : [],
      globalLeaderboard: room.phase === 'finished' ? globalLeaderboard() : [],
      me: me ? { ...me, score: revealed ? leaderboard(room.id).find(p => p.id === me.id)?.score ?? 0 : null,
        answer: myAnswer ? { choice: myAnswer.choice, ...(revealed ? { points: myAnswer.points } : {}) } : null } : null
    };
  }
  function emitRoom(id) {
    const room = getRoom(id);
    if (!room) return;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.room === id) socket.emit('state', view(room, socket.data));
    }
  }
  function reveal(id) {
    clearTimeout(timers.get(id)); timers.delete(id);
    db.prepare("UPDATE rooms SET phase = 'reveal', deadline = NULL WHERE id = ? AND phase = 'question'").run(id);
    emitRoom(id);
  }
  function schedule(room) {
    clearTimeout(timers.get(room.id));
    if (room.phase !== 'question') return;
    if (room.deadline <= Date.now()) { reveal(room.id); return; }
    const timer = setTimeout(() => reveal(room.id), room.deadline - Date.now());
    timer.unref(); timers.set(room.id, timer);
  }
  const baseForRequest = req => publicUrl || `${req.protocol}://${req.get('host')}`;

  app.get('/api/config', (req, res) => {
    const port = http.address()?.port ?? 3000;
    const addresses = Object.values(networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal)
      .map(x => `http://${x.address}:${port}`);
    res.json({ title: deck.title, questionCount: deck.questions.length, publicUrl: publicUrl || null,
      suggestedUrls: [...new Set([...(publicUrl ? [publicUrl] : []), ...addresses, baseForRequest(req)])] });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/leaderboard', (_req, res) => res.json({ entries: globalLeaderboard(), totalQuestions: deck.questions.length }));
  app.post('/api/rooms', (req, res) => {
    if (!rate(`create:${req.socket.remoteAddress}`, 20)) return res.status(429).json({ error: 'Zu viele Versuche. Bitte kurz warten.' });
    if (!matches(req.body?.hostKey, hostHash)) return res.status(403).json({ error: 'Der Moderationsschlüssel stimmt nicht. Du findest ihn im Server-Terminal.' });
    const duration = Number(req.body.duration ?? 25);
    if (![15, 20, 25, 30, 45, 60].includes(duration)) return res.status(400).json({ error: 'Ungültige Antwortzeit.' });
    let base;
    try {
      const url = new URL(req.body.joinBase || baseForRequest(req));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
      base = url.origin;
    } catch { return res.status(400).json({ error: 'Bitte eine HTTP(S)-Basisadresse ohne Pfad eingeben.' }); }
    let id;
    do { id = String(randomInt(100000, 1000000)); } while (getRoom(id));
    const hostToken = token();
    db.prepare('INSERT INTO rooms (id, host_hash, created_at, duration, deck_id, deck_json, join_base) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, hash(hostToken), Date.now(), duration, deck.id, JSON.stringify(deck), base);
    res.status(201).json({ room: id, hostToken });
  });
  app.get('/api/qr', async (req, res, next) => {
    try {
      const value = String(req.query.url ?? '');
      if (value.length > 512 || !/^https?:\/\//.test(value)) return res.status(400).end();
      const png = await QRCode.toBuffer(value, { width: 280, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#17263b', light: '#ffffff' } });
      res.set('Cache-Control', 'public, max-age=86400').type('png').send(png);
    } catch (err) { next(err); }
  });
  app.get('/media/:room/:index', (req, res) => {
    const room = getRoom(req.params.room);
    const index = Number(req.params.index);
    if (!room || !Number.isInteger(index) || index < 0 || index > room.question_index) return res.sendStatus(404);
    const q = roomDeck(room).questions[index];
    if (!q?.asset) return res.sendStatus(404);
    const file = path.resolve(contentRoot, q.asset);
    if (!file.startsWith(contentRoot + path.sep)) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=86400, immutable').sendFile(file);
  });
  // This decorative sample is a photo, not an answer key. No content directory is served.
  app.get('/sample', (_req, res) => res.set('Cache-Control', 'public, max-age=86400').sendFile(path.join(contentRoot, 'assets', 'mountain.jpg')));
  app.use(express.static(path.join(projectRoot, 'public')));
  for (const route of ['/host', '/screen', '/leaderboard']) app.get(route, (_req, res) => res.sendFile(path.join(projectRoot, 'public', 'index.html')));

  io.on('connection', socket => {
    function handle(event, action) {
      socket.on(event, (payload, ack) => {
        if (typeof ack !== 'function') return;
        try {
          if (!rate(`socket:${socket.id}`, 100, 10000)) return ack({ ok: false, error: 'Bitte einen Moment warten.' });
          action(payload && typeof payload === 'object' ? payload : {}, result => ack({ ok: true, ...result }));
        } catch (error) { ack({ ok: false, error: error.message }); }
      });
    }
    function requireHost() {
      const room = getRoom(socket.data.room);
      if (!room || !socket.data.host) fail('Nur die Moderation kann das Spiel steuern.');
      return room;
    }
    handle('watch', (data, done) => {
      const id = roomCode(data.room);
      const room = id && getRoom(id);
      if (!room) fail('Dieser Spielcode existiert nicht.');
      socket.data = { room: id };
      if (data.hostToken) {
        if (!matches(data.hostToken, room.host_hash)) fail('Moderationszugang ungültig.');
        socket.data.host = true;
      }
      schedule(room);
      done({ state: view(getRoom(id), socket.data) });
    });
    handle('join', (data, done) => {
      const room = getRoom(roomCode(data.room) || '');
      if (!room) fail('Dieser Spielcode existiert nicht.');
      let player;
      let playerToken = data.playerToken;
      if (data.playerId && typeof playerToken === 'string') {
        const found = db.prepare('SELECT * FROM players WHERE id = ? AND room_id = ?').get(String(data.playerId), room.id);
        if (found && matches(playerToken, found.token_hash)) player = found;
        else fail('Dein gespeicherter Zugang ist ungültig. Bitte neu beitreten.');
      }
      if (!player) {
        if (room.phase !== 'lobby') fail('Die Runde läuft bereits. Bitte bei der nächsten Gruppe mitmachen.');
        if (!rate(`join:${socket.handshake.address}`, 200)) fail('Zu viele Beitritte. Bitte eine Minute warten.');
        const name = nickname(data.nickname);
        if (name.length < 2 || name.length > 20 || !/^[\p{L}\p{N} ._\-]+$/u.test(name)) fail('Bitte 2–20 Buchstaben oder Zahlen als Spitznamen verwenden.');
        if (getPlayers(room.id).length >= 100) fail('Diese Runde ist voll (100 Personen).');
        if (db.prepare('SELECT id FROM players WHERE room_id = ? AND nickname = ? COLLATE NOCASE').get(room.id, name)) fail('Dieser Spitzname ist schon vergeben.');
        playerToken = token();
        player = { id: randomBytes(16).toString('hex'), room_id: room.id, nickname: name };
        db.prepare('INSERT INTO players (id, room_id, token_hash, nickname, joined_at) VALUES (?, ?, ?, ?, ?)')
          .run(player.id, room.id, hash(playerToken), name, Date.now());
      }
      socket.data = { room: room.id, playerId: player.id };
      schedule(room);
      done({ playerId: player.id, playerToken, state: view(getRoom(room.id), socket.data) });
      emitRoom(room.id);
    });
    handle('answer', (data, done) => {
      const room = getRoom(socket.data.room);
      if (!room || !socket.data.playerId) fail('Bitte zuerst beitreten.');
      if (room.phase !== 'question' || Date.now() >= room.deadline) {
        if (room.phase === 'question') reveal(room.id);
        fail('Die Antwortzeit ist vorbei.');
      }
      const q = roomDeck(room).questions[room.question_index];
      if (data.questionId !== q.id) fail('Diese Frage ist nicht mehr aktuell.');
      if (!['ai', 'human'].includes(data.choice)) fail('Bitte eine der zwei Antworten wählen.');
      if (getAnswer(socket.data.playerId, q.id)) fail('Deine Antwort ist schon gespeichert.');
      db.prepare('INSERT INTO answers (player_id, question_id, choice, points, answered_at) VALUES (?, ?, ?, ?, ?)')
        .run(socket.data.playerId, q.id, data.choice, data.choice === q.answer ? 1000 : 0, Date.now());
      done({ accepted: true });
      emitRoom(room.id);
    });
    handle('host:action', (data, done) => {
      const room = requireHost();
      const questions = roomDeck(room).questions;
      if (data.action === 'start' && room.phase === 'lobby') {
        if (!getPlayers(room.id).length) fail('Zuerst muss mindestens eine Person beitreten.');
        db.prepare("UPDATE rooms SET phase = 'question', question_index = 0, deadline = ? WHERE id = ?").run(Date.now() + room.duration * 1000, room.id);
      } else if (data.action === 'reveal' && room.phase === 'question') {
        reveal(room.id); done({}); return;
      } else if (data.action === 'next' && room.phase === 'reveal') {
        if (room.question_index + 1 === questions.length) {
          db.prepare("UPDATE rooms SET phase = 'finished', deadline = NULL WHERE id = ?").run(room.id);
        } else {
          db.prepare("UPDATE rooms SET phase = 'question', question_index = question_index + 1, deadline = ? WHERE id = ?").run(Date.now() + room.duration * 1000, room.id);
        }
      } else fail('Diese Aktion passt nicht zum aktuellen Spielstand.');
      schedule(getRoom(room.id));
      emitRoom(room.id);
      done({});
    });
  });
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large' || error instanceof SyntaxError) return res.status(400).json({ error: 'Ungültige Anfrage.' });
    console.error(error.message);
    res.status(500).json({ error: 'Serverfehler. Bitte die Moderation informieren.' });
  });
  for (const room of db.prepare("SELECT * FROM rooms WHERE phase = 'question'").all()) schedule(room);
  return {
    app, http, io, db, hostKey,
    listen: (port = 3000, host = '0.0.0.0') => new Promise(resolve => http.listen(port, host, () => resolve(http.address()))),
    close: () => new Promise(resolve => {
      clearInterval(cleanup);
      for (const timer of timers.values()) clearTimeout(timer);
      io.close(() => { db.close(); resolve(); });
    })
  };
}
