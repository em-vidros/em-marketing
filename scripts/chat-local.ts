/**
 * Chat local com o agente, sem bot nem webhook: `bun run chat` e abrir http://localhost:3333.
 * Usa o mesmo handleUpdate do servidor; só o transporte do Telegram é trocado.
 */
import { resolve } from "node:path";

const CHAT_ID = 1;
process.env.TELEGRAM_LOCAL = "1";
process.env.TELEGRAM_ALLOWED_CHAT_IDS = String(CHAT_ID);
process.env.DB_PATH ??= "data/chat-local.db";

const { localOutbox } = await import("../src/telegram/api");
const { handleUpdate } = await import("../src/telegram/updates");

const DATA = resolve("data");
const PORT = Number(process.env.CHAT_PORT ?? 3333);
const page = await Bun.file(new URL("./chat-local.html", import.meta.url)).text();

const run = (update: unknown) =>
  handleUpdate(update).catch((e) => {
    console.error(e);
    localOutbox.forEach((fn) => fn({ kind: "text", text: `❌ ${e.message ?? e}` }));
  });

Bun.serve({
  port: PORT,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });

    if (url.pathname === "/events") {
      let listener: (e: unknown) => void;
      const stream = new ReadableStream({
        start(ctl) {
          listener = (e) => ctl.enqueue(`data: ${JSON.stringify(e)}\n\n`);
          localOutbox.add(listener);
          ctl.enqueue(": aberto\n\n");
        },
        cancel() {
          localOutbox.delete(listener);
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
    }

    if (url.pathname === "/send" && req.method === "POST") {
      const { text, data } = (await req.json()) as { text?: string; data?: string };
      const chat = { id: CHAT_ID };
      run(
        data
          ? { callback_query: { id: "local", data, message: { chat } } }
          : { message: { chat, text } },
      );
      return Response.json({ ok: true });
    }

    if (url.pathname === "/file") {
      const path = resolve(url.searchParams.get("p") ?? "");
      if (!path.startsWith(DATA + "/")) return new Response("fora de data/", { status: 403 });
      return new Response(Bun.file(path));
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`chat local em http://localhost:${PORT}`);
