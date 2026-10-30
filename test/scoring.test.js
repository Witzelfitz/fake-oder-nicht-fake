import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAnswer, rankPlayers } from '../server/scoring.js';

test('richtige Antworten erhalten linearen Zeitbonus und gedeckelten Serienbonus', () => {
  const score = (elapsedMs, previousStreak = 0) => scoreAnswer({ correct: true, durationMs: 20000, elapsedMs, previousStreak });
  assert.deepEqual(score(0), { elapsedMs: 0, streak: 1, base: 1000, speed: 500, series: 0, points: 1500 });
  assert.equal(score(10000).points, 1250);
  assert.equal(score(20000).points, 1000);
  assert.equal(score(10000, 1).points, 1350);
  assert.equal(score(0, 20).points, 1900);
  assert.equal(score(-1000).speed, 500);
  assert.equal(score(999999).speed, 0);
});
test('falsche Antworten geben keine Boni und setzen die Trefferfolge zurück', () => {
  assert.deepEqual(scoreAnswer({ correct: false, durationMs: 20000, elapsedMs: 1, previousStreak: 10 }),
    { elapsedMs: 1, streak: 0, base: 0, speed: 0, series: 0, points: 0 });
});
test('bei gleichen Punkten entscheiden Treffer und dann Zeit; identische Werte teilen den Rang', () => {
  const players = ['A', 'B', 'C', 'D'].map(id => ({ id, nickname: id }));
  const answers = [
    { player_id: 'A', points: 1500, elapsed_ms: 100, streak: 1 },
    { player_id: 'B', points: 750, elapsed_ms: 500, streak: 1 },
    { player_id: 'B', points: 750, elapsed_ms: 500, streak: 2 },
    { player_id: 'C', points: 750, elapsed_ms: 500, streak: 1 },
    { player_id: 'C', points: 750, elapsed_ms: 500, streak: 2 },
    { player_id: 'D', points: 750, elapsed_ms: 300, streak: 1 },
    { player_id: 'D', points: 750, elapsed_ms: 300, streak: 2 }
  ];
  const ranking = rankPlayers(players, answers);
  assert.deepEqual(ranking.map(p => [p.id, p.rank]), [['D', 1], ['B', 2], ['C', 2], ['A', 4]]);
});
