import type { UIMessage } from "ai";
import { primeira } from "../db";
import { q } from "../v2/banco";
import { ehEspecialista, type BotId } from "./bots";
import { conversasDoBot, type Conversa } from "./conversas";

/**
 * Uma delegação do Chefe a um especialista. O especialista trabalha na conversa
 * do Chefe (mesmo post), mas o trabalho dele fica aqui, não no histórico do Chefe.
 */

export type StatusTarefa = "na_fila" | "trabalhando" | "concluida" | "falhou";

export interface Tarefa {
  id: string;
  conversaId: string;
  botId: BotId;
  pedido: string;
  status: StatusTarefa;
  mensagens: UIMessage[];
  resumo: string | null;
  erro: string | null;
  criadaEm: number;
  atualizadaEm: number;
}

/** O que a lista de tarefas e o painel de Atividade mostram, sem o histórico. */
export type ResumoTarefa = Omit<Tarefa, "mensagens">;

export type MudancaTarefa =
  | { status: "trabalhando"; mensagens?: UIMessage[] }
  | { status: "concluida"; resumo: string; mensagens: UIMessage[] }
  | { status: "falhou"; erro: string; mensagens: UIMessage[] };

/**
 * De quais status cada mudança pode partir. concluida e falhou são finais.
 * trabalhando para trabalhando grava o progresso do especialista a cada passo.
 */
const ORIGEM = {
  trabalhando: ["na_fila", "trabalhando"],
  concluida: ["trabalhando"],
  falhou: ["na_fila", "trabalhando"],
} as const satisfies Record<MudancaTarefa["status"], readonly StatusTarefa[]>;

const ATIVOS = ["na_fila", "trabalhando"] as const satisfies readonly StatusTarefa[];

function transicionarTarefa(t: Tarefa, m: MudancaTarefa, agora = Date.now()): Tarefa {
  if (!(ORIGEM[m.status] as readonly StatusTarefa[]).includes(t.status))
    throw new Error(`Tarefa ${t.id}: ${t.status} não vai para ${m.status}.`);
  return { ...t, ...m, atualizadaEm: agora };
}

interface Linha {
  id: string;
  conversa_id: string;
  bot_id: BotId;
  pedido: string;
  status: StatusTarefa;
  mensagens: string;
  resumo: string | null;
  erro: string | null;
  criada_em: number;
  atualizada_em: number;
}

const resumoDaLinha = (r: Omit<Linha, "mensagens">): ResumoTarefa => ({
  id: r.id,
  conversaId: r.conversa_id,
  botId: r.bot_id,
  pedido: r.pedido,
  status: r.status,
  resumo: r.resumo,
  erro: r.erro,
  criadaEm: r.criada_em,
  atualizadaEm: r.atualizada_em,
});

async function gravar(t: Tarefa): Promise<Tarefa> {
  await q`INSERT INTO tarefas (id, conversa_id, bot_id, pedido, status, mensagens, resumo, erro, criada_em, atualizada_em)
    VALUES (${t.id}, ${t.conversaId}, ${t.botId}, ${t.pedido}, ${t.status}, ${JSON.stringify(t.mensagens)}, ${t.resumo}, ${t.erro}, ${t.criadaEm}, ${t.atualizadaEm})
    ON CONFLICT (id) DO UPDATE SET status = excluded.status, mensagens = excluded.mensagens, resumo = excluded.resumo,
      erro = excluded.erro, atualizada_em = excluded.atualizada_em`;
  return t;
}

export function criarTarefa(conversaId: string, botId: BotId, pedido: string, mensagens: UIMessage[]): Promise<Tarefa> {
  const agora = Date.now();
  return gravar({
    id: crypto.randomUUID(),
    conversaId,
    botId,
    pedido,
    status: "na_fila",
    mensagens,
    resumo: null,
    erro: null,
    criadaEm: agora,
    atualizadaEm: agora,
  });
}

export const avancarTarefa = (t: Tarefa, m: MudancaTarefa): Promise<Tarefa> => gravar(transicionarTarefa(t, m));

export async function tarefasDaConversa(conversaId: string): Promise<ResumoTarefa[]> {
  const linhas = await q<Omit<Linha, "mensagens">>`SELECT id, conversa_id, bot_id, pedido, status, resumo, erro, criada_em, atualizada_em
    FROM tarefas WHERE conversa_id = ${conversaId} ORDER BY criada_em`;
  return linhas.map(resumoDaLinha);
}

export async function pegarTarefa(id: string): Promise<Tarefa | null> {
  const r = await primeira(q<Linha>`SELECT * FROM tarefas WHERE id = ${id}`);
  return r ? { ...resumoDaLinha(r), mensagens: JSON.parse(r.mensagens) as UIMessage[] } : null;
}

/** Tarefas na fila ou em andamento nas conversas do usuário, mais recentes primeiro. */
export async function tarefasAtivas(userId: string): Promise<ResumoTarefa[]> {
  const linhas = await q<Omit<Linha, "mensagens">>`SELECT t.id, t.conversa_id, t.bot_id, t.pedido, t.status, t.resumo, t.erro, t.criada_em, t.atualizada_em
    FROM tarefas t JOIN conversas c ON c.id = t.conversa_id
    WHERE c.user_id = ${userId} AND t.status = ANY(${[...ATIVOS]}::text[]) ORDER BY t.criada_em DESC`;
  return linhas.map(resumoDaLinha);
}

/**
 * GET /api/bots/:id/tarefas. O que o bot fez nas conversas do usuário, do mais recente para trás.
 * Um especialista trabalha em tarefas; o Chefe e os bots criados pela equipe, em conversas. `proximo` é o offset da página seguinte.
 */
export type TrabalhoDoBot =
  | { tipo: "tarefas"; itens: ResumoTarefa[]; proximo: number | null }
  | { tipo: "conversas"; itens: Conversa[]; proximo: number | null };

export async function trabalhoDoBot(userId: string, botId: BotId, offset: number, limite: number): Promise<TrabalhoDoBot> {
  const pagina = <T>(linhas: T[]) => ({ itens: linhas.slice(0, limite), proximo: linhas.length > limite ? offset + limite : null });
  if (!ehEspecialista(botId)) return { tipo: "conversas", ...pagina(await conversasDoBot(userId, botId, offset, limite + 1)) };
  const linhas = await q<Omit<Linha, "mensagens">>`SELECT t.id, t.conversa_id, t.bot_id, t.pedido, t.status, t.resumo, t.erro, t.criada_em, t.atualizada_em
    FROM tarefas t JOIN conversas c ON c.id = t.conversa_id
    WHERE c.user_id = ${userId} AND t.bot_id = ${botId} ORDER BY t.criada_em DESC, t.id LIMIT ${limite + 1} OFFSET ${offset}`;
  return { tipo: "tarefas", ...pagina(linhas.map(resumoDaLinha)) };
}
