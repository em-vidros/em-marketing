import { Elysia, status } from "elysia";
import { db } from "./db";
import { startScheduler } from "./domain/scheduler";

const app = new Elysia()
  .get("/health", () => ({ ok: true, ts: new Date().toISOString() }))
  .get("/media/:id", ({ params }) => {
    const row = db.query("SELECT path, expired FROM media WHERE id = ?").get(params.id) as any;
    if (!row || row.expired) return status(404, "not found");
    return new Response(Bun.file(row.path), { headers: { "content-type": "image/jpeg" } });
  })
  .listen(Number(process.env.PORT ?? 3000));

startScheduler();

console.log(`em-marketing ouvindo em :${app.server?.port}`);
