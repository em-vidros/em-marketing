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
