export const SCORING_VERSION = 'speed-streak-v2';
export const DURATIONS = [15, 20, 25, 30, 45, 60];

export function scoreAnswer({ correct, elapsedMs, durationMs, previousStreak = 0 }) {
  const elapsed = Math.max(0, Math.min(durationMs, Math.round(elapsedMs)));
  const streak = correct ? previousStreak + 1 : 0;
  const base = correct ? 1000 : 0;
  const speed = correct ? Math.round(500 * (1 - elapsed / durationMs)) : 0;
  const series = correct ? Math.min(400, Math.max(0, streak - 1) * 100) : 0;
  return { elapsedMs: elapsed, streak, base, speed, series, points: base + speed + series };
}

function order(a, b) {
  return b.score - a.score || b.correct - a.correct || (a.avgMs ?? Infinity) - (b.avgMs ?? Infinity);
}

export function rankPlayers(players, answers) {
  const rows = players.map(player => {
    const own = answers.filter(a => a.player_id === player.id);
    const correct = own.filter(a => a.points > 0);
    const timed = correct.filter(a => a.elapsed_ms !== null);
    return {
      id: player.id, nickname: player.nickname, room: player.room_id,
      score: own.reduce((sum, a) => sum + a.points, 0), answered: own.length, correct: correct.length,
      avgMs: timed.length ? Math.round(timed.reduce((sum, a) => sum + a.elapsed_ms, 0) / timed.length) : null,
      bestStreak: Math.max(0, ...own.map(a => a.streak || 0)),
      speedBonus: own.reduce((sum, a) => sum + (a.speed_bonus || 0), 0),
      streakBonus: own.reduce((sum, a) => sum + (a.streak_bonus || 0), 0)
    };
  }).sort((a, b) => order(a, b) || a.id.localeCompare(b.id));
  let rank = 1;
  return rows.map((row, i) => {
    if (i && order(row, rows[i - 1]) !== 0) rank = i + 1;
    return { ...row, rank };
  });
}
