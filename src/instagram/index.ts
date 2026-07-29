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

/**
 * Publica uma imagem AGORA (o container expira em 24h — nunca criar no agendamento).
 * mediaType IMAGE leva caption; STORIES nunca (a API rejeita).
 */
export async function publishImage(opts: {
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

  const { id: postId } = await graph(`${IG_USER()}/media_publish`, {
    creation_id: containerId,
  });

  db.query("UPDATE media SET expired = 1 WHERE id = ?").run(mediaId);
  return postId;
}
