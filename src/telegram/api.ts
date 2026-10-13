const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Com TELEGRAM_LOCAL=1 nada sai para o Telegram: cada envio vira um evento para
 * o chat local (scripts/chat-local.ts), que roda o agente sem bot nem webhook.
 */
export type LocalEvent =
  | { kind: "text"; text: string; buttons?: { text: string; data: string }[][] }
  | { kind: "photos"; paths: string[]; caption?: string }
  | { kind: "typing" };

export const localOutbox = new Set<(e: LocalEvent) => void>();
const isLocal = () => process.env.TELEGRAM_LOCAL === "1";
const emit = (e: LocalEvent) => localOutbox.forEach((fn) => fn(e));

function callLocal(method: string, body: Record<string, any>): any {
  if (method === "sendMessage") {
    const rows = body.reply_markup?.inline_keyboard as { text: string; callback_data: string }[][] | undefined;
    emit({ kind: "text", text: body.text, buttons: rows?.map((r) => r.map((b) => ({ text: b.text, data: b.callback_data }))) });
  } else if (method === "sendChatAction") {
    emit({ kind: "typing" });
  } else if (method === "getFile") {
    throw new Error("o chat local não recebe arquivo do Telegram");
  }
  return { message_id: Date.now() };
}

async function call<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  if (isLocal()) return callLocal(method, body);
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

export const sendMessage = (
  chat_id: number,
  text: string,
  extra: Record<string, unknown> = {},
) => call("sendMessage", { chat_id, text, parse_mode: "Markdown", ...extra });

export const answerCallbackQuery = (id: string, text?: string) =>
  call("answerCallbackQuery", { callback_query_id: id, text }).catch(() => {});

/** Baixa um arquivo enviado pelo usuário (foto do banco §8.2). */
export async function getFileBuffer(fileId: string): Promise<Buffer> {
  const { file_path } = await call<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file_path}`);
  if (!res.ok) throw new Error(`Telegram getFile download: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export function inlineKeyboard(rows: { text: string; data: string }[][]) {
  return {
    reply_markup: {
      inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))),
    },
  };
}

/** Envia até 10 fotos num único media group (multipart). */
export async function sendMediaGroup(chat_id: number, jpegPaths: string[], caption?: string) {
  if (isLocal()) return emit({ kind: "photos", paths: jpegPaths, caption });
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
  if (isLocal()) return emit({ kind: "photos", paths: [jpegPath], caption: extra.caption as string | undefined });
  const form = new FormData();
  form.append("chat_id", String(chat_id));
  for (const [k, v] of Object.entries(extra)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  form.append("photo", new Blob([await Bun.file(jpegPath).arrayBuffer()], { type: "image/jpeg" }), "art.jpg");
  const res = await fetch(`${BASE()}/sendPhoto`, { method: "POST", body: form });
  const json: any = await res.json();
  if (!json.ok) throw new Error(`Telegram sendPhoto: ${json.description}`);
  return json.result;
}
