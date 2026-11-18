import { colunasDaFonte, db, fonteDa, type ColunasDaFonte, type Fonte, type TipoMidia } from "../../db";
import { publishImage } from "../instagram";

/**
 * Scheduler próprio (a Meta não tem agendamento nativo — PRD §4.3b).
 * Tick a cada 30 s; container criado só na hora de publicar.
 */
export function startScheduler() {
  setInterval(tick, 30_000);
}

interface Devida {
  id: number;
  media_type: TipoMidia;
  jpeg_path: string;
  legenda: string | null;
}

async function tick() {
  const devidas = db
    .query("SELECT id, post_id, arte_id, media_type, jpeg_path, legenda FROM queue WHERE status = 'pending' AND publish_at <= datetime('now')")
    .all() as (Devida & ColunasDaFonte)[];

  for (const item of devidas) {
    const fonte = fonteDa(item);
    const nome = fonte.tipo === "post" ? `post ${fonte.postId}` : `arte ${fonte.arteId}`;
    db.query("UPDATE queue SET status = 'publishing' WHERE id = ?").run(item.id);
    try {
      if (!item.jpeg_path) throw new Error("Arquivo da arte não encontrado");
      const igId = await publishImage({ fonte, jpegPath: item.jpeg_path, mediaType: item.media_type, caption: item.legenda ?? undefined });
      db.query("UPDATE queue SET status = 'done' WHERE id = ?").run(item.id);
      if (fonte.tipo === "post") db.query("UPDATE posts SET status = 'published' WHERE id = ?").run(fonte.postId);
      console.log(`publicado no Instagram (${item.media_type}), ${nome}, id ${igId}`);
    } catch (err: any) {
      // Nunca falha em silêncio (US-6)
      db.query("UPDATE queue SET status = 'failed', error = ? WHERE id = ?").run(String(err), item.id);
      if (fonte.tipo === "post") db.query("UPDATE posts SET status = 'failed' WHERE id = ?").run(fonte.postId);
      console.error(`falha ao publicar (${item.media_type}), ${nome}:`, err);
    }
  }
}

export function listQueue() {
  return db
    .query(
      `SELECT q.id, q.media_type, q.publish_at, p.brief
       FROM queue q LEFT JOIN posts p ON p.id = q.post_id
       WHERE q.status = 'pending' ORDER BY q.publish_at`,
    )
    .all() as { id: number; media_type: "IMAGE" | "STORIES"; publish_at: string; brief: string | null }[];
}

export function cancelQueueItem(id: number): boolean {
  const r = db.query("UPDATE queue SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id);
  return r.changes > 0;
}

/** O que entra na fila: de onde veio, a mídia, o JPEG já pronto e a legenda (só IMAGE). */
export interface PecaDaFila {
  fonte: Fonte;
  midia: TipoMidia;
  jpegPath: string;
  legenda: string | null;
}

/** publishAt no formato do SQLite, "AAAA-MM-DD HH:MM:SS" em UTC (db.sqliteDe), que o tick compara com datetime('now'). Devolve o id da fila. */
export function enqueue(peca: PecaDaFila, publishAt: string): number {
  const { id } = db
    .query("INSERT INTO queue (post_id, arte_id, media_type, publish_at, jpeg_path, legenda) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .get(...colunasDaFonte(peca.fonte), peca.midia, publishAt, peca.jpegPath, peca.legenda) as { id: number };
  if (peca.fonte.tipo === "post") db.query("UPDATE posts SET status = 'scheduled' WHERE id = ?").run(peca.fonte.postId);
  return id;
}
