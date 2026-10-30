import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { localAddresses } from './network.js';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { openDatabase } from './database.js';
import { loadDeck, publicQuestion, projectRoot, contentRoot, resolveAsset } from './content.js';
import { questionBank, installQuestionAdmin } from './questions.js';
import { SCORING_VERSION, DURATIONS, scoreAnswer, rankPlayers } from './scoring.js';
import { MODES, validateCase } from './cases.js';
import { isLearning, learningView, learningCommand, submitLearning } from './learning.js';
import { curatedPack } from './imports.js';
import { readSettings, purgeExpired } from './settings.js';
import { installMaterials } from './materials.js';

const hash = value => createHash('sha256').update(String(value ?? '')).digest('hex');
const matches = (value, expected) => timingSafeEqual(Buffer.from(hash(value)), Buffer.from(expected));
const token = () => randomBytes(32).toString('hex');
const roomCode = value => typeof value === 'string' && /^\d{6}$/.test(value) ? value : null;
const nickname = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
const fail = message => { throw new Error(message); };

export function createQuizServer(options = {}) {
  const legacy = options.legacy === true;
  const db = openDatabase(options.dbPath ?? './data/quiz.sqlite');
  const bank = questionBank(db, options.deck ?? loadDeck());
  const temporaryUploads = options.dbPath === ':memory:' && !options.uploadDir ? mkdtempSync(path.join(tmpdir(),'fake-quiz-uploads-')) : null;
  const uploadRoot = path.resolve(options.uploadDir ?? temporaryUploads ?? path.join(path.dirname(path.resolve(options.dbPath || './data/quiz.sqlite')), 'uploads'));
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
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'Cache-Control': 'no-store'
    });
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  const http = createServer(app);
  const io = new Server(http, { maxHttpBufferSize: 8192, serveClient: true });
  const timers = new Map();
  const pendingRoomEmits = new Map();
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
  const getAnswer = (player, q) => db.prepare('SELECT * FROM answers WHERE player_id = ? AND question_id = ?').get(player, q);
  function leaderboard(id) {
    const room = getRoom(id);
    const players = getPlayers(id);
    const answers = db.prepare('SELECT a.* FROM answers a JOIN players p ON p.id = a.player_id WHERE p.room_id = ?').all(id);
    const rows = rankPlayers(players, answers);
    const current = roomDeck(room).questions[room.question_index]?.id;
    const previous = rankPlayers(players, answers.filter(a => a.question_id !== current));
    return rows.map(row => ({ ...row, movement: room.question_index > 0 ? (previous.find(p => p.id === row.id)?.rank ?? row.rank) - row.rank : 0 }));
  }
  function globalLeaderboard(room = null, duration = 25) {
    const deck = room ? roomDeck(room) : bank.deck();
    if (!deck.questions.length) return [];
    const args = [deck.id, room?.duration ?? duration, room?.scoring_version ?? SCORING_VERSION];
    const where = "r.phase = 'finished' AND r.deck_id = ? AND r.duration = ? AND r.scoring_version = ?";
    const players = db.prepare(`SELECT p.id, p.nickname, p.room_id FROM players p JOIN rooms r ON r.id = p.room_id WHERE ${where}`).all(...args);
    const answers = db.prepare(`SELECT a.* FROM answers a JOIN players p ON p.id = a.player_id JOIN rooms r ON r.id = p.room_id WHERE ${where}`).all(...args);
    const complete = players.filter(p => answers.filter(a => a.player_id === p.id).length === deck.questions.length);
    return rankPlayers(complete, answers).slice(0, 20);
  }
  function view(room, identity = {}) {
    if (isLearning(room)) return learningView(db, room, identity);
    const questions = roomDeck(room).questions;
    const q = questions[room.question_index];
    const players = getPlayers(room.id);
    const answeredCount = q ? db.prepare('SELECT COUNT(*) AS n FROM answers a JOIN players p ON p.id = a.player_id WHERE p.room_id = ? AND a.question_id = ?').get(room.id, q.id).n : 0;
    const revealed = room.phase === 'reveal' || room.phase === 'finished';
    const me = players.find(p => p.id === identity.playerId);
    const myAnswer = me && q ? getAnswer(me.id, q.id) : null;
    return {
      room: room.id, phase: room.phase, index: room.question_index, total: questions.length,
      duration: room.duration, deadline: room.deadline, serverTime: Date.now(), scoringVersion: room.scoring_version,
      mode: room.mode, revision: room.revision, phaseStartedAt: room.phase_started_at,
      joinUrl: `${room.join_base}/?code=${room.id}`,
      players: room.phase === 'lobby' ? players : [], playerCount: players.length, answeredCount,
      question: publicQuestion(q, room.id, room.question_index),
      reveal: q && revealed ? {
        answer: q.answer, explanation: q.explanation, takeaway: q.takeaway,
        source: q.source, credit: q.credit, license: q.license,
        votes: db.prepare(`SELECT a.choice, COUNT(*) AS n FROM answers a JOIN players p ON p.id = a.player_id WHERE p.room_id = ? AND a.question_id = ? GROUP BY a.choice`).all(room.id, q.id)
      } : null,
      leaderboard: revealed ? leaderboard(room.id) : [],
      globalLeaderboard: room.phase === 'finished' ? globalLeaderboard(room) : [],
      me: me ? { ...me, score: revealed ? leaderboard(room.id).find(p => p.id === me.id)?.score ?? 0 : null,
        answer: myAnswer ? { choice: myAnswer.choice, ...(revealed ? { points: myAnswer.points,
          elapsedMs: myAnswer.elapsed_ms, base: myAnswer.base_points, speed: myAnswer.speed_bonus,
          series: myAnswer.streak_bonus, streak: myAnswer.streak } : {}) } : null } : null
    };
  }
  function emitRoom(id) {
    clearTimeout(pendingRoomEmits.get(id));
    pendingRoomEmits.delete(id);
    const room = getRoom(id);
    if (!room) return;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.room === id) socket.emit('state', view(room, socket.data));
    }
  }
  function queueRoomEmit(id) {
    if (pendingRoomEmits.has(id)) return;
    // A burst of votes needs one fresh view per device, rather than one per vote.
    const timer = setTimeout(() => emitRoom(id), 40);
    timer.unref();
    pendingRoomEmits.set(id, timer);
  }
  function reveal(id) {
    clearTimeout(timers.get(id)); timers.delete(id);
    db.prepare("UPDATE rooms SET phase = 'reveal', deadline = NULL,phase_started_at=? WHERE id = ? AND phase = 'question'").run(Date.now(), id);
    emitRoom(id);
  }
  function schedule(room) {
    clearTimeout(timers.get(room.id));
    if (isLearning(room)) {
      if (!['first_vote', 'final_vote'].includes(room.phase) || !room.deadline || room.voting_closed) return;
      const closeVoting = () => {
        db.prepare('UPDATE rooms SET voting_closed=1,deadline=NULL,revision=revision+1 WHERE id=? AND deadline IS NOT NULL').run(room.id);
        emitRoom(room.id);
      };
      if (room.deadline <= Date.now()) { closeVoting(); return; }
      const timer = setTimeout(closeVoting, room.deadline - Date.now()); timer.unref(); timers.set(room.id,timer); return;
    }
    if (room.phase !== 'question') return;
    if (room.deadline <= Date.now()) { reveal(room.id); return; }
    const timer = setTimeout(() => reveal(room.id), room.deadline - Date.now());
    timer.unref(); timers.set(room.id, timer);
  }
  const baseForRequest = req => publicUrl || `${req.protocol}://${req.get('host')}`;

  const authenticate = (req,res,next) => {
    const key = req.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!matches(key, hostHash)) {
      if (!rate(`admin-auth:${req.socket.remoteAddress}`, 20)) return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte eine Minute warten.' });
      return res.status(401).json({ error: 'Moderationsschlüssel ungültig.' });
    }
    if (!rate(`admin:${req.socket.remoteAddress}`, 300)) return res.status(429).json({ error: 'Zu viele Anfragen. Bitte kurz warten.' });
    next();
  };
  installQuestionAdmin(app,{db,bank,uploadRoot,authenticate,legacy});
  if (legacy) installMaterials(app,{db,bank,uploadRoot,authenticate});

  app.get('/api/config', (req, res) => {
    const port = http.address()?.port ?? 3000;
    const addresses = localAddresses(port, options.networkReader);
    const deck = bank.deck();
    const settings = readSettings(db);
    const availableIds = new Set(bank.learningDeck().questions.map(q => q.id));
    res.json({ title: deck.title, questionCount: deck.questions.length, publicUrl: publicUrl || null,
      ...(legacy ? { learningCount: availableIds.size, event: settings.event, defaultSet: settings.defaultSet,
      sets: curatedPack().sets.map(set => ({ ...set, available: set.caseIds.every(id => availableIds.has(id)) })) } : {}),
      suggestedUrls: [...new Set([...(publicUrl ? [publicUrl] : []), ...addresses, baseForRequest(req)])] });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/leaderboard', (req, res) => {
    const duration = Number(req.query.duration ?? 25);
    if (!DURATIONS.includes(duration)) return res.status(400).json({ error: 'Ungültige Antwortzeit.' });
    res.json({ entries: globalLeaderboard(null, duration), totalQuestions: bank.deck().questions.length, duration });
  });
  app.post('/api/rooms', (req, res) => {
    if (!rate(`create:${req.socket.remoteAddress}`, 20)) return res.status(429).json({ error: 'Zu viele Versuche. Bitte kurz warten.' });
    if (!matches(req.body?.hostKey, hostHash)) return res.status(403).json({ error: 'Der Moderationsschlüssel stimmt nicht. Du findest ihn im Server-Terminal.' });
    const duration = Number(req.body.duration ?? 25);
    const mode = req.body.mode ?? 'simple-v1';
    if (!legacy && mode !== 'simple-v1') return res.status(400).json({ error: 'Dieses Quiz verwendet nur Bilder und Videos.' });
    if (!MODES.includes(mode)) return res.status(400).json({ error: 'Unbekannter Spielmodus.' });
    const quizMode = ['simple-v1', 'speed-streak-v2'].includes(mode);
    if (!(quizMode ? DURATIONS.includes(duration) : [25,30,45,60,75,90,120,180].includes(duration))) return res.status(400).json({ error: 'Ungültige Antwortzeit.' });
    const set = curatedPack().sets.find(s => s.id === req.body.setId);
    let deck;
    try {
      deck = quizMode ? bank.deck() : bank.learningDeck(req.body.caseIds ?? set?.caseIds ?? null);
      if (isLearning({ mode })) for (const q of deck.questions) validateCase(q,true);
    } catch (error) { return res.status(400).json({ error: error.message }); }
    if (!deck.questions.length) return res.status(400).json({ error: 'Bitte zuerst mindestens eine Frage in der Fragenverwaltung aktivieren.' });
    const profile=readSettings(db);deck={...deck,event:profile.event,resourcesUrl:profile.resourcesUrl};
    let base;
    try {
      const url = new URL(req.body.joinBase || baseForRequest(req));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
      base = url.origin;
    } catch { return res.status(400).json({ error: 'Bitte eine HTTP(S)-Basisadresse ohne Pfad eingeben.' }); }
    let id;
    do { id = String(randomInt(100000, 1000000)); } while (getRoom(id));
    const hostToken = token();
    db.prepare('INSERT INTO rooms (id,host_hash,created_at,duration,deck_id,deck_json,join_base,scoring_version,mode,schema_version,set_id,audience) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,hash(hostToken),Date.now(),duration,deck.id,JSON.stringify(deck),base,mode === 'simple-v1' ? 'count-v1' : mode === 'speed-streak-v2' ? SCORING_VERSION : 'learning-v1',mode,quizMode ? 1 : 3,quizMode ? 'media-quiz' : set?.id || 'custom',['sek1','sek2','adults'].includes(req.body.audience) ? req.body.audience : 'sek1');
    res.status(201).json({ room: id, hostToken });
  });
  app.get('/api/qr', async (req, res, next) => {
    try {
      const value = String(req.query.url ?? '');
      if (value.length > 512 || !/^https?:\/\//.test(value)) return res.status(400).end();
      const png = await QRCode.toBuffer(value, { width: 400, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#14202b', light: '#ffffff' } });
      res.set('Cache-Control', 'public, max-age=86400').type('png').send(png);
    } catch (err) { next(err); }
  });
  app.get('/media/:room/:index', (req, res) => {
    const room = getRoom(req.params.room);
    const index = Number(req.params.index);
    if (!room || !Number.isInteger(index) || index < 0 || index > room.question_index) return res.sendStatus(404);
    const q = roomDeck(room).questions[index];
    if (!q?.asset) return res.sendStatus(404);
    let file;
    try { file = resolveAsset(q.asset, uploadRoot); } catch { return res.sendStatus(404); }
    res.set('Cache-Control', 'public, max-age=86400, immutable').sendFile(file);
  });
  // This decorative sample is a photo, not an answer key. No content directory is served.
  app.get('/sample', (_req, res) => res.set('Cache-Control', 'public, max-age=86400').sendFile(path.join(contentRoot, 'assets', 'mountain.jpg')));
  for (const route of ['/materials','/stand.html']) app.get(route,(_req,res)=>res.redirect('/host'));
  app.use(express.static(path.join(projectRoot, 'public')));
  app.get('/admin', (_req, res) => res.sendFile(path.join(projectRoot, 'public', 'admin.html')));
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
      queueRoomEmit(room.id);
    });
    handle('answer', (data, done) => {
      const room = getRoom(socket.data.room);
      if (!room || !socket.data.playerId) fail('Bitte zuerst beitreten.');
      if (isLearning(room)) {
        schedule(room); submitLearning(db,getRoom(room.id),socket.data.playerId,data); done({ accepted: true }); queueRoomEmit(room.id); return;
      }
      if (room.phase !== 'question' || Date.now() >= room.deadline) {
        if (room.phase === 'question') reveal(room.id);
        fail('Die Antwortzeit ist vorbei.');
      }
      const q = roomDeck(room).questions[room.question_index];
      if (data.questionId !== q.id) fail('Diese Frage ist nicht mehr aktuell.');
      if (!['ai', 'human'].includes(data.choice)) fail('Bitte eine der zwei Antworten wählen.');
      if (getAnswer(socket.data.playerId, q.id)) fail('Deine Antwort ist schon gespeichert.');
      const now = Date.now();
      const previousId = roomDeck(room).questions[room.question_index - 1]?.id;
      const previous = previousId ? getAnswer(socket.data.playerId, previousId) : null;
      const scored = scoreAnswer({ correct: data.choice === q.answer, elapsedMs: now - (room.started_at ?? room.deadline - room.duration * 1000), durationMs: room.duration * 1000, previousStreak: previous?.streak ?? 0 });
      if (room.scoring_version === 'classic-v1') Object.assign(scored, { points: data.choice === q.answer ? 1000 : 0, base: data.choice === q.answer ? 1000 : 0, speed: 0, series: 0, elapsedMs: null, streak: 0 });
      if (room.mode === 'simple-v1') Object.assign(scored, { points: data.choice === q.answer ? 1 : 0, base: data.choice === q.answer ? 1 : 0, speed: 0, series: 0, elapsedMs: null, streak: 0 });
      db.prepare('INSERT INTO answers (player_id, question_id, choice, points, answered_at, elapsed_ms, base_points, speed_bonus, streak_bonus, streak) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(socket.data.playerId, q.id, data.choice, scored.points, now, scored.elapsedMs, scored.base, scored.speed, scored.series, scored.streak);
      done({ accepted: true });
      queueRoomEmit(room.id);
    });
    handle('host:action', (data, done) => {
      const room = requireHost();
      if (isLearning(room)) {
        const result = learningCommand(db,room,data,getPlayers(room.id).length);
        schedule(getRoom(room.id)); emitRoom(room.id); done(result); return;
      }
      const questions = roomDeck(room).questions;
      if (data.action === 'start' && room.phase === 'lobby') {
        if (!getPlayers(room.id).length) fail('Zuerst muss mindestens eine Person beitreten.');
        const now = Date.now();
        db.prepare("UPDATE rooms SET phase = 'question', question_index = 0, started_at = ?, deadline = ? WHERE id = ?").run(now, now + room.duration * 1000, room.id);
      } else if (data.action === 'reveal' && room.phase === 'question') {
        reveal(room.id); done({}); return;
      } else if (data.action === 'next' && room.phase === 'reveal') {
        if (room.question_index + 1 === questions.length) {
          db.prepare("UPDATE rooms SET phase = 'finished', deadline = NULL WHERE id = ?").run(room.id);
        } else {
          const now = Date.now();
          db.prepare("UPDATE rooms SET phase = 'question', question_index = question_index + 1, started_at = ?, deadline = ? WHERE id = ?").run(now, now + room.duration * 1000, room.id);
        }
      } else fail('Diese Aktion passt nicht zum aktuellen Spielstand.');
      schedule(getRoom(room.id));
      emitRoom(room.id);
      done({});
    });
  });
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Datei oder Anfrage zu gross. Medien: maximal 20 MB.' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Ungültige Anfrage.' });
    console.error(error.message);
    res.status(500).json({ error: 'Serverfehler. Bitte die Moderation informieren.' });
  });
  purgeExpired(db);
  for (const room of db.prepare("SELECT * FROM rooms WHERE phase IN ('question','first_vote','final_vote')").all()) schedule(room);
  return {
    app, http, io, db, hostKey, uploadRoot,
    listen: (port = 3000, host = '0.0.0.0') => new Promise(resolve => http.listen(port, host, () => resolve(http.address()))),
    close: () => new Promise(resolve => {
      clearInterval(cleanup);
      for (const timer of timers.values()) clearTimeout(timer);
      for (const timer of pendingRoomEmits.values()) clearTimeout(timer);
      pendingRoomEmits.clear();
      io.close(() => {
        db.close();
        if(temporaryUploads && path.dirname(path.resolve(temporaryUploads))===path.resolve(tmpdir()) && path.basename(temporaryUploads).startsWith('fake-quiz-uploads-'))rmSync(temporaryUploads,{recursive:true,force:true});
        resolve();
      });
    })
  };
}
