import type { UIMessage } from "ai";
import { db } from "../db";
import type { BotId } from "./bots";

/**
 * Uma conversa do site. Pertence a um usuário e a um bot; as mensagens ficam em `mensagens`.
 * Arquivada sai da lista principal e continua aberta. Apagada some de todas as rotas até ser
 * restaurada, e o boot a remove de vez depois de 30 dias (purgarConversasApagadas).
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

const COLUNAS = "id, bot_id, titulo, post_id, created_at, updated_at, arquivada_em";

const daLinha = (r: Linha): Conversa => ({
  id: r.id,
  botId: r.bot_id,
  titulo: r.titulo ?? "Conversa nova",
  postId: r.post_id,
  criadaEm: r.created_at,
  atualizadaEm: r.updated_at,
  arquivadaEm: r.arquivada_em,
});

/** Só devolve a conversa se ela for do usuário e não estiver apagada. Os três casos dão o mesmo null. */
export function conversaDoUsuario(userId: string, id: string): Conversa | null {
  const r = db.query(`SELECT ${COLUNAS} FROM conversas WHERE id = ? AND user_id = ? AND apagada_em IS NULL`).get(id, userId) as Linha | null;
  return r ? daLinha(r) : null;
}

/**
 * Cria a conversa se o id ainda não existe e devolve a do usuário. Se o id já é
 * de outro usuário, o INSERT não faz nada e a leitura devolve null.
 */
export function abrirConversaDoUsuario(userId: string, id: string, botId: BotId, titulo: string): Conversa | null {
  db.query("INSERT INTO conversas (id, bot_id, user_id, titulo) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run(id, botId, userId, titulo);
  return conversaDoUsuario(userId, id);
}

/** As conversas vivas do usuário: as da lista principal, ou só as arquivadas. */
export function conversasDoUsuario(userId: string, arquivadas = false): Conversa[] {
  const filtro = arquivadas ? "arquivada_em IS NOT NULL" : "arquivada_em IS NULL";
  return (
    db.query(`SELECT ${COLUNAS} FROM conversas WHERE user_id = ? AND apagada_em IS NULL AND ${filtro} ORDER BY updated_at DESC`).all(userId) as Linha[]
  ).map(daLinha);
}

/** As conversas vivas do usuário com um bot, arquivadas inclusive, da mais recente para trás. */
export function conversasDoBot(userId: string, botId: BotId, offset: number, limite: number): Conversa[] {
  return (
    db
      .query(`SELECT ${COLUNAS} FROM conversas WHERE user_id = ? AND bot_id = ? AND apagada_em IS NULL ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`)
      .all(userId, botId, limite, offset) as Linha[]
  ).map(daLinha);
}

/** Renomeia e arquiva. Arquivar de novo mantém a data da primeira vez. Não mexe em updated_at, que ordena a lista. */
export function mudarConversa(userId: string, id: string, { titulo, arquivada }: MudancaConversa): Conversa | null {
  if (!conversaDoUsuario(userId, id)) return null;
  if (titulo !== undefined) db.query("UPDATE conversas SET titulo = ? WHERE id = ?").run(titulo, id);
  if (arquivada !== undefined)
    db.query("UPDATE conversas SET arquivada_em = CASE WHEN ? THEN COALESCE(arquivada_em, ?) END WHERE id = ?").run(arquivada, Date.now(), id);
  return conversaDoUsuario(userId, id);
}

/** Marca como apagada. Apagar de novo mantém a data da primeira vez. false se a conversa não é do usuário. */
export function apagarConversa(userId: string, id: string): boolean {
  return db.query("UPDATE conversas SET apagada_em = COALESCE(apagada_em, ?) WHERE id = ? AND user_id = ?").run(Date.now(), id, userId).changes > 0;
}

/** Desfaz o apagar. Restaurar uma conversa viva não muda nada. */
export function restaurarConversa(userId: string, id: string): Conversa | null {
  db.query("UPDATE conversas SET apagada_em = NULL WHERE id = ? AND user_id = ?").run(id, userId);
  return conversaDoUsuario(userId, id);
}

export const PRAZO_DA_LIXEIRA = 30 * 86_400_000;

/** Remove de vez as conversas apagadas há mais de 30 dias e as tarefas delas. Posts e artes ficam: são da Biblioteca. */
export const purgarConversasApagadas = db.transaction((agora: number = Date.now()): number => {
  const limite = agora - PRAZO_DA_LIXEIRA;
  db.query("DELETE FROM tarefas WHERE conversa_id IN (SELECT id FROM conversas WHERE apagada_em < ?)").run(limite);
  return db.query("DELETE FROM conversas WHERE apagada_em < ?").run(limite).changes;
});

export function mensagensDaConversa(id: string): UIMessage[] {
  const r = db.query("SELECT mensagens FROM conversas WHERE id = ?").get(id) as { mensagens: string } | null;
  return r ? (JSON.parse(r.mensagens) as UIMessage[]) : [];
}

export function gravarMensagens(id: string, mensagens: UIMessage[]): void {
  db.query("UPDATE conversas SET mensagens = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(mensagens), id);
}

/** Gravar o histórico sem mexer em updated_at: apagar ou restaurar uma mensagem não muda a ordem da lista. */
function trocarMensagens(id: string, mensagens: UIMessage[]): void {
  db.query("UPDATE conversas SET mensagens = ? WHERE id = ?").run(JSON.stringify(mensagens), id);
}

/**
 * Conversas com um turno do bot em andamento. O turno grava o histórico inteiro quando termina;
 * uma mensagem apagada ou editada no meio dele voltaria nessa gravação. Por isso só um escreve por vez.
 */
const respondendo = new Set<string>();

export const AINDA_RESPONDENDO = "O bot ainda está respondendo nesta conversa. Espere a resposta terminar.";

/** false se a conversa já tem um turno em andamento. Quem recebe true chama terminarTurno no fim. */
export function comecarTurno(id: string): boolean {
  if (respondendo.has(id)) return false;
  respondendo.add(id);
  return true;
}

export function terminarTurno(id: string): void {
  respondendo.delete(id);
}

export type Recusa = { ok: false; status: 404 | 409; erro: string };

const NAO_ENCONTRADA: Recusa = { ok: false, status: 404, erro: "Não encontrado." };
const OCUPADA: Recusa = { ok: false, status: 409, erro: AINDA_RESPONDENDO };

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
export function apagarMensagem(userId: string, conversaId: string, mensagemId: string): ({ ok: true } & Remocao) | Recusa {
  if (!conversaDoUsuario(userId, conversaId)) return NAO_ENCONTRADA;
  if (respondendo.has(conversaId)) return OCUPADA;
  const mensagens = mensagensDaConversa(conversaId);
  const i = mensagens.findIndex((m) => m.id === mensagemId);
  if (i === -1) return NAO_ENCONTRADA;
  const proximaDoUsuario = mensagens.findIndex((m, j) => j > i && m.role === "user");
  const fim = mensagens[i]!.role !== "user" ? i + 1 : proximaDoUsuario === -1 ? mensagens.length : proximaDoUsuario;
  trocarMensagens(conversaId, mensagens.toSpliced(i, fim - i));
  return { ok: true, removidas: mensagens.slice(i, fim), depoisDe: mensagens[i - 1]?.id ?? null, antesDe: mensagens[fim]?.id ?? null };
}

const MUDOU: Recusa = { ok: false, status: 409, erro: "A conversa mudou depois dessas mensagens. Não dá para pôr de volta no mesmo lugar." };

/**
 * Põe de volta o que apagarMensagem tirou, entre depoisDe e antesDe. Se elas já estão lá, não muda nada.
 * Se as vizinhas não estão mais lado a lado, a posição é ambígua e o pedido é recusado.
 */
export function restaurarMensagens(userId: string, conversaId: string, { removidas, depoisDe, antesDe }: Remocao): { ok: true; mensagens: UIMessage[] } | Recusa {
  if (!conversaDoUsuario(userId, conversaId)) return NAO_ENCONTRADA;
  if (respondendo.has(conversaId)) return OCUPADA;
  const mensagens = mensagensDaConversa(conversaId);
  const idEm = (j: number) => mensagens[j]?.id ?? null;
  const inicio = depoisDe === null ? 0 : mensagens.findIndex((m) => m.id === depoisDe) + 1;
  if (depoisDe !== null && inicio === 0) return MUDOU;
  const ids = removidas.map((m) => m.id);
  if (ids.every((id, k) => idEm(inicio + k) === id) && idEm(inicio + ids.length) === antesDe) return { ok: true, mensagens };
  if (idEm(inicio) !== antesDe || mensagens.some((m) => ids.includes(m.id))) return MUDOU;
  const restauradas = mensagens.toSpliced(inicio, 0, ...removidas);
  trocarMensagens(conversaId, restauradas);
  return { ok: true, mensagens: restauradas };
}
