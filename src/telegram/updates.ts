import { db } from "../db";
import { brainTurn } from "../brain";
import { answerCallbackQuery, getFileBuffer, sendChatAction, sendMessage } from "./api";
import { catalogarFoto, resumir, salvarFoto } from "../fotos";

const ALLOWED = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean),
);

export async function handleUpdate(update: any) {
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

  // Foto enviada pelo usuário → banco de fotos reais (§8.2).
  // O "document" cobre o envio "como arquivo", que preserva a resolução original;
  // "photo" é o envio normal, que o Telegram recomprime.
  const arquivo: { file_id: string } | undefined =
    msg?.photo?.[msg.photo.length - 1] ??
    (String(msg?.document?.mime_type ?? "").startsWith("image/") ? msg.document : undefined);

  if (arquivo) {
    await sendChatAction(chatId, "upload_photo");
    try {
      const { id } = await salvarFoto({ chatId, buffer: await getFileBuffer(arquivo.file_id), fileId: arquivo.file_id });
      const foto = await catalogarFoto(id, msg.caption).catch(() => null);
      await brainTurn(
        chatId,
        `[sistema] O usuário mandou uma foto. Ela foi arquivada no banco como #${id}` +
          (msg.caption ? ` com a legenda "${msg.caption}"` : " sem legenda") +
          `. Catálogo automático: ${foto ? resumir(foto) : "falhou — a foto está salva, mas sem descrição."} ` +
          `Confirme em uma linha. Se houver um post em andamento que exige foto real, ofereça usar_foto com esse id.`,
      );
    } catch (err: any) {
      await sendMessage(chatId, `❌ Não consegui arquivar a foto: ${err.message ?? err}`);
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
