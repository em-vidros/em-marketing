import { Elysia, status } from "elysia";
import { timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { brainTurn } from "./brain";
import { startScheduler } from "./scheduler";
import { startCalendar } from "./scheduler/calendar";
import { answerCallbackQuery, sendChatAction, sendMessage } from "./telegram/api";

const ALLOWED = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean),
);

function secretOk(header: string | undefined): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!header || !expected || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

async function handleUpdate(update: any) {
  const msg = update.message;
  const cb = update.callback_query;
  const chatId: number | undefined = msg?.chat?.id ?? cb?.message?.chat?.id;
  if (!chatId || !ALLOWED.has(chatId)) return; // allowlist — silêncio para desconhecidos

  if (cb) {
    await answerCallbackQuery(cb.id);
    const [action, a = "", b = ""] = String(cb.data).split(":");
    // callbacks determinísticos viram eventos para o cérebro com estado já gravado
    if (action === "fmt") {
      db.query("UPDATE posts SET formato = ? WHERE id = ?").run(a, Number(b));
      await brainTurn(chatId, `[sistema] O usuário escolheu o formato "${a}" nos botões. Prossiga o fluxo (headline → 3 artes).`);
    } else if (action === "pick") {
      db.query("UPDATE posts SET chosen = ?, status = 'chosen' WHERE id = ?").run(Number(a), Number(b));
      await brainTurn(chatId, `[sistema] O usuário escolheu a variação v${a}. Confirme, descarte as outras e prossiga (derivar story se formato=ambos; legenda se inclui feed; salvar no Linear; oferecer Publicar agora/Agendar/Só arquivar).`);
    } else if (action === "redo") {
      await brainTurn(chatId, `[sistema] O usuário pediu para refazer as 3 artes. Gere novamente.`);
    } else if (action === "recap") {
      await brainTurn(chatId, `[sistema] O usuário pediu para reescrever a legenda.`);
    }
    return;
  }

  if (msg?.text) {
    await sendChatAction(chatId); // resposta em ≤3 s (US-1)
    if (msg.text.startsWith("/agenda")) {
      await brainTurn(chatId, "[sistema] O usuário mandou /agenda — liste a fila com listar_agenda.");
      return;
    }
    if (msg.text.startsWith("/start")) {
      await sendMessage(chatId, "Oi! Sou o agente de marketing da EM Vidros 🩵\nMe diga que post você quer — ex.: _\"cria um post pro dia do vidraceiro, 18 de maio\"_.");
      return;
    }
    await brainTurn(chatId, msg.text);
  }
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
