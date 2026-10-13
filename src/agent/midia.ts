import { db, newMediaId } from "../db";

/**
 * A URL /media/:id de um arquivo local, para o painel mostrar a imagem. Reaproveita a
 * linha viva do mesmo arquivo: refazer a tool ou reler a tarefa não cria outra.
 */
export function urlDaMidia(path: string): string {
  const viva = db.query("SELECT id FROM media WHERE path = ? AND expired = 0 LIMIT 1").get(path) as { id: string } | null;
  return `/media/${viva?.id ?? newMediaId(path)}`;
}
