import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
export const db = new Database(process.env.DB_PATH ?? "data/em-marketing.db");

db.run(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS conversations (
  chat_id INTEGER PRIMARY KEY,
  interaction_id TEXT,            -- último interaction do cérebro (memória da conversa)
  post_id INTEGER,                -- post em andamento
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  brief TEXT,                     -- JSON {tipo, tema, angulo, data}
  formato TEXT CHECK (formato IN ('feed','stories','ambos')),
  headline TEXT,
  legenda TEXT,
  arts TEXT,                      -- JSON [{variant, style, path, interactionId}]
  chosen INTEGER,                 -- 1..3
  story_path TEXT,
  linear_issue_id TEXT,
  status TEXT DEFAULT 'draft',    -- draft|generated|chosen|archived|scheduled|published|failed
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE','STORIES')),
  publish_at TEXT NOT NULL,       -- ISO UTC
  status TEXT DEFAULT 'pending',  -- pending|publishing|done|failed|cancelled
  error TEXT
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,            -- opaco (crypto random)
  path TEXT NOT NULL,
  expired INTEGER DEFAULT 0
);
`);

export function newMediaId(path: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  db.query("INSERT INTO media (id, path) VALUES (?, ?)").run(id, path);
  return id;
}
