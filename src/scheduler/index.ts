import { db } from "../db";
import { publishImage } from "../instagram";
import { sendMessage } from "../telegram/api";

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
      `SELECT q.*, p.chat_id, p.legenda, p.arts, p.chosen, p.story_path
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
        jpegPath,
        mediaType: item.media_type,
        caption: item.media_type === "IMAGE" ? item.legenda : undefined,
      });
      db.query("UPDATE queue SET status = 'done' WHERE id = ?").run(item.id);
      db.query("UPDATE posts SET status = 'published' WHERE id = ?").run(item.post_id);
      await sendMessage(item.chat_id, `✅ Publicado no Instagram (${item.media_type}) — id ${igId}`);
    } catch (err: any) {
      // Nunca falha em silêncio (US-6)
      db.query("UPDATE queue SET status = 'failed', error = ? WHERE id = ?").run(String(err), item.id);
      db.query("UPDATE posts SET status = 'failed' WHERE id = ?").run(item.post_id);
      await sendMessage(item.chat_id, `❌ Falha ao publicar (${item.media_type}): ${err.message ?? err}`).catch(() => {});
    }
  }
}

export function listQueue(chatId: number) {
  return db
    .query(
      `SELECT q.id, q.media_type, q.publish_at, p.brief
       FROM queue q JOIN posts p ON p.id = q.post_id
       WHERE q.status = 'pending' AND p.chat_id = ? ORDER BY q.publish_at`,
    )
    .all(chatId) as any[];
}

export function cancelQueueItem(id: number): boolean {
  const r = db.query("UPDATE queue SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id);
  return r.changes > 0;
}

export function enqueue(postId: number, mediaType: "IMAGE" | "STORIES", publishAtIso: string) {
  db.query("INSERT INTO queue (post_id, media_type, publish_at) VALUES (?, ?, ?)").run(postId, mediaType, publishAtIso);
  db.query("UPDATE posts SET status = 'scheduled' WHERE id = ?").run(postId);
}
