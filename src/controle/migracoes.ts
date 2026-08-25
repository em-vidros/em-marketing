/**
 * Migrações ordenadas por PRAGMA user_version. Cada uma roda numa transação e
 * grava a versão nova no mesmo commit; rodar duas vezes é no-op.
 */

import type { Banco } from "./db";
import { emTransacao } from "./db";

const TABELAS_LEGADAS = ["conversations", "posts", "queue", "media", "calendar_sent"] as const;

/** DDL verbatim de src/db/index.ts mais a calendar_sent de src/scheduler/calendar.ts. */
const SCHEMA_LEGADO = `
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

CREATE TABLE IF NOT EXISTS calendar_sent (year INTEGER, mmdd TEXT, PRIMARY KEY (year, mmdd));
`;

interface Migracao {
  versao: number;
  aplicar(db: Banco): void;
}

const MIGRACOES: Migracao[] = [
  {
    versao: 1,
    aplicar(db) {
      db.run(SCHEMA_LEGADO);
      const contagens = TABELAS_LEGADAS.map((t) => {
        const { n } = db.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
        return `${t}=${n}`;
      });
      console.log(`migração 001 adotou o schema do bot v1: ${contagens.join(" ")}`);
    },
  },
];

export const VERSAO_ALVO = MIGRACOES[MIGRACOES.length - 1]!.versao;

export function migrar(db: Banco): void {
  for (const m of MIGRACOES) {
    const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
    if (m.versao <= user_version) continue;
    emTransacao(db, () => {
      m.aplicar(db);
      db.run(`PRAGMA user_version = ${m.versao}`);
    });
  }
}
