import type { UIMessage } from "ai";
import { primeira, utcDe } from "../db";
import { q, transacao } from "../v2/banco";
import type { BotId } from "./bots";

/**
 * Uma conversa do site. Pertence a um usuário e a um bot; as mensagens ficam em `mensagens`.
 * Arquivada sai da lista principal e continua aberta. Apagada sai do banco na hora (apagarConversa).
 */
export interface Conversa {
  id: string;
  botId: BotId;
  titulo: string;
  postId: number | null;
  criadaEm: string;
  atualizadaEm: string;
  /** epoch ms; null quando está na lista principal. */
  arquivadaEm: number | null;
}

/** PATCH /api/conversas/:id */
export interface MudancaConversa {
  titulo?: string;
  arquivada?: boolean;
}

interface Linha {
  id: string;
  bot_id: BotId;
  titulo: string | null;
  post_id: number | null;
  created_at: string;
  updated_at: string;
  arquivada_em: number | null;
}

const daLinha = (r: Linha): Conversa => ({
  id: r.id,
  botId: r.bot_id,
  titulo: r.titulo ?? "Conversa nova",
  postId: r.post_id,
  criadaEm: r.created_at,
  atualizadaEm: r.updated_at,
  arquivadaEm: r.arquivada_em,
});

/** Só devolve a conversa se ela for do usuário. Os dois casos dão o mesmo null. */
export async function conversaDoUsuario(userId: string, id: string): Promise<Conversa | null> {
  const r = await primeira(
    q<Linha>`SELECT id, bot_id, titulo, post_id, created_at, updated_at, arquivada_em FROM conversas WHERE id = ${id} AND user_id = ${userId}`,
  );
  return r ? daLinha(r) : null;
}

/**
 * Cria a conversa se o id ainda não existe e devolve a do usuário. Se o id já é
 * de outro usuário, o INSERT não faz nada e a leitura devolve null.
 */
export async function abrirConversaDoUsuario(userId: string, id: string, botId: BotId, titulo: string): Promise<Conversa | null> {
  await q`INSERT INTO conversas (id, bot_id, user_id, titulo) VALUES (${id}, ${botId}, ${userId}, ${titulo}) ON CONFLICT (id) DO NOTHING`;
  return conversaDoUsuario(userId, id);
}

/** As conversas vivas do usuário: as da lista principal, ou só as arquivadas. */
export async function conversasDoUsuario(userId: string, arquivadas = false): Promise<Conversa[]> {
  const linhas = await q<Linha>`SELECT id, bot_id, titulo, post_id, created_at, updated_at, arquivada_em FROM conversas
    WHERE user_id = ${userId} AND (arquivada_em IS NOT NULL) = ${arquivadas} ORDER BY updated_at DESC`;
  return linhas.map(daLinha);
}

/** As conversas vivas do usuário com um bot, arquivadas inclusive, da mais recente para trás. */
export async function conversasDoBot(userId: string, botId: BotId, offset: number, limite: number): Promise<Conversa[]> {
  const linhas = await q<Linha>`SELECT id, bot_id, titulo, post_id, created_at, updated_at, arquivada_em FROM conversas
    WHERE user_id = ${userId} AND bot_id = ${botId} ORDER BY updated_at DESC, id LIMIT ${limite} OFFSET ${offset}`;
  return linhas.map(daLinha);
}

/** Renomeia e arquiva. Arquivar de novo mantém a data da primeira vez. Não mexe em updated_at, que ordena a lista. */
export async function mudarConversa(userId: string, id: string, { titulo, arquivada }: MudancaConversa): Promise<Conversa | null> {
  if (!(await conversaDoUsuario(userId, id))) return null;
  if (titulo !== undefined) await q`UPDATE conversas SET titulo = ${titulo} WHERE id = ${id}`;
  if (arquivada !== undefined)
    await q`UPDATE conversas SET arquivada_em = CASE WHEN ${arquivada}::boolean THEN COALESCE(arquivada_em, ${Date.now()}::double precision) END WHERE id = ${id}`;
  return conversaDoUsuario(userId, id);
}

/**
 * O que DELETE /api/conversas/:id tirou do banco: a linha da conversa e as tarefas dela, como estavam.
 * O Desfazer manda isto de volta para POST /api/conversas/:id/restaurar; o servidor não guarda cópia.
 */
export interface ConversaExcluida {
  conversa: { id: string; botId: BotId; titulo: string | null; postId: number | null; mensagens: string; criadaEm: string; atualizadaEm: string; arquivadaEm: number | null };
  tarefas: {
    id: string;
    botId: BotId;
    pedido: string;
    status: string;
    mensagens: string;
    resumo: string | null;
    erro: string | null;
    criadaEm: number;
    atualizadaEm: number;
  }[];
}

/** Remove a conversa e as tarefas dela do banco. Posts e artes ficam: são da Biblioteca. null se a conversa não é do usuário. */
export function apagarConversa(userId: string, id: string): Promise<ConversaExcluida | null> {
  return transacao(async () => {
    const conversa = await primeira(
      q<ConversaExcluida["conversa"]>`SELECT id, bot_id AS "botId", titulo, post_id AS "postId", mensagens, created_at AS "criadaEm",
        updated_at AS "atualizadaEm", arquivada_em AS "arquivadaEm" FROM conversas WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`,
    );
    if (!conversa) return null;
    const tarefas = await q<ConversaExcluida["tarefas"][number]>`DELETE FROM tarefas WHERE conversa_id = ${id}
      RETURNING id, bot_id AS "botId", pedido, status, mensagens, resumo, erro, criada_em AS "criadaEm", atualizada_em AS "atualizadaEm"`;
    await q`DELETE FROM conversas WHERE id = ${id}`;
    return { conversa, tarefas };
  });
}

/**
 * Desfaz o apagar: grava de volta o que apagarConversa devolveu, sempre como do usuário que pede.
 * Se o id já existe (restaurar duas vezes), não muda nada e devolve a conversa se ela for dele.
 */
export function restaurarConversa(userId: string, { conversa: c, tarefas }: ConversaExcluida): Promise<Conversa | null> {
  return transacao(async () => {
    const criada = await q`INSERT INTO conversas (id, bot_id, post_id, user_id, titulo, mensagens, created_at, updated_at, arquivada_em)
      VALUES (${c.id}, ${c.botId}, ${c.postId}, ${userId}, ${c.titulo}, ${c.mensagens}, ${c.criadaEm}, ${c.atualizadaEm}, ${c.arquivadaEm})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (criada.length > 0)
      for (const t of tarefas)
        await q`INSERT INTO tarefas (id, conversa_id, bot_id, pedido, status, mensagens, resumo, erro, criada_em, atualizada_em)
          VALUES (${t.id}, ${c.id}, ${t.botId}, ${t.pedido}, ${t.status}, ${t.mensagens}, ${t.resumo}, ${t.erro}, ${t.criadaEm}, ${t.atualizadaEm})
          ON CONFLICT (id) DO NOTHING`;
    return conversaDoUsuario(userId, c.id);
  });
}

/**
 * Remove as conversas que a lixeira antiga só marcou como apagadas, e as tarefas delas.
 * Hoje o apagar já remove na hora; isto limpa o que ficou de antes. Posts e artes ficam.
 */
export function purgarConversasApagadas(): Promise<number> {
  return transacao(async () => {
    await q`DELETE FROM tarefas WHERE conversa_id IN (SELECT id FROM conversas WHERE apagada_em IS NOT NULL)`;
    return (await q`DELETE FROM conversas WHERE apagada_em IS NOT NULL RETURNING id`).length;
  });
}

export async function mensagensDaConversa(id: string): Promise<UIMessage[]> {
  const r = await primeira(q<{ mensagens: string }>`SELECT mensagens FROM conversas WHERE id = ${id}`);
  return r ? (JSON.parse(r.mensagens) as UIMessage[]) : [];
}

export async function gravarMensagens(id: string, mensagens: UIMessage[]): Promise<void> {
  await q`UPDATE conversas SET mensagens = ${JSON.stringify(mensagens)}, updated_at = ${utcDe(Date.now())} WHERE id = ${id}`;
}

/** Gravar o histórico sem mexer em updated_at: apagar ou restaurar uma mensagem não muda a ordem da lista. */
async function trocarMensagens(id: string, mensagens: UIMessage[]): Promise<void> {
  await q`UPDATE conversas SET mensagens = ${JSON.stringify(mensagens)} WHERE id = ${id}`;
}

/**
 * Só um turno do bot por conversa, em qualquer instância da Vercel. O turno grava o histórico inteiro quando
 * termina; uma mensagem apagada ou editada no meio dele voltaria nessa gravação.
 * O aluguel dura mais que os 300 s que a função pode rodar: uma instância que morre sem soltar a conversa
 * deixa de travá-la quando ele vence.
 */
const ALUGUEL_MS = 330_000;
const VIGIA_MS = 1000;
/** Quanto a mensagem seguinte espera um turno que recebeu Parar soltar a conversa, antes de dar 409. */
const ESPERA_PARADA_MS = 5000;

export const AINDA_RESPONDENDO = "O bot ainda está respondendo nesta conversa. Espere a resposta terminar.";
export const PARADO_PELO_USUARIO = "Parado pelo usuário antes de terminar.";

export interface Turno {
  /** Aborta quando alguém aperta Parar nesta conversa (pararTurno), de qualquer instância. */
  sinal: AbortSignal;
  /** Solta a conversa. Se o aluguel venceu e outro turno pegou a conversa, não solta o dele. */
  terminar(): Promise<void>;
}

/** null se a conversa já tem um turno em andamento. Quem recebe o turno chama terminar no fim. */
export async function comecarTurno(id: string): Promise<Turno | null> {
  const desiste = Date.now() + ESPERA_PARADA_MS;
  for (;;) {
    const agora = Date.now();
    const ate = agora + ALUGUEL_MS;
    const pegou = await q`UPDATE conversas SET turno_ate = ${ate}, parar_em = NULL
      WHERE id = ${id} AND (turno_ate IS NULL OR turno_ate < ${agora}) RETURNING id`;
    if (pegou.length > 0) return vigiar(id, ate);
    const parando = await primeira(q`SELECT 1 FROM conversas WHERE id = ${id} AND parar_em IS NOT NULL`);
    if (!parando || agora > desiste) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function vigiar(id: string, ate: number): Turno {
  const parar = new AbortController();
  const vigia = setInterval(() => {
    // Uma leitura que falha não para o turno; a próxima tenta de novo.
    primeira(q`SELECT 1 FROM conversas WHERE id = ${id} AND turno_ate = ${ate} AND parar_em IS NOT NULL`).then(
      (parado) => parado && parar.abort(),
      () => {},
    );
  }, VIGIA_MS);
  return {
    sinal: parar.signal,
    async terminar() {
      clearInterval(vigia);
      await q`UPDATE conversas SET turno_ate = NULL, parar_em = NULL WHERE id = ${id} AND turno_ate = ${ate}`;
    },
  };
}

/** Pede ao turno em andamento que pare. false se a conversa não é do usuário. */
export async function pararTurno(userId: string, id: string): Promise<boolean> {
  return (await q`UPDATE conversas SET parar_em = ${Date.now()} WHERE id = ${id} AND user_id = ${userId} RETURNING id`).length > 0;
}

export type Recusa = { ok: false; status: 404 | 409; erro: string };

const NAO_ENCONTRADA: Recusa = { ok: false, status: 404, erro: "Não encontrado." };
const OCUPADA: Recusa = { ok: false, status: 409, erro: AINDA_RESPONDENDO };

/**
 * Apagar e restaurar mensagens leem o histórico com a linha da conversa travada: um turno que começa no meio
 * espera a transação e já lê o histórico novo. Com um turno em andamento, recusa.
 */
function comHistorico<T>(userId: string, conversaId: string, fn: (mensagens: UIMessage[]) => Promise<T | Recusa>): Promise<T | Recusa> {
  return transacao(async () => {
    const r = await primeira(
      q<{ mensagens: string; ocupada: boolean }>`SELECT mensagens, coalesce(turno_ate >= ${Date.now()}, false) AS ocupada
        FROM conversas WHERE id = ${conversaId} AND user_id = ${userId} FOR UPDATE`,
    );
    if (!r) return NAO_ENCONTRADA;
    if (r.ocupada) return OCUPADA;
    return fn(JSON.parse(r.mensagens) as UIMessage[]);
  });
}

/** O que DELETE /api/conversas/:id/mensagens/:mensagemId tirou e entre quais mensagens estava. O restaurar recebe este mesmo objeto. */
export interface Remocao {
  removidas: UIMessage[];
  depoisDe: string | null;
  antesDe: string | null;
}

/**
 * Apagar a mensagem do usuário tira o turno: ela e as respostas do bot até a próxima mensagem do usuário.
 * Apagar uma mensagem do bot tira só ela. Tarefas, posts, fila e artes ficam como estão.
 */
export function apagarMensagem(userId: string, conversaId: string, mensagemId: string): Promise<({ ok: true } & Remocao) | Recusa> {
  return comHistorico(userId, conversaId, async (mensagens) => {
    const i = mensagens.findIndex((m) => m.id === mensagemId);
    if (i === -1) return NAO_ENCONTRADA;
    const proximaDoUsuario = mensagens.findIndex((m, j) => j > i && m.role === "user");
    const fim = mensagens[i]!.role !== "user" ? i + 1 : proximaDoUsuario === -1 ? mensagens.length : proximaDoUsuario;
    await trocarMensagens(conversaId, mensagens.toSpliced(i, fim - i));
    return { ok: true as const, removidas: mensagens.slice(i, fim), depoisDe: mensagens[i - 1]?.id ?? null, antesDe: mensagens[fim]?.id ?? null };
  });
}

const MUDOU: Recusa = { ok: false, status: 409, erro: "A conversa mudou depois dessas mensagens. Não dá para pôr de volta no mesmo lugar." };

/**
 * Põe de volta o que apagarMensagem tirou, entre depoisDe e antesDe. Se elas já estão lá, não muda nada.
 * Se as vizinhas não estão mais lado a lado, a posição é ambígua e o pedido é recusado.
 */
export function restaurarMensagens(
  userId: string,
  conversaId: string,
  { removidas, depoisDe, antesDe }: Remocao,
): Promise<{ ok: true; mensagens: UIMessage[] } | Recusa> {
  return comHistorico(userId, conversaId, async (mensagens) => {
    const idEm = (j: number) => mensagens[j]?.id ?? null;
    const inicio = depoisDe === null ? 0 : mensagens.findIndex((m) => m.id === depoisDe) + 1;
    if (depoisDe !== null && inicio === 0) return MUDOU;
    const ids = removidas.map((m) => m.id);
    if (ids.every((id, k) => idEm(inicio + k) === id) && idEm(inicio + ids.length) === antesDe) return { ok: true as const, mensagens };
    if (idEm(inicio) !== antesDe || mensagens.some((m) => ids.includes(m.id))) return MUDOU;
    const restauradas = mensagens.toSpliced(inicio, 0, ...removidas);
    await trocarMensagens(conversaId, restauradas);
    return { ok: true as const, mensagens: restauradas };
  });
}
