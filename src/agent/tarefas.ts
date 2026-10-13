import type { UIMessage } from "ai";
import { db } from "../db";
import type { BotId } from "./bots";

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

function gravar(t: Tarefa): Tarefa {
  db.query(
    `INSERT INTO tarefas (id, conversa_id, bot_id, pedido, status, mensagens, resumo, erro, criada_em, atualizada_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, mensagens = excluded.mensagens, resumo = excluded.resumo,
       erro = excluded.erro, atualizada_em = excluded.atualizada_em`,
  ).run(t.id, t.conversaId, t.botId, t.pedido, t.status, JSON.stringify(t.mensagens), t.resumo, t.erro, t.criadaEm, t.atualizadaEm);
  return t;
}

export function criarTarefa(conversaId: string, botId: BotId, pedido: string, mensagens: UIMessage[]): Tarefa {
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

export const avancarTarefa = (t: Tarefa, m: MudancaTarefa): Tarefa => gravar(transicionarTarefa(t, m));

const COLUNAS_RESUMO = "id, conversa_id, bot_id, pedido, status, resumo, erro, criada_em, atualizada_em";

export function tarefasDaConversa(conversaId: string): ResumoTarefa[] {
  return (
    db.query(`SELECT ${COLUNAS_RESUMO} FROM tarefas WHERE conversa_id = ? ORDER BY criada_em`).all(conversaId) as Omit<Linha, "mensagens">[]
  ).map(resumoDaLinha);
}

export function pegarTarefa(id: string): Tarefa | null {
  const r = db.query("SELECT * FROM tarefas WHERE id = ?").get(id) as Linha | null;
  return r ? { ...resumoDaLinha(r), mensagens: JSON.parse(r.mensagens) as UIMessage[] } : null;
}

/** Tarefas na fila ou em andamento nas conversas do usuário, mais recentes primeiro. */
export function tarefasAtivas(userId: string): ResumoTarefa[] {
  const colunas = COLUNAS_RESUMO.split(", ").map((c) => `t.${c}`).join(", ");
  return (
    db
      .query(
        `SELECT ${colunas} FROM tarefas t JOIN conversas c ON c.id = t.conversa_id
         WHERE c.user_id = ? AND t.status IN (${ATIVOS.map(() => "?").join(",")}) ORDER BY t.criada_em DESC`,
      )
      .all(userId, ...ATIVOS) as Omit<Linha, "mensagens">[]
  ).map(resumoDaLinha);
}
