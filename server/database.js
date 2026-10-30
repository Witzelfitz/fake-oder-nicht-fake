import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, host_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      phase TEXT NOT NULL DEFAULT 'lobby', question_index INTEGER NOT NULL DEFAULT -1,
      deadline INTEGER, duration INTEGER NOT NULL, deck_id TEXT NOT NULL,
      deck_json TEXT NOT NULL, join_base TEXT NOT NULL,
      scoring_version TEXT NOT NULL DEFAULT 'classic-v1', started_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL, nickname TEXT NOT NULL, joined_at INTEGER NOT NULL,
      UNIQUE(room_id, nickname COLLATE NOCASE)
    );
    CREATE TABLE IF NOT EXISTS answers (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL, choice TEXT NOT NULL CHECK(choice IN ('ai', 'human')),
      points INTEGER NOT NULL CHECK(points >= 0), answered_at INTEGER NOT NULL,
      elapsed_ms INTEGER, base_points INTEGER NOT NULL DEFAULT 0,
      speed_bonus INTEGER NOT NULL DEFAULT 0, streak_bonus INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(player_id, question_id)
    );
    CREATE INDEX IF NOT EXISTS players_room ON players(room_id);
    CREATE TABLE IF NOT EXISTS question_bank (
      id TEXT PRIMARY KEY, question_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS quiz_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const roomColumns = db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name);
  if (!roomColumns.includes('scoring_version')) db.exec("ALTER TABLE rooms ADD COLUMN scoring_version TEXT NOT NULL DEFAULT 'classic-v1'");
  if (!roomColumns.includes('started_at')) db.exec('ALTER TABLE rooms ADD COLUMN started_at INTEGER');
  const answerColumns = db.prepare('PRAGMA table_info(answers)').all().map(c => c.name);
  if (!answerColumns.includes('elapsed_ms')) {
    // Rebuild the v1 table to remove its fixed 0/1000 CHECK, preserving all results.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE answers_v2 (
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL, choice TEXT NOT NULL CHECK(choice IN ('ai', 'human')),
        points INTEGER NOT NULL CHECK(points >= 0), answered_at INTEGER NOT NULL,
        elapsed_ms INTEGER, base_points INTEGER NOT NULL DEFAULT 0,
        speed_bonus INTEGER NOT NULL DEFAULT 0, streak_bonus INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(player_id, question_id)
      );
      INSERT INTO answers_v2 (player_id, question_id, choice, points, answered_at, base_points)
        SELECT player_id, question_id, choice, points, answered_at, points FROM answers;
      DROP TABLE answers;
      ALTER TABLE answers_v2 RENAME TO answers;
      COMMIT;`);
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  const schema = db.prepare("SELECT value FROM quiz_meta WHERE key = 'schema_version'").get();
  if (Number(schema?.value || 2) < 3) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const columns = db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name);
      for (const [name, definition] of Object.entries({
        mode: "TEXT NOT NULL DEFAULT 'speed-streak-v2'", revision: 'INTEGER NOT NULL DEFAULT 0',
        schema_version: 'INTEGER NOT NULL DEFAULT 1', phase_started_at: 'INTEGER',
        reveal_step: 'INTEGER NOT NULL DEFAULT 0', voting_closed: 'INTEGER NOT NULL DEFAULT 0',
        set_id: "TEXT NOT NULL DEFAULT 'legacy'", audience: "TEXT NOT NULL DEFAULT 'sek1'"
      })) if (!columns.includes(name)) db.exec(`ALTER TABLE rooms ADD COLUMN ${name} ${definition}`);
      db.exec(`CREATE TABLE IF NOT EXISTS responses_v3 (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL, prompt_id TEXT NOT NULL, stage TEXT NOT NULL CHECK(stage IN ('first','final')),
        choice TEXT NOT NULL, confidence INTEGER CHECK(confidence BETWEEN 1 AND 3),
        submitted_at INTEGER NOT NULL, schema_version INTEGER NOT NULL DEFAULT 3,
        PRIMARY KEY(room_id,player_id,case_id,prompt_id,stage)
      );
      CREATE TABLE IF NOT EXISTS room_commands (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        command_id TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT NOT NULL,
        PRIMARY KEY(room_id,command_id)
      );
      CREATE TABLE IF NOT EXISTS publication_snapshots (
        id TEXT PRIMARY KEY, content_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      INSERT INTO quiz_meta (key,value) VALUES ('schema_version','3') ON CONFLICT(key) DO UPDATE SET value='3';
      COMMIT;`);
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  return db;
}
