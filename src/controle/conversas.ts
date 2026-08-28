/**
 * Etapa da conversa por chat. Mora no banco e não na memória porque o Ricardo
 * digita o tema, o processo reinicia e a pergunta seguinte tem que continuar de
 * onde parou. Chat sem linha é `ociosa`, então não existe estado nulo para
 * quem lê.
 */

import type { EstadoConversa } from "../modelos/tipos";
import type { Banco } from "./db";

export const CONVERSA_OCIOSA: EstadoConversa = { etapa: "ociosa" };

export function lerConversa(db: Banco, chatId: number): EstadoConversa {
  const linha = db.query("SELECT estado_json FROM conversas WHERE chat_id = ?").get(chatId) as
    | { estado_json: string }
    | null;
  if (!linha) return CONVERSA_OCIOSA;
  return JSON.parse(linha.estado_json) as EstadoConversa;
}

export function gravarConversa(db: Banco, chatId: number, estado: EstadoConversa): void {
  db.query(
    `INSERT INTO conversas (chat_id, estado_json) VALUES (?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET estado_json = excluded.estado_json,
       atualizado_em = datetime('now')`,
  ).run(chatId, JSON.stringify(estado));
}
