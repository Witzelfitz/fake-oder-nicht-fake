import { publicCase, sourceCards, labelFor } from './cases.js';

export const isLearning = room => ['learning-v1', 'workshop-v1'].includes(room?.mode);
const currentCase = room => JSON.parse(room.deck_json).questions[room.question_index];

export function learningView(db, room, identity) {
  const deck = JSON.parse(room.deck_json), q = currentCase(room);
  const players = db.prepare('SELECT id,nickname FROM players WHERE room_id = ? ORDER BY joined_at,id').all(room.id);
  const me = players.find(p => p.id === identity.playerId);
  const stage = room.phase === 'final_vote' || (room.phase === 'reveal' && room.mode === 'workshop-v1') ? 'final' : 'first';
  const responses = q ? db.prepare('SELECT * FROM responses_v3 WHERE room_id = ? AND case_id = ?').all(room.id, q.id) : [];
  const mine = responses.filter(a => a.player_id === me?.id);
  const votes = which => {
    const counts = new Map();
    for (const answer of responses.filter(a => a.stage === which)) counts.set(answer.choice, (counts.get(answer.choice) || 0) + 1);
    return Array.from(counts, ([choice, n]) => ({ choice, n, label: labelFor(q, choice) }));
  };
  const reveal = room.phase === 'reveal';
  const evidenceOpen = ['evidence', 'final_vote', 'reveal'].includes(room.phase);
  const allMine = me ? db.prepare('SELECT case_id,stage,choice FROM responses_v3 WHERE room_id = ? AND player_id = ?').all(room.id, me.id) : [];
  const skippedIndexes=new Set(db.prepare('SELECT request_json FROM room_commands WHERE room_id=?').all(room.id).map(row=>JSON.parse(row.request_json)).filter(c=>c.action==='skip').map(c=>c.index));
  const paired = deck.questions.map((c,index) => {
    const first = allMine.find(a => a.case_id === c.id && a.stage === 'first');
    const final = allMine.find(a => a.case_id === c.id && a.stage === 'final');
    return { caseId: c.id, title: c.title, skipped:skippedIndexes.has(index),first: first ? labelFor(c, first.choice) : null, final: final ? labelFor(c, final.choice) : null, changed: !!first && !!final && first.choice !== final.choice, takeaway: c.takeaway, transfer: c.transfer };
  });
  return {
    room: room.id, phase: room.phase, index: room.question_index, total: deck.questions.length,
    duration: room.duration, deadline: room.deadline, serverTime: Date.now(),
    mode: room.mode, schemaVersion: 3, scoringVersion: 'learning-v1', revision: room.revision,
    phaseStartedAt: room.phase_started_at, revealStep: room.reveal_step, votingClosed: !!room.voting_closed,
    audience: room.audience,event:deck.event||{}, setId: room.set_id, joinUrl: `${room.join_base}/?code=${room.id}`,
    players: room.phase === 'lobby' ? players : [], playerCount: players.length,
    answeredCount: responses.filter(a => a.stage === stage).length,
    question: q ? publicCase(q, room.id, room.question_index) : null,
    evidence: evidenceOpen && q ? sourceCards(q) : [],
    distribution: evidenceOpen && q ? votes('first') : [],
    reveal: reveal && q ? { answer: q.answer, label: labelFor(q, q.answer), explanation: q.explanation,
      takeaway: q.takeaway, limitation: q.limitation, transfer: q.transfer,
      source: q.source, credit: q.credit, license: q.license, votes: votes(stage), sources: sourceCards(q) } : null,
    hostNotes: identity.host && q ? { privateNotes: q.privateNotes || '', transfer: q.transfer, nextPhase: room.phase } : null,
    me: me ? { ...me, answer: mine.find(a => a.stage === stage) ? { choice: mine.find(a => a.stage === stage).choice, confidence: mine.find(a => a.stage === stage).confidence } : null,
      firstAnswer: mine.find(a => a.stage === 'first') ? { choice: mine.find(a => a.stage === 'first').choice } : null } : null,
    leaderboard: [], globalLeaderboard: [],
    reflection: room.phase === 'finished' && me ? { completed: paired.filter(c=>!c.skipped&&(c.first||c.final)).length, cases: paired } : null
  };
}

export function submitLearning(db, room, playerId, data) {
  if (!['first_vote', 'final_vote'].includes(room.phase) || room.voting_closed || !room.deadline || Date.now() >= room.deadline) throw new Error('Die Eingabe ist geschlossen. Die Moderation führt weiter.');
  const q = currentCase(room);
  const visible = publicCase(q, room.id, room.question_index);
  if (data.questionId !== q.id || data.promptId !== 'main' || !visible.options.some(o => o.id === data.choice)) throw new Error('Antwort passt nicht zum aktuellen Fall.');
  const stage = room.phase === 'first_vote' ? 'first' : 'final';
  if (data.stage !== stage) throw new Error('Diese Antwortphase ist nicht aktuell.');
  const confidence = data.confidence ?? null;
  if (confidence !== null && ![1, 2, 3].includes(confidence)) throw new Error('Ungültige Sicherheit.');
  if (db.prepare('SELECT 1 FROM responses_v3 WHERE room_id=? AND player_id=? AND case_id=? AND prompt_id=? AND stage=?').get(room.id, playerId, q.id, 'main', stage)) throw new Error('Deine Antwort ist schon gespeichert.');
  db.prepare('INSERT INTO responses_v3 (room_id,player_id,case_id,prompt_id,stage,choice,confidence,submitted_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(room.id, playerId, q.id, 'main', stage, data.choice, confidence, Date.now());
}

export function learningCommand(db, room, data, playerCount) {
  if (typeof data.commandId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.commandId)) throw new Error('Gültige Command-ID erforderlich.');
  const request = JSON.stringify({ action: data.action, revision: data.expectedRevision, phase: data.expectedPhase, index: data.expectedIndex });
  const prior = db.prepare('SELECT * FROM room_commands WHERE room_id=? AND command_id=?').get(room.id, data.commandId);
  if (prior) {
    if (prior.request_json !== request) throw new Error('Command-ID wurde für eine andere Aktion benutzt.');
    return JSON.parse(prior.result_json);
  }
  if (data.expectedRevision !== room.revision || data.expectedPhase !== room.phase || data.expectedIndex !== room.question_index) throw new Error('Der Spielstand hat sich geändert. Bitte die aktuelle Ansicht verwenden.');
  const now = Date.now(); let phase = room.phase, index = room.question_index, step = room.reveal_step, closed = 0, deadline = null;
  if (data.action === 'start' && phase === 'lobby') { if (!playerCount) throw new Error('Zuerst muss mindestens eine Person beitreten.'); phase = 'first_vote'; index = 0; }
  else if (data.action === 'evidence' && phase === 'first_vote' && room.mode === 'workshop-v1') phase = 'evidence';
  else if (data.action === 'final_vote' && phase === 'evidence') phase = 'final_vote';
  else if (data.action === 'reveal' && ['first_vote', 'final_vote'].includes(phase)) { phase = 'reveal'; step = 0; }
  else if (data.action === 'reveal_step' && phase === 'reveal' && step < 3) step++;
  else if ((data.action === 'next' && phase === 'reveal') || (data.action === 'skip' && !['lobby', 'finished'].includes(phase))) {
    const total = JSON.parse(room.deck_json).questions.length;
    index++; step = 0; phase = index === total ? 'finished' : 'first_vote';
  } else throw new Error('Diese Aktion passt nicht zum aktuellen Spielstand.');
  if (['first_vote', 'final_vote'].includes(phase)) deadline = now + room.duration * 1000;
  const result = { revision: room.revision + 1 };
  db.exec('BEGIN IMMEDIATE');
  try {
    const updated = db.prepare('UPDATE rooms SET phase=?,question_index=?,reveal_step=?,voting_closed=?,deadline=?,phase_started_at=?,revision=revision+1 WHERE id=? AND revision=?')
      .run(phase, index, step, closed, deadline, phase === room.phase ? room.phase_started_at : now, room.id, room.revision);
    if (updated.changes !== 1) throw new Error('Spielstand gleichzeitig geändert.');
    db.prepare('INSERT INTO room_commands (room_id,command_id,request_json,result_json) VALUES (?,?,?,?)').run(room.id, data.commandId, request, JSON.stringify(result));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return result;
}
