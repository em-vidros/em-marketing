const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function call<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

export const sendChatAction = (chat_id: number, action = "typing") =>
  call("sendChatAction", { chat_id, action }).catch(() => {});

/**
 * Texto puro por padrão. O Markdown legado do Telegram rejeita a mensagem inteira
 * (400 "can't parse entities") com um `_` ou `*` desbalanceado — e a maior parte do
 * que passa aqui é texto livre do modelo. Quem escreve a marcação passa parse_mode.
 */
export const sendMessage = (
  chat_id: number,
  text: string,
  extra: Record<string, unknown> = {},
) => call("sendMessage", { chat_id, text, ...extra });

export const answerCallbackQuery = (id: string, text?: string) =>
  call("answerCallbackQuery", { callback_query_id: id, text }).catch(() => {});

export function inlineKeyboard(rows: { text: string; data: string }[][]) {
  return {
    reply_markup: {
      inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))),
    },
  };
}

/** Envia até 10 fotos num único media group (multipart). */
export async function sendMediaGroup(chat_id: number, jpegPaths: string[], caption?: string) {
  const form = new FormData();
  form.append("chat_id", String(chat_id));
  const media = jpegPaths.map((_p, i) => ({
    type: "photo",
    media: `attach://f${i}`,
    ...(i === 0 && caption ? { caption } : {}),
  }));
  form.append("media", JSON.stringify(media));
  for (let i = 0; i < jpegPaths.length; i++) {
    form.append(`f${i}`, new Blob([await Bun.file(jpegPaths[i]!).arrayBuffer()], { type: "image/jpeg" }), `v${i + 1}.jpg`);
  }
  const res = await fetch(`${BASE()}/sendMediaGroup`, { method: "POST", body: form });
  const json: any = await res.json();
  if (!json.ok) throw new Error(`Telegram sendMediaGroup: ${json.description}`);
  return json.result;
}

export async function sendPhoto(chat_id: number, jpegPath: string, extra: Record<string, unknown> = {}) {
  const form = new FormData();
  form.append("chat_id", String(chat_id));
  for (const [k, v] of Object.entries(extra)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  form.append("photo", new Blob([await Bun.file(jpegPath).arrayBuffer()], { type: "image/jpeg" }), "art.jpg");
  const res = await fetch(`${BASE()}/sendPhoto`, { method: "POST", body: form });
  const json: any = await res.json();
  if (!json.ok) throw new Error(`Telegram sendPhoto: ${json.description}`);
  return json.result;
}
