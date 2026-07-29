import { db } from "../db";
import { publishStep } from "../publish";
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
      const post = {
        id: item.post_id,
        arts: item.arts,
        chosen: item.chosen,
        story_path: item.story_path,
        legenda: item.legenda,
      };
      const msg = await publishStep(item.chat_id, post, item.media_type);
      db.query("UPDATE queue SET status = 'done' WHERE id = ?").run(item.id);
      await sendMessage(item.chat_id, `⏰ ${msg}`);
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
