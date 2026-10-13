import { db, newMediaId } from "../db";

const GRAPH = "https://graph.facebook.com/v23.0";
const IG_USER = () => process.env.IG_USER_ID!;
const TOKEN = () => process.env.IG_PAGE_TOKEN!;
const PUBLIC_BASE = () => process.env.PUBLIC_BASE_URL ?? "https://mkt.emvidros.com.br";

async function graph(path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ ...params, access_token: TOKEN() });
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  const json: any = await res.json();
  if (json.error) throw new Error(`Graph API ${path}: ${json.error.message}`);
  return json;
}

export async function publishingLimit(): Promise<number> {
  const res = await fetch(
    `${GRAPH}/${IG_USER()}/content_publishing_limit?access_token=${TOKEN()}`,
  );
  const json: any = await res.json();
  return json.data?.[0]?.quota_usage ?? 0;
}

/** Best-effort: o permalink é conveniência, a chave é o ig_media_id. */
async function permalink(igMediaId: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH}/${igMediaId}?fields=permalink&access_token=${TOKEN()}`);
    return ((await res.json()) as any).permalink ?? null;
  } catch {
    return null;
  }
}

/**
 * Publica uma imagem AGORA (o container expira em 24h — nunca criar no agendamento).
 * mediaType IMAGE leva caption; STORIES nunca (a API rejeita).
 *
 * `postId` é obrigatório de propósito: o registro em `publicacoes` acontece aqui,
 * na única função que conhece o id da mídia, para que não exista caminho de
 * publicação que esqueça de gravá-lo.
 */
export async function publishImage(opts: {
  postId: number;
  jpegPath: string;
  mediaType: "IMAGE" | "STORIES";
  caption?: string;
}): Promise<string> {
  const mediaId = newMediaId(opts.jpegPath);
  const image_url = `${PUBLIC_BASE()}/media/${mediaId}`;

  const params: Record<string, string> = { image_url };
  if (opts.mediaType === "STORIES") params.media_type = "STORIES";
  else if (opts.caption) params.caption = opts.caption;

  const { id: containerId } = await graph(`${IG_USER()}/media`, params);

  // polling 1×/min, máx 5 min (PRD §4.3)
  for (let i = 0; i < 5; i++) {
    const res = await fetch(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${TOKEN()}`,
    );
    const { status_code } = (await res.json()) as any;
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR") throw new Error("Container da Meta retornou ERROR");
    await Bun.sleep(60_000);
  }

  const { id: igMediaId } = await graph(`${IG_USER()}/media_publish`, {
    creation_id: containerId,
  });

  db.query("UPDATE media SET expired = 1 WHERE id = ?").run(mediaId);
  db.query(
    "INSERT INTO publicacoes (post_id, media_type, ig_media_id, permalink) VALUES (?, ?, ?, ?)",
  ).run(opts.postId, opts.mediaType, igMediaId, await permalink(igMediaId));
  return igMediaId;
}
