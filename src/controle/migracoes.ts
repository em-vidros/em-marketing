/**
 * Migrações ordenadas por PRAGMA user_version. Cada uma roda numa transação e
 * grava a versão nova no mesmo commit; rodar duas vezes é no-op.
 */

import type { Banco } from "./db";
import { emTransacao } from "./db";

/** Ordem de descarte: queue referencia posts, então cai antes dele. */
const TABELAS_LEGADAS = ["queue", "media", "calendar_sent", "conversations", "posts"] as const;

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

/**
 * As oito entidades da Fase 1 (DESIGN.md, Entidades). events, approvals e
 * artifact_versions são append-only por gatilho, não por disciplina.
 */
const SCHEMA_FASE_1 = `
CREATE TABLE brand_versions (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  brandbook TEXT NOT NULL,
  voz TEXT NOT NULL,
  tokens TEXT NOT NULL,
  estilos TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('instagram','blog')),
  estado TEXT NOT NULL,
  versao INTEGER NOT NULL DEFAULT 0,
  rodada INTEGER NOT NULL DEFAULT 1,
  chat_id INTEGER NOT NULL,
  solicitante_id INTEGER NOT NULL,
  pedido_json TEXT NOT NULL,
  brand_version_id TEXT NOT NULL REFERENCES brand_versions(id),
  revisao_pendente TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_runs(id),
  tipo TEXT NOT NULL,
  papel TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendente'
    CHECK (estado IN ('pendente','reivindicada','concluida','falhou','revisao_manual','cancelada')),
  rodada INTEGER NOT NULL,
  chave_idempotencia TEXT NOT NULL UNIQUE,
  entrada_json TEXT,
  lease_epoca INTEGER NOT NULL DEFAULT 0,
  lease_dono TEXT,
  lease_expira_em TEXT,
  tentativas INTEGER NOT NULL DEFAULT 0,
  max_tentativas INTEGER NOT NULL DEFAULT 3,
  saida_json TEXT,
  erro TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_fila ON tasks (estado, papel);

CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_runs(id),
  linhagem_id TEXT NOT NULL,
  versao INTEGER NOT NULL,
  papel TEXT NOT NULL
    CHECK (papel IN ('direcao','prototipo','master','preview','copy','artigo','qa')),
  formato TEXT CHECK (formato IN ('feed','stories')),
  rodada INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  media_tipo TEXT NOT NULL,
  tamanho INTEGER NOT NULL,
  caminho TEXT NOT NULL,
  derivada_de TEXT REFERENCES artifact_versions(id),
  tarefa_id TEXT REFERENCES tasks(id),
  meta_json TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (linhagem_id, versao)
);
CREATE INDEX idx_artifact_versions_workflow ON artifact_versions (workflow_id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_runs(id),
  stage TEXT NOT NULL CHECK (stage IN ('prototype','package','copy','angle')),
  rodada INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted','adjustment_requested','rejected')),
  artifact_version_ids TEXT NOT NULL,
  opcao TEXT,
  notas TEXT,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workflow_id, stage, rodada)
);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_runs(id),
  artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  chave TEXT NOT NULL UNIQUE,
  canal TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'enviando'
    CHECK (estado IN ('enviando','confirmada','indeterminada','falhou')),
  file_id TEXT,
  hash_conferido TEXT,
  erro TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE idempotency_keys (
  chave TEXT PRIMARY KEY,
  resultado_json TEXT,
  erro TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  concluido_em TEXT
);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  ator TEXT NOT NULL,
  dados_json TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_workflow ON events (workflow_id, seq);

CREATE TRIGGER events_sem_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events é append-only'); END;
CREATE TRIGGER events_sem_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events é append-only'); END;
CREATE TRIGGER approvals_sem_update BEFORE UPDATE ON approvals
BEGIN SELECT RAISE(ABORT, 'approvals é append-only'); END;
CREATE TRIGGER approvals_sem_delete BEFORE DELETE ON approvals
BEGIN SELECT RAISE(ABORT, 'approvals é append-only'); END;
CREATE TRIGGER artifact_versions_sem_update BEFORE UPDATE ON artifact_versions
BEGIN SELECT RAISE(ABORT, 'artifact_versions é append-only'); END;
CREATE TRIGGER artifact_versions_sem_delete BEFORE DELETE ON artifact_versions
BEGIN SELECT RAISE(ABORT, 'artifact_versions é append-only'); END;
`;

/**
 * O que a Fase 2 soma: a conversa por chat, durável porque um reinício não pode
 * perder o tema que o Ricardo já digitou, e o par de colunas que a política
 * repetirSeFalhou consulta. `reservado_em` é o instante da reserva em curso,
 * reescrito a cada tentativa nova; `criado_em` continua sendo a primeira vez que
 * a chave apareceu.
 */
const SCHEMA_FASE_2 = `
CREATE TABLE conversas (
  chat_id INTEGER PRIMARY KEY,
  estado_json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE idempotency_keys ADD COLUMN tentativas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE idempotency_keys ADD COLUMN reservado_em TEXT;
`;

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
  {
    versao: 2,
    aplicar(db) {
      db.run(SCHEMA_FASE_1);
    },
  },
  /**
   * O bot v1 sai da árvore junto com esta migração, e as tabelas dele saem
   * junto. Sem guarda contra linha existente: o v1 escreve em `conversations` a
   * cada mensagem que processa, e um boot travado por causa de uma linha de
   * conversa velha custaria mais que a linha vale. A contagem vai para o log.
   */
  {
    versao: 3,
    aplicar(db) {
      const contagens = TABELAS_LEGADAS.map((t) => {
        const { n } = db.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
        db.run(`DROP TABLE ${t}`);
        return `${t}=${n}`;
      });
      console.log(`migração 003 descartou o schema do bot v1: ${contagens.join(" ")}`);
      db.run(SCHEMA_FASE_2);
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
