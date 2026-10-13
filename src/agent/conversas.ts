import type { UIMessage } from "ai";
import { db } from "../db";
import type { BotId } from "./bots";

/** Uma conversa do site. Pertence a um usuário e a um bot; as mensagens ficam em `mensagens`. */
export interface Conversa {
  id: string;
  botId: BotId;
  titulo: string;
  postId: number | null;
  criadaEm: string;
  atualizadaEm: string;
}

interface Linha {
  id: string;
  bot_id: BotId;
  titulo: string | null;
  post_id: number | null;
  created_at: string;
  updated_at: string;
}

const COLUNAS = "id, bot_id, titulo, post_id, created_at, updated_at";

const daLinha = (r: Linha): Conversa => ({
  id: r.id,
  botId: r.bot_id,
  titulo: r.titulo ?? "Conversa nova",
  postId: r.post_id,
  criadaEm: r.created_at,
  atualizadaEm: r.updated_at,
});

/** Só devolve a conversa se ela for do usuário. Conversa de outro usuário e conversa inexistente dão o mesmo null. */
export function conversaDoUsuario(userId: string, id: string): Conversa | null {
  const r = db.query(`SELECT ${COLUNAS} FROM conversas WHERE id = ? AND user_id = ?`).get(id, userId) as Linha | null;
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

export function conversasDoUsuario(userId: string): Conversa[] {
  return (db.query(`SELECT ${COLUNAS} FROM conversas WHERE user_id = ? ORDER BY updated_at DESC`).all(userId) as Linha[]).map(daLinha);
}

export function mensagensDaConversa(id: string): UIMessage[] {
  const r = db.query("SELECT mensagens FROM conversas WHERE id = ?").get(id) as { mensagens: string } | null;
  return r ? (JSON.parse(r.mensagens) as UIMessage[]) : [];
}

export function gravarMensagens(id: string, mensagens: UIMessage[]): void {
  db.query("UPDATE conversas SET mensagens = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(mensagens), id);
}
