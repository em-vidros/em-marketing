import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import type { UIMessage } from "ai";
import type { BotId } from "../agent/bots";

mkdirSync("data", { recursive: true });
export const db = new Database(process.env.DB_PATH ?? "data/em-marketing.db");

db.run(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- Uma conversa com um bot. post_id é o post em andamento dela (agent/post.ts).
-- user_id é o dono (tabela user do better-auth); NULL nas conversas do script de
-- terminal, que nenhum usuário enxerga. mensagens é o UIMessage[] da conversa em JSON.
CREATE TABLE IF NOT EXISTS conversas (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  post_id INTEGER REFERENCES posts(id),
  user_id TEXT,
  titulo TEXT,
  mensagens TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Uma delegação do Chefe a um especialista (agent/tarefas.ts). conversa_id é a
-- conversa do Chefe; mensagens é o UIMessage[] do especialista em JSON.
CREATE TABLE IF NOT EXISTS tarefas (
  id TEXT PRIMARY KEY,
  conversa_id TEXT NOT NULL REFERENCES conversas(id),
  bot_id TEXT NOT NULL,
  pedido TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('na_fila','trabalhando','concluida','falhou')),
  mensagens TEXT NOT NULL DEFAULT '[]',
  resumo TEXT,
  erro TEXT,
  criada_em INTEGER NOT NULL,     -- epoch ms
  atualizada_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tarefas_conversa ON tarefas(conversa_id, criada_em);
CREATE INDEX IF NOT EXISTS tarefas_status ON tarefas(status);

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
  path TEXT NOT NULL,
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
addColumn("conversas", "user_id", "user_id TEXT");
addColumn("conversas", "titulo", "titulo TEXT");
addColumn("conversas", "mensagens", "mensagens TEXT NOT NULL DEFAULT '[]'");
db.run("CREATE INDEX IF NOT EXISTS conversas_usuario ON conversas(user_id, updated_at)");

function dropColumn(tabela: string, coluna: string) {
  const cols = db.query(`PRAGMA table_info(${tabela})`).all() as { name: string }[];
  if (cols.some((c) => c.name === coluna)) db.run(`ALTER TABLE ${tabela} DROP COLUMN ${coluna}`);
}
// O Telegram saiu: chat_id e file_id não têm mais origem, e conversations era a
// memória do bot por chat_id.
dropColumn("posts", "chat_id");
dropColumn("fotos", "chat_id");
dropColumn("fotos", "file_id");
db.run("DROP TABLE IF EXISTS conversations");

export function newMediaId(path: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  db.query("INSERT INTO media (id, path) VALUES (?, ?)").run(id, path);
  return id;
}

// Leituras das telas Atividade e Biblioteca (server/rotas.ts).

/** Um id /media vivo para o arquivo. Reaproveita o que já existe para não criar uma linha por leitura. */
export function midiaDoCaminho(path: string): string {
  const existente = db.query("SELECT id FROM media WHERE path = ? AND expired = 0 LIMIT 1").get(path) as { id: string } | null;
  return existente?.id ?? newMediaId(path);
}

export type Pilar = "PROVA" | "AUTORIDADE" | "GENTE" | "MARCA";
export type StatusPost = "draft" | "generated" | "chosen" | "archived" | "scheduled" | "published" | "failed";
export type Formato = "feed" | "stories" | "ambos";
export type TipoMidia = "IMAGE" | "STORIES";

interface ColunasDoPost {
  arts: string | null;
  chosen: number | null;
}

/** URLs /media das artes, com a escolhida primeiro. */
function artesDo({ arts, chosen }: ColunasDoPost): string[] {
  const artes = (arts ? JSON.parse(arts) : []) as { variant: number; path: string }[];
  const ordem = [...artes].sort((a, b) => Number(b.variant === chosen) - Number(a.variant === chosen));
  return ordem.map((a) => `/media/${midiaDoCaminho(a.path)}`);
}

const capaDo = (p: ColunasDoPost): string | null => artesDo(p)[0] ?? null;

/** "2026-10-15 21:00:00" (UTC, sem fuso, como o SQLite grava) para ISO com Z. */
const isoDoSqlite = (s: string) => `${s.replace(" ", "T")}Z`;

/** Uma peça da Biblioteca. `conversaId` é a conversa do usuário que trabalhou nela, se houver. */
export interface Peca {
  id: number;
  headline: string | null;
  legenda: string | null;
  tema: string | null;
  pilar: Pilar | null;
  formato: Formato | null;
  status: StatusPost;
  criadaEm: string;
  artes: string[];
  conversaId: string | null;
}

export function pecasDoUsuario(userId: string): Peca[] {
  const linhas = db
    .query(
      `SELECT p.id, p.headline, p.legenda, p.brief, p.pilar, p.formato, p.status, p.created_at, p.arts, p.chosen,
         (SELECT c.id FROM conversas c WHERE c.post_id = p.id AND c.user_id = ? ORDER BY c.updated_at DESC LIMIT 1) AS conversa_id
       FROM posts p ORDER BY p.created_at DESC, p.id DESC`,
    )
    .all(userId) as (ColunasDoPost & {
    id: number;
    headline: string | null;
    legenda: string | null;
    brief: string | null;
    pilar: Pilar | null;
    formato: Formato | null;
    status: StatusPost;
    created_at: string;
    conversa_id: string | null;
  })[];
  return linhas.map((r) => ({
    id: r.id,
    headline: r.headline,
    legenda: r.legenda,
    tema: r.brief ? ((JSON.parse(r.brief) as { tema?: string }).tema ?? null) : null,
    pilar: r.pilar,
    formato: r.formato,
    status: r.status ?? "draft",
    criadaEm: isoDoSqlite(r.created_at),
    artes: artesDo(r),
    conversaId: r.conversa_id,
  }));
}

export type StatusFila = "pending" | "publishing" | "done" | "failed" | "cancelled";

/** Uma linha da fila de publicação que ainda não saiu. */
export interface Agendamento {
  id: number;
  postId: number;
  headline: string | null;
  pilar: Pilar | null;
  tipo: TipoMidia;
  publicarEm: string;
  status: Exclude<StatusFila, "done" | "cancelled">;
  erro: string | null;
  capa: string | null;
}

export function agendamentos(): Agendamento[] {
  const linhas = db
    .query(
      `SELECT q.id, q.post_id, q.media_type, q.publish_at, q.status, q.error, p.headline, p.pilar, p.arts, p.chosen
       FROM queue q JOIN posts p ON p.id = q.post_id
       WHERE q.status IN ('pending', 'publishing', 'failed') ORDER BY q.publish_at`,
    )
    .all() as (ColunasDoPost & {
    id: number;
    post_id: number;
    media_type: TipoMidia;
    publish_at: string;
    status: Agendamento["status"];
    error: string | null;
    headline: string | null;
    pilar: Pilar | null;
  })[];
  return linhas.map((r) => ({
    id: r.id,
    postId: r.post_id,
    headline: r.headline,
    pilar: r.pilar,
    tipo: r.media_type,
    publicarEm: isoDoSqlite(r.publish_at),
    status: r.status,
    erro: r.error,
    capa: capaDo(r),
  }));
}

/** Uma mídia que saiu no Instagram. */
export interface Publicacao {
  id: number;
  postId: number;
  headline: string | null;
  pilar: Pilar | null;
  tipo: TipoMidia;
  permalink: string | null;
  publicadaEm: string;
  capa: string | null;
}

export function publicacoesRecentes(limite = 50): Publicacao[] {
  const linhas = db
    .query(
      `SELECT u.id, u.post_id, u.media_type, u.permalink, u.published_at, p.headline, p.pilar, p.arts, p.chosen
       FROM publicacoes u JOIN posts p ON p.id = u.post_id ORDER BY u.published_at DESC LIMIT ?`,
    )
    .all(limite) as (ColunasDoPost & {
    id: number;
    post_id: number;
    media_type: TipoMidia;
    permalink: string | null;
    published_at: string;
    headline: string | null;
    pilar: Pilar | null;
  })[];
  return linhas.map((r) => ({
    id: r.id,
    postId: r.post_id,
    headline: r.headline,
    pilar: r.pilar,
    tipo: r.media_type,
    permalink: r.permalink,
    publicadaEm: isoDoSqlite(r.published_at),
    capa: capaDo(r),
  }));
}

/**
 * Meia-noite de hoje em São Paulo, em epoch ms. O Brasil não tem horário de verão
 * desde 2019, então o fuso é sempre -03:00.
 */
export function inicioDoDia(agora = Date.now()): number {
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
  return Date.parse(`${dia}T00:00:00-03:00`);
}

/** Uma tarefa que terminou, bem ou mal. */
export interface TarefaFeita {
  id: string;
  conversaId: string;
  botId: BotId;
  pedido: string;
  status: "concluida" | "falhou";
  resumo: string | null;
  erro: string | null;
  terminadaEm: number;
}

/** Tarefas terminadas nas conversas do usuário, no intervalo [desde, ate), mais recentes primeiro. */
export function tarefasFeitas(userId: string, desde: number, ate: number, limite = 100): TarefaFeita[] {
  const linhas = db
    .query(
      `SELECT t.id, t.conversa_id, t.bot_id, t.pedido, t.status, t.resumo, t.erro, t.atualizada_em
       FROM tarefas t JOIN conversas c ON c.id = t.conversa_id
       WHERE c.user_id = ? AND t.status IN ('concluida', 'falhou') AND t.atualizada_em >= ? AND t.atualizada_em < ?
       ORDER BY t.atualizada_em DESC LIMIT ?`,
    )
    .all(userId, desde, ate, limite) as {
    id: string;
    conversa_id: string;
    bot_id: BotId;
    pedido: string;
    status: TarefaFeita["status"];
    resumo: string | null;
    erro: string | null;
    atualizada_em: number;
  }[];
  return linhas.map((r) => ({
    id: r.id,
    conversaId: r.conversa_id,
    botId: r.bot_id,
    pedido: r.pedido,
    status: r.status,
    resumo: r.resumo,
    erro: r.erro,
    terminadaEm: r.atualizada_em,
  }));
}

/** Tarefa na fila ou em andamento, com a última mensagem do especialista para mostrar o passo atual. */
export interface TarefaEmCurso {
  id: string;
  conversaId: string;
  botId: BotId;
  pedido: string;
  status: "na_fila" | "trabalhando";
  criadaEm: number;
  ultima: UIMessage | null;
}

export function tarefasEmCurso(userId: string): TarefaEmCurso[] {
  const linhas = db
    .query(
      `SELECT t.id, t.conversa_id, t.bot_id, t.pedido, t.status, t.criada_em, t.mensagens
       FROM tarefas t JOIN conversas c ON c.id = t.conversa_id
       WHERE c.user_id = ? AND t.status IN ('na_fila', 'trabalhando') ORDER BY t.criada_em DESC`,
    )
    .all(userId) as {
    id: string;
    conversa_id: string;
    bot_id: BotId;
    pedido: string;
    status: TarefaEmCurso["status"];
    criada_em: number;
    mensagens: string;
  }[];
  return linhas.map((r) => {
    const mensagens = JSON.parse(r.mensagens) as UIMessage[];
    return {
      id: r.id,
      conversaId: r.conversa_id,
      botId: r.bot_id,
      pedido: r.pedido,
      status: r.status,
      criadaEm: r.criada_em,
      ultima: mensagens.findLast((m) => m.role === "assistant") ?? null,
    };
  });
}

/** Um publicar_agora ou agendar_publicacao parado em approval-requested numa conversa do usuário. */
export interface AprovacaoPendente {
  conversaId: string;
  titulo: string;
  acao: "publicar_agora" | "agendar_publicacao";
  tipo: TipoMidia | null;
  publicarEm: string | null;
  headline: string | null;
  pilar: Pilar | null;
  capa: string | null;
}

export function aprovacoesPendentes(userId: string): AprovacaoPendente[] {
  // O LIKE só poupa o JSON.parse das conversas sem nenhum pedido em aberto; o filtro de verdade é o das partes.
  const linhas = db
    .query(
      `SELECT c.id, c.titulo, c.mensagens, p.headline, p.pilar, p.arts, p.chosen
       FROM conversas c LEFT JOIN posts p ON p.id = c.post_id
       WHERE c.user_id = ? AND c.mensagens LIKE '%approval-requested%' ORDER BY c.updated_at DESC`,
    )
    .all(userId) as (ColunasDoPost & {
    id: string;
    titulo: string | null;
    mensagens: string;
    headline: string | null;
    pilar: Pilar | null;
  })[];
  type ParteLida = { type: string; state?: string; input?: { media_type?: TipoMidia; publish_at?: string } };
  return linhas.flatMap((r) =>
    (JSON.parse(r.mensagens) as { parts: ParteLida[] }[])
      .flatMap((m) => m.parts)
      .filter((p) => (p.type === "tool-publicar_agora" || p.type === "tool-agendar_publicacao") && p.state === "approval-requested")
      .map((p) => ({
        conversaId: r.id,
        titulo: r.titulo ?? "Conversa nova",
        acao: p.type.slice(5) as AprovacaoPendente["acao"],
        tipo: p.input?.media_type ?? null,
        publicarEm: p.input?.publish_at ?? null,
        headline: r.headline,
        pilar: r.pilar,
        capa: capaDo(r),
      })),
  );
}

/** GET /api/atividade/agora */
export interface Agora {
  trabalhando: TarefaEmCurso[];
  esperando: AprovacaoPendente[];
  concluidas: TarefaFeita[];
}

/** GET /api/atividade/historico */
export interface Historico {
  tarefas: TarefaFeita[];
  publicacoes: Publicacao[];
}
