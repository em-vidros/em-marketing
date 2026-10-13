import { Elysia, status } from "elysia";
import { timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { startScheduler } from "./scheduler";
import { startCalendar } from "./scheduler/calendar";
import { handleUpdate } from "./telegram/updates";

function secretOk(header: string | undefined): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!header || !expected || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

const app = new Elysia()
  .get("/health", () => ({ ok: true, ts: new Date().toISOString() }))
  .get("/media/:id", ({ params }) => {
    const row = db.query("SELECT path, expired FROM media WHERE id = ?").get(params.id) as any;
    if (!row || row.expired) return status(404, "not found");
    return new Response(Bun.file(row.path), { headers: { "content-type": "image/jpeg" } });
  })
  .post(
    "/webhooks/telegram",
    async ({ request, headers }) => {
      if (!secretOk(headers["x-telegram-bot-api-secret-token"])) return status(401, "unauthorized");
      const raw = await request.text();
      const update = JSON.parse(raw);
      // responde 200 imediatamente; processa em background
      queueMicrotask(() => handleUpdate(update).catch((e) => console.error("update error:", e)));
      return { ok: true };
    },
    { parse: "none" as any },
  )
  .listen(Number(process.env.PORT ?? 3000));

startScheduler();
startCalendar();

console.log(`em-marketing ouvindo em :${app.server?.port}`);
