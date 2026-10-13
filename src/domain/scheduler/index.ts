import { db } from "../../db";
import { publishImage } from "../instagram";

/**
 * Scheduler próprio (a Meta não tem agendamento nativo — PRD §4.3b).
 * Tick a cada 30 s; container criado só na hora de publicar.
 */
export function startScheduler() {
  setInterval(tick, 30_000);
}

async function tick() {
  const due = db
    .query(
      `SELECT q.*, p.legenda, p.arts, p.chosen, p.story_path
       FROM queue q JOIN posts p ON p.id = q.post_id
       WHERE q.status = 'pending' AND q.publish_at <= datetime('now')`,
    )
    .all() as any[];

  for (const item of due) {
    db.query("UPDATE queue SET status = 'publishing' WHERE id = ?").run(item.id);
    try {
      const jpegPath =
        item.media_type === "STORIES" && item.story_path
          ? item.story_path
          : JSON.parse(item.arts ?? "[]").find((a: any) => a.variant === item.chosen)?.path;
      if (!jpegPath) throw new Error("Arquivo da arte não encontrado");

      const igId = await publishImage({
        postId: item.post_id,
        jpegPath,
        mediaType: item.media_type,
        caption: item.media_type === "IMAGE" ? item.legenda : undefined,
      });
      db.query("UPDATE queue SET status = 'done' WHERE id = ?").run(item.id);
      db.query("UPDATE posts SET status = 'published' WHERE id = ?").run(item.post_id);
      console.log(`publicado no Instagram (${item.media_type}), post ${item.post_id}, id ${igId}`);
    } catch (err: any) {
      // Nunca falha em silêncio (US-6)
      db.query("UPDATE queue SET status = 'failed', error = ? WHERE id = ?").run(String(err), item.id);
      db.query("UPDATE posts SET status = 'failed' WHERE id = ?").run(item.post_id);
      console.error(`falha ao publicar (${item.media_type}), post ${item.post_id}:`, err);
    }
  }
}

export function listQueue() {
  return db
    .query(
      `SELECT q.id, q.media_type, q.publish_at, p.brief
       FROM queue q JOIN posts p ON p.id = q.post_id
       WHERE q.status = 'pending' ORDER BY q.publish_at`,
    )
    .all() as { id: number; media_type: "IMAGE" | "STORIES"; publish_at: string; brief: string | null }[];
}

export function cancelQueueItem(id: number): boolean {
  const r = db.query("UPDATE queue SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id);
  return r.changes > 0;
}

/** publishAt no formato do SQLite, "AAAA-MM-DD HH:MM:SS" em UTC (db.sqliteDe), que o tick compara com datetime('now'). Devolve o id da fila. */
export function enqueue(postId: number, mediaType: "IMAGE" | "STORIES", publishAt: string): number {
  const { id } = db.query("INSERT INTO queue (post_id, media_type, publish_at) VALUES (?, ?, ?) RETURNING id").get(postId, mediaType, publishAt) as { id: number };
  db.query("UPDATE posts SET status = 'scheduled' WHERE id = ?").run(postId);
  return id;
}
