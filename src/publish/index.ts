import { db } from "../db";
import { publishImage } from "../instagram";
import { sendPhoto, sendMessage } from "../telegram/api";

/**
 * Passo de publicação — único ponto de decisão manual vs. automático.
 *
 * PUBLISH_MODE=manual (padrão): entrega a arte final + legenda no Telegram
 *   para o time publicar na mão no Instagram. Não precisa de credenciais da Meta.
 * PUBLISH_MODE=auto: publica direto via Graph API (exige IG_PAGE_TOKEN/IG_USER_ID
 *   e a URL pública de mídia). Para migrar, basta virar a env — o caminho já existe.
 *
 * `post` precisa trazer: id (posts.id), arts, chosen, story_path, legenda.
 */
export async function publishStep(
  chatId: number,
  post: any,
  mediaType: "IMAGE" | "STORIES",
): Promise<string> {
  const arts = JSON.parse(post.arts ?? "[]");
  const chosen = arts.find((a: any) => a.variant === post.chosen);
  const jpegPath = mediaType === "STORIES" ? (post.story_path ?? chosen?.path) : chosen?.path;
  if (!jpegPath) throw new Error("arte final não encontrada");

  if ((process.env.PUBLISH_MODE ?? "manual") === "auto") {
    const igId = await publishImage({
      jpegPath,
      mediaType,
      caption: mediaType === "IMAGE" ? post.legenda : undefined,
    });
    db.query("UPDATE posts SET status = 'published' WHERE id = ?").run(post.id);
    return `Publicado no Instagram! id ${igId}.`;
  }

  // --- modo manual: handoff para publicação humana ---
  const label = mediaType === "STORIES" ? "📤 Story pronto pra publicar" : "📤 Feed pronto pra publicar";
  await sendPhoto(chatId, jpegPath, { caption: label });
  if (mediaType === "IMAGE" && post.legenda) {
    await sendMessage(chatId, "Legenda (toque para copiar):");
    await sendMessage(chatId, post.legenda, { parse_mode: undefined }); // texto puro, copia limpo
  }
  db.query("UPDATE posts SET status = 'ready_to_post' WHERE id = ?").run(post.id);
  return mediaType === "STORIES"
    ? "Story entregue no Telegram para publicação manual."
    : "Feed + legenda entregues no Telegram para publicação manual.";
}
