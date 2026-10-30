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
      deck_json TEXT NOT NULL, join_base TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL, nickname TEXT NOT NULL, joined_at INTEGER NOT NULL,
      UNIQUE(room_id, nickname COLLATE NOCASE)
    );
    CREATE TABLE IF NOT EXISTS answers (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL, choice TEXT NOT NULL CHECK(choice IN ('ai', 'human')),
      points INTEGER NOT NULL CHECK(points IN (0, 1000)), answered_at INTEGER NOT NULL,
      PRIMARY KEY(player_id, question_id)
    );
    CREATE INDEX IF NOT EXISTS players_room ON players(room_id);
  `);
  return db;
}
