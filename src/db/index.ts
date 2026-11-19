import { statSync } from "node:fs";
import type { UIMessage } from "ai";
import type { BotId } from "../agent/bots";
import { ehUrl } from "../armazem";
import { q, transacao } from "../v2/banco";

/**
 * As tabelas do fluxo de posts, da fila e das conversas, no mesmo Postgres de src/v2.
 * Datas de texto ficam como "AAAA-MM-DD HH:MM:SS" em UTC (utcDe), epoch ms em double precision.
 * Roda em todo boot: só cria o que falta. A trava impede dois boots ao mesmo tempo (Vercel) de criar a mesma tabela.
 */
export async function criarTabelas(): Promise<void> {
  await transacao(async () => {
    await q`SELECT pg_advisory_xact_lock(4207)`;

    await q`CREATE TABLE IF NOT EXISTS posts (
      id serial PRIMARY KEY,
      brief text,                     -- JSON {pilar, tema, angulo, data, precisaFotoReal}
      pilar text,                     -- §12.1: PROVA|AUTORIDADE|GENTE|MARCA (cota do mês)
      formato text CHECK (formato IN ('feed','stories','ambos')),
      headline text,
      legenda text,
      arts text,                      -- JSON [{variant, style, path, problemas}]
      chosen integer,                 -- 1..3
      story_path text,
      status text DEFAULT 'draft',    -- draft|generated|chosen|scheduled|published|failed
      created_at text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
    )`;

    // Uma conversa com um bot. post_id é o post em andamento dela (agent/post.ts).
    // user_id é o dono (tabela user do better-auth); NULL nas conversas do script de
    // terminal, que nenhum usuário enxerga. mensagens é o UIMessage[] da conversa em JSON.
    await q`CREATE TABLE IF NOT EXISTS conversas (
      id text PRIMARY KEY,
      bot_id text NOT NULL,
      post_id integer REFERENCES posts(id),
      user_id text,
      titulo text,
      mensagens text NOT NULL DEFAULT '[]',
      created_at text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
      updated_at text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
      arquivada_em double precision,  -- epoch ms; NULL = na lista principal
      apagada_em double precision     -- epoch ms; NULL = viva. O boot remove de vez depois de 30 dias.
    )`;
    await q`CREATE INDEX IF NOT EXISTS conversas_usuario ON conversas(user_id, updated_at)`;

    // Uma delegação do Chefe a um especialista (agent/tarefas.ts). conversa_id é a
    // conversa do Chefe; mensagens é o UIMessage[] do especialista em JSON.
    await q`CREATE TABLE IF NOT EXISTS tarefas (
      id text PRIMARY KEY,
      conversa_id text NOT NULL REFERENCES conversas(id),
      bot_id text NOT NULL,
      pedido text NOT NULL,
      status text NOT NULL CHECK (status IN ('na_fila','trabalhando','concluida','falhou')),
      mensagens text NOT NULL DEFAULT '[]',
      resumo text,
      erro text,
      criada_em double precision NOT NULL,     -- epoch ms
      atualizada_em double precision NOT NULL
    )`;
    await q`CREATE INDEX IF NOT EXISTS tarefas_conversa ON tarefas(conversa_id, criada_em)`;
    await q`CREATE INDEX IF NOT EXISTS tarefas_status ON tarefas(status)`;

    // queue e publicacoes apontam para exatamente uma fonte: um post do fluxo antigo ou uma arte do
    // estúdio (uuid de artes de src/v2, guardado como texto e sem REFERENCES).
    await q`CREATE TABLE IF NOT EXISTS queue (
      id serial PRIMARY KEY,
      post_id integer REFERENCES posts(id),
      arte_id text,
      media_type text NOT NULL CHECK (media_type IN ('IMAGE','STORIES')),
      publish_at text NOT NULL,       -- "AAAA-MM-DD HH:MM:SS" em UTC (utcDe)
      status text DEFAULT 'pending',  -- pending|publishing|done|failed|cancelled
      error text,
      jpeg_path text NOT NULL,        -- o JPEG que sai, fixado no agendamento
      legenda text,                   -- só IMAGE; a API rejeita legenda em STORIES
      CHECK ((post_id IS NULL) <> (arte_id IS NULL))
    )`;

    await q`CREATE TABLE IF NOT EXISTS media (
      id text PRIMARY KEY,            -- opaco (crypto random)
      path text NOT NULL,
      expired integer DEFAULT 0,
      mtime double precision          -- mtime do arquivo quando a URL foi criada (urlDaMidia)
    )`;

    // Uma linha por gravação da config de um bot (agent/config.ts). Só cresce: a versão
    // atual é a de maior id, e voltar a uma antiga grava uma linha nova com o texto dela.
    await q`CREATE TABLE IF NOT EXISTS versoes_bot (
      id serial PRIMARY KEY,
      bot_id text NOT NULL,
      nome text NOT NULL,
      descricao text NOT NULL,
      modelo text NOT NULL,
      prompt text NOT NULL,
      criada_em double precision NOT NULL,     -- epoch ms
      autor text NOT NULL             -- e-mail de quem gravou
    )`;
    await q`CREATE INDEX IF NOT EXISTS versoes_bot_bot ON versoes_bot(bot_id, id)`;
    // NULL é o padrão do bot: o código para os fixos, a primeira versão para os criados.
    // Assim uma mudança nas regras do código chega aos fixos que só tiveram o prompt editado.
    await q`ALTER TABLE versoes_bot ADD COLUMN IF NOT EXISTS setor text`;
    await q`ALTER TABLE versoes_bot ADD COLUMN IF NOT EXISTS regras text`;
    await q`ALTER TABLE versoes_bot ADD COLUMN IF NOT EXISTS tools text`; // JSON ToolName[]
    await q`ALTER TABLE versoes_bot ADD COLUMN IF NOT EXISTS marca boolean`;

    // Os bots que a equipe criou. Os fixos ficam no código (agent/bots.ts). A config editável
    // fica em versoes_bot, como a dos fixos; aqui só o que não muda: a aparência e quem criou.
    await q`CREATE TABLE IF NOT EXISTS bots (
      id text PRIMARY KEY,
      forma text NOT NULL,
      cor text NOT NULL,
      criado_por text NOT NULL,
      criado_em double precision NOT NULL,   -- epoch ms
      apagado_em double precision           -- epoch ms; as conversas dele continuam legíveis
    )`;

    // A memória de cada bot, a mesma para a equipe toda. Entra no prompt de todo turno.
    await q`CREATE TABLE IF NOT EXISTS memorias_bot (
      bot_id text PRIMARY KEY,
      texto text NOT NULL,
      atualizada_em double precision NOT NULL,   -- epoch ms
      autor text                                -- e-mail; NULL quando o próprio bot gravou com lembrar
    )`;

    // Uma linha por mídia efetivamente publicada. É a única chave que liga uma peça
    // deste sistema ao objeto que existe no Instagram: sem ela nenhuma métrica é
    // atribuível a um post, e a Graph API não devolve "qual das minhas mídias veio deste brief".
    // Um post pode gerar duas publicações (IMAGE do feed + STORIES), por isso a
    // tabela é separada de posts em vez de uma coluna.
    await q`CREATE TABLE IF NOT EXISTS publicacoes (
      id serial PRIMARY KEY,
      post_id integer REFERENCES posts(id),
      arte_id text,
      media_type text NOT NULL CHECK (media_type IN ('IMAGE','STORIES')),
      ig_media_id text NOT NULL,
      permalink text,
      published_at text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
      CHECK ((post_id IS NULL) <> (arte_id IS NULL))
    )`;
    await q`CREATE UNIQUE INDEX IF NOT EXISTS publicacoes_ig_media_id ON publicacoes(ig_media_id)`;

    // Banco de fotos reais (§8.2). A política proíbe gerar produto, obra, fábrica e
    // pessoas; sem um lugar para as fotos de verdade, a proibição vira paralisia e
    // o caminho de menor resistência volta a ser gerar por IA.
    await q`CREATE TABLE IF NOT EXISTS fotos (
      id serial PRIMARY KEY,
      path text NOT NULL,
      descricao text,                 -- o que a foto mostra, em português
      produto text,                   -- box, guarda-corpo, espelho, fachada, ACM...
      unidade text,                   -- Raposa, Imperatriz, Teresina...
      contexto text,                  -- obra | fabrica | loja | equipe | produto
      tags text,                      -- lista separada por vírgula, para busca
      largura integer,
      altura integer,
      usos integer DEFAULT 0,
      created_at text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
    )`;

    // A ideia do que postar num dia, antes de existir post (.specs/project/CALENDARIO.md).
    // Da equipe, como a fila: todo usuário vê e edita. conversa_id é a conversa com o Chefe
    // aberta por "Criar com o Chefe"; sem REFERENCES porque a lixeira remove conversas de vez.
    await q`CREATE TABLE IF NOT EXISTS pautas (
      id serial PRIMARY KEY,
      dia text NOT NULL,              -- AAAA-MM-DD em America/Sao_Paulo
      hora text,                      -- HH:MM; NULL = o dia inteiro
      titulo text NOT NULL,
      pilar text CHECK (pilar IN ('PROVA','AUTORIDADE','GENTE','MARCA')),
      nota text NOT NULL DEFAULT '',
      conversa_id text,
      criada_por text NOT NULL,       -- id do usuário (better-auth)
      criada_em double precision NOT NULL,     -- epoch ms
      atualizada_em double precision NOT NULL,
      apagada_em double precision     -- epoch ms; NULL = viva
    )`;
    await q`CREATE INDEX IF NOT EXISTS pautas_dia ON pautas(dia)`;

    // Uma linha por chamada às APIs de IA (domain/uso.ts). em é epoch ms.
    await q`CREATE TABLE IF NOT EXISTS uso_api (
      id serial PRIMARY KEY,
      em double precision NOT NULL,
      origem text NOT NULL,
      modelo text NOT NULL,
      entrada integer NOT NULL DEFAULT 0,
      saida integer NOT NULL DEFAULT 0,
      imagens integer NOT NULL DEFAULT 0
    )`;
    await q`CREATE INDEX IF NOT EXISTS uso_api_em ON uso_api(em)`;

    // Valores soltos que o servidor grava em tempo de execução, como as credenciais do login da Meta.
    await q`CREATE TABLE IF NOT EXISTS configuracoes (
      chave text PRIMARY KEY,
      valor text NOT NULL
    )`;
  });
}

/** A primeira linha, ou null. */
export const primeira = async <T>(linhas: Promise<T[]>): Promise<T | null> => (await linhas)[0] ?? null;

/**
 * `fn` em cada item, um de cada vez. É como as listas chamam urlDaMidia: duas chamadas em paralelo
 * para o mesmo arquivo não achariam a linha uma da outra e criariam dois ids para ele.
 */
export async function emOrdem<T, R>(itens: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const feitos: R[] = [];
  for (const item of itens) feitos.push(await fn(item));
  return feitos;
}

export async function newMediaId(path: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  await q`INSERT INTO media (id, path) VALUES (${id}, ${path})`;
  return id;
}

/**
 * A URL de um arquivo para a tela mostrar a imagem. No Blob a própria URL serve, que é pública.
 * No disco é /media/:id, reaproveitando a linha viva do mesmo arquivo enquanto ele não muda, para
 * não criar uma linha por leitura. Uma arte refeita é gravada no mesmo caminho; o mtime novo dá
 * um id novo, e o navegador não mostra a do cache.
 */
export async function urlDaMidia(path: string): Promise<string> {
  if (ehUrl(path)) return path;
  const mtime = statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? null;
  const viva = await primeira(q<{ id: string }>`SELECT id FROM media WHERE path = ${path} AND mtime IS NOT DISTINCT FROM ${mtime}::double precision AND expired = 0 LIMIT 1`);
  if (viva) return `/media/${viva.id}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  await q`INSERT INTO media (id, path, mtime) VALUES (${id}, ${path}, ${mtime})`;
  return `/media/${id}`;
}

// Leituras das telas Atividade e Biblioteca (server/rotas.ts).

export type Pilar = "PROVA" | "AUTORIDADE" | "GENTE" | "MARCA";
export type StatusPost = "draft" | "generated" | "chosen" | "scheduled" | "published" | "failed";
export type Formato = "feed" | "stories" | "ambos";
export type TipoMidia = "IMAGE" | "STORIES";

/** De onde sai o que a fila publica: um post do fluxo antigo ou uma arte do estúdio (src/v2). */
export type Fonte = { tipo: "post"; postId: number } | { tipo: "arte"; arteId: string };

/** post_id e arte_id de uma linha de queue ou publicacoes: o CHECK da tabela garante exatamente uma. */
export type ColunasDaFonte = { post_id: number; arte_id: null } | { post_id: null; arte_id: string };

/** Os valores de post_id e arte_id, nesta ordem, para gravar. */
export const colunasDaFonte = (f: Fonte): [number | null, string | null] => (f.tipo === "post" ? [f.postId, null] : [null, f.arteId]);

export const fonteDa = (r: ColunasDaFonte): Fonte => (r.arte_id === null ? { tipo: "post", postId: r.post_id } : { tipo: "arte", arteId: r.arte_id });

export interface ColunasDoPost {
  arts: string | null;
  chosen: number | null;
}

/** URLs das artes, com a escolhida primeiro. */
function artesDo({ arts, chosen }: ColunasDoPost): Promise<string[]> {
  const artes = (arts ? JSON.parse(arts) : []) as { variant: number; path: string }[];
  const ordem = [...artes].sort((a, b) => Number(b.variant === chosen) - Number(a.variant === chosen));
  return emOrdem(ordem, (a) => urlDaMidia(a.path));
}

export const capaDo = async (p: ColunasDoPost): Promise<string | null> => (await artesDo(p))[0] ?? null;

/** posts.headline guarda o JSON {headline, apoio} que agent/post.ts grava; a tela mostra só o texto.
 * Linhas do pipeline antigo guardam o texto puro, e uma linha dessas não pode derrubar a lista inteira. */
export function headlineDo(coluna: string | null): string | null {
  if (!coluna) return null;
  try {
    const valor: unknown = JSON.parse(coluna);
    if (valor && typeof valor === "object" && typeof (valor as { headline?: unknown }).headline === "string") return (valor as { headline: string }).headline;
  } catch {}
  return coluna;
}

/** "2026-10-15 21:00:00" (UTC, sem fuso, como as colunas de data em texto guardam) para ISO com Z. */
export const isoDoUtc = (s: string) => `${s.replace(" ", "T")}Z`;

/**
 * Epoch ms para o formato de queue.publish_at e publicacoes.published_at. O scheduler compara
 * publish_at como texto, então outro formato (o ISO com T e Z) quebraria a comparação.
 */
export const utcDe = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

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

export async function pecasDoUsuario(userId: string): Promise<Peca[]> {
  const linhas = await q<
    ColunasDoPost & {
      id: number;
      headline: string | null;
      legenda: string | null;
      brief: string | null;
      pilar: Pilar | null;
      formato: Formato | null;
      status: StatusPost;
      created_at: string;
      conversa_id: string | null;
    }
  >`SELECT p.id, p.headline, p.legenda, p.brief, p.pilar, p.formato, p.status, p.created_at, p.arts, p.chosen,
      (SELECT c.id FROM conversas c WHERE c.post_id = p.id AND c.user_id = ${userId} AND c.apagada_em IS NULL ORDER BY c.updated_at DESC LIMIT 1) AS conversa_id
    FROM posts p ORDER BY p.created_at DESC, p.id DESC`;
  return emOrdem(linhas, async (r) => ({
    id: r.id,
    headline: headlineDo(r.headline),
    legenda: r.legenda,
    tema: r.brief ? ((JSON.parse(r.brief) as { tema?: string }).tema ?? null) : null,
    pilar: r.pilar,
    formato: r.formato,
    status: r.status ?? "draft",
    criadaEm: isoDoUtc(r.created_at),
    artes: await artesDo(r),
    conversaId: r.conversa_id,
  }));
}

export type StatusFila = "pending" | "publishing" | "done" | "failed" | "cancelled";

/** Uma linha da fila de publicação que ainda não saiu. */
export interface Agendamento {
  id: number;
  fonte: Fonte;
  headline: string | null;
  pilar: Pilar | null;
  tipo: TipoMidia;
  publicarEm: string;
  status: Exclude<StatusFila, "done" | "cancelled">;
  erro: string | null;
  capa: string | null;
}

/** Arte do estúdio não tem headline nem pilar aqui; a capa é o JPEG que vai sair. */
export async function agendamentos(): Promise<Agendamento[]> {
  const linhas = await q<
    ColunasDoPost &
      ColunasDaFonte & {
        id: number;
        media_type: TipoMidia;
        publish_at: string;
        status: Agendamento["status"];
        error: string | null;
        jpeg_path: string;
        headline: string | null;
        pilar: Pilar | null;
      }
  >`SELECT q.id, q.post_id, q.arte_id, q.media_type, q.publish_at, q.status, q.error, q.jpeg_path, p.headline, p.pilar, p.arts, p.chosen
    FROM queue q LEFT JOIN posts p ON p.id = q.post_id
    WHERE q.status IN ('pending', 'publishing', 'failed') ORDER BY q.publish_at`;
  return emOrdem(linhas, async (r) => ({
    id: r.id,
    fonte: fonteDa(r),
    headline: headlineDo(r.headline),
    pilar: r.pilar,
    tipo: r.media_type,
    publicarEm: isoDoUtc(r.publish_at),
    status: r.status,
    erro: r.error,
    capa: r.arte_id === null ? await capaDo(r) : await urlDaMidia(r.jpeg_path),
  }));
}

/** Uma mídia que saiu no Instagram. */
export interface Publicacao {
  id: number;
  fonte: Fonte;
  headline: string | null;
  pilar: Pilar | null;
  tipo: TipoMidia;
  permalink: string | null;
  publicadaEm: string;
  capa: string | null;
}

export async function publicacoesRecentes(limite = 50): Promise<Publicacao[]> {
  const linhas = await q<
    ColunasDoPost &
      ColunasDaFonte & {
        id: number;
        media_type: TipoMidia;
        permalink: string | null;
        published_at: string;
        headline: string | null;
        pilar: Pilar | null;
      }
  >`SELECT u.id, u.post_id, u.arte_id, u.media_type, u.permalink, u.published_at, p.headline, p.pilar, p.arts, p.chosen
    FROM publicacoes u LEFT JOIN posts p ON p.id = u.post_id ORDER BY u.published_at DESC LIMIT ${limite}`;
  return emOrdem(linhas, async (r) => ({
    id: r.id,
    fonte: fonteDa(r),
    headline: headlineDo(r.headline),
    pilar: r.pilar,
    tipo: r.media_type,
    permalink: r.permalink,
    publicadaEm: isoDoUtc(r.published_at),
    capa: await capaDo(r),
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
export async function tarefasFeitas(userId: string, desde: number, ate: number, limite = 100): Promise<TarefaFeita[]> {
  const linhas = await q<{
    id: string;
    conversa_id: string;
    bot_id: BotId;
    pedido: string;
    status: TarefaFeita["status"];
    resumo: string | null;
    erro: string | null;
    atualizada_em: number;
  }>`SELECT t.id, t.conversa_id, t.bot_id, t.pedido, t.status, t.resumo, t.erro, t.atualizada_em
    FROM tarefas t JOIN conversas c ON c.id = t.conversa_id
    WHERE c.user_id = ${userId} AND c.apagada_em IS NULL AND t.status IN ('concluida', 'falhou')
      AND t.atualizada_em >= ${desde} AND t.atualizada_em < ${ate}
    ORDER BY t.atualizada_em DESC LIMIT ${limite}`;
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

export async function tarefasEmCurso(userId: string): Promise<TarefaEmCurso[]> {
  const linhas = await q<{
    id: string;
    conversa_id: string;
    bot_id: BotId;
    pedido: string;
    status: TarefaEmCurso["status"];
    criada_em: number;
    mensagens: string;
  }>`SELECT t.id, t.conversa_id, t.bot_id, t.pedido, t.status, t.criada_em, t.mensagens
    FROM tarefas t JOIN conversas c ON c.id = t.conversa_id
    WHERE c.user_id = ${userId} AND c.apagada_em IS NULL AND t.status IN ('na_fila', 'trabalhando') ORDER BY t.criada_em DESC`;
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

export async function aprovacoesPendentes(userId: string): Promise<AprovacaoPendente[]> {
  // O LIKE só poupa o JSON.parse das conversas sem nenhum pedido em aberto; o filtro de verdade é o das partes.
  const linhas = await q<
    ColunasDoPost & {
      id: string;
      titulo: string | null;
      mensagens: string;
      headline: string | null;
      pilar: Pilar | null;
    }
  >`SELECT c.id, c.titulo, c.mensagens, p.headline, p.pilar, p.arts, p.chosen
    FROM conversas c LEFT JOIN posts p ON p.id = c.post_id
    WHERE c.user_id = ${userId} AND c.apagada_em IS NULL AND c.mensagens LIKE '%approval-requested%' ORDER BY c.updated_at DESC`;
  type ParteLida = { type: string; state?: string; input?: { media_type?: TipoMidia; publish_at?: string } };
  const porConversa = await emOrdem(linhas, async (r) => {
    const pedidos = (JSON.parse(r.mensagens) as { parts: ParteLida[] }[])
      .flatMap((m) => m.parts)
      .filter((p) => (p.type === "tool-publicar_agora" || p.type === "tool-agendar_publicacao") && p.state === "approval-requested");
    const capa = pedidos.length ? await capaDo(r) : null;
    return pedidos.map(
      (p): AprovacaoPendente => ({
        conversaId: r.id,
        titulo: r.titulo ?? "Conversa nova",
        acao: p.type.slice(5) as AprovacaoPendente["acao"],
        tipo: p.input?.media_type ?? null,
        publicarEm: p.input?.publish_at ?? null,
        headline: headlineDo(r.headline),
        pilar: r.pilar,
        capa,
      }),
    );
  });
  return porConversa.flat();
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
