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
  brief TEXT,                     -- JSON {pilar, tema, angulo, data, precisaFotoReal}
  pilar TEXT,                     -- §12.1: PROVA|AUTORIDADE|GENTE|MARCA (cota do mês)
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

-- Uma linha por mídia efetivamente publicada. É a única chave que liga uma peça
-- deste sistema ao objeto que existe no Instagram — sem ela nenhuma métrica é
-- atribuível a um post, e isso não tem conserto retroativo: a Graph API não
-- devolve "qual das minhas mídias veio deste brief".
-- Um post pode gerar duas publicações (IMAGE do feed + STORIES), por isso a
-- tabela é separada de posts em vez de uma coluna.
CREATE TABLE IF NOT EXISTS publicacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE','STORIES')),
  ig_media_id TEXT NOT NULL,
  permalink TEXT,
  published_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS publicacoes_ig_media_id ON publicacoes(ig_media_id);

-- Banco de fotos reais (§8.2). A política proíbe gerar produto, obra, fábrica e
-- pessoas — sem um lugar para as fotos de verdade, a proibição vira paralisia e
-- o caminho de menor resistência volta a ser gerar por IA.
CREATE TABLE IF NOT EXISTS fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  file_id TEXT,                   -- file_id do Telegram (reenvio barato)
  descricao TEXT,                 -- o que a foto mostra, em português
  produto TEXT,                   -- box, guarda-corpo, espelho, fachada, ACM...
  unidade TEXT,                   -- Raposa, Imperatriz, Teresina...
  contexto TEXT,                  -- obra | fabrica | loja | equipe | produto
  tags TEXT,                      -- lista separada por vírgula, para busca
  largura INTEGER,
  altura INTEGER,
  usos INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Migrações para bancos criados antes destas colunas.
// CREATE TABLE IF NOT EXISTS não altera tabela existente.
function addColumn(tabela: string, coluna: string, ddl: string) {
  const cols = db.query(`PRAGMA table_info(${tabela})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === coluna)) db.run(`ALTER TABLE ${tabela} ADD COLUMN ${ddl}`);
}
addColumn("posts", "pilar", "pilar TEXT"); // §12.1, cota do mês

export function newMediaId(path: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  db.query("INSERT INTO media (id, path) VALUES (?, ?)").run(id, path);
  return id;
}
