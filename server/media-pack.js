// One-time switch to the media-only quiz. Room snapshots and uploaded files stay intact.
export function applyMediaPack(db, deck) {
  const key = 'simple_media_pack_20261030';
  if (db.prepare('SELECT 1 FROM quiz_meta WHERE key=?').get(key)) return { changed: false };
  const previous = db.prepare('SELECT * FROM question_bank ORDER BY position,id').all();
  const currentIds = new Set(deck.questions.map(q => q.id));
  const changed = previous.length !== currentIds.size || previous.some(row => !currentIds.has(row.id));
  db.exec('BEGIN IMMEDIATE');
  try {
    if (changed) {
      db.prepare('INSERT INTO quiz_meta(key,value) VALUES(?,?)').run('bank_archive_before_simple_20261030', JSON.stringify({ archivedAt: new Date().toISOString(), rows: previous }));
      db.exec('DELETE FROM question_bank');
      const insert = db.prepare('INSERT INTO question_bank(id,question_json,position) VALUES(?,?,?)');
      deck.questions.forEach((q, i) => insert.run(q.id, JSON.stringify(q), i));
    }
    db.prepare('INSERT INTO quiz_meta(key,value) VALUES(?,?)').run(key, deck.id);
    db.exec('COMMIT');
    return { changed, questionCount: deck.questions.length, archivedQuestions: changed ? previous.length : 0 };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
