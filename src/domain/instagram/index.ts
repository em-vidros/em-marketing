import { ehUrl } from "../../armazem";
import { colunasDaFonte, newMediaId, type Fonte, type TipoMidia } from "../../db";
import { q } from "../../v2/banco";
import { credenciais } from "./meta-login";

const GRAPH = "https://graph.facebook.com/v23.0";
const IG_USER = async () => (await credenciais()).igUserId;
const TOKEN = async () => (await credenciais()).pageToken;
const PUBLIC_BASE = () => process.env.PUBLIC_BASE_URL ?? "https://mkt.emvidros.com.br";

async function graph(path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ ...params, access_token: await TOKEN() });
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  const json: any = await res.json();
  if (json.error) throw new Error(`Graph API ${path}: ${json.error.message}`);
  return json;
}

export async function publishingLimit(): Promise<number> {
  const res = await fetch(
    `${GRAPH}/${await IG_USER()}/content_publishing_limit?access_token=${await TOKEN()}`,
  );
  const json: any = await res.json();
  return json.data?.[0]?.quota_usage ?? 0;
}

/** Best-effort: o permalink é conveniência, a chave é o ig_media_id. */
async function permalink(igMediaId: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH}/${igMediaId}?fields=permalink&access_token=${await TOKEN()}`);
    return ((await res.json()) as any).permalink ?? null;
  } catch {
    return null;
  }
}

/**
 * Publica uma imagem AGORA (o container expira em 24h — nunca criar no agendamento).
 * mediaType IMAGE leva caption; STORIES nunca (a API rejeita).
 *
 * `fonte` é obrigatória de propósito: o registro em `publicacoes` acontece aqui,
 * na única função que conhece o id da mídia, para que não exista caminho de
 * publicação que esqueça de gravá-lo.
 */
export async function publishImage(opts: {
  fonte: Fonte;
  jpegPath: string;
  mediaType: TipoMidia;
  caption?: string;
}): Promise<string> {
  // O JPEG no Blob já tem URL pública; o do disco sai por /media/:id, que expira depois da publicação.
  const mediaId = ehUrl(opts.jpegPath) ? null : await newMediaId(opts.jpegPath);
  const image_url = mediaId ? `${PUBLIC_BASE()}/media/${mediaId}` : opts.jpegPath;

  const params: Record<string, string> = { image_url };
  if (opts.mediaType === "STORIES") params.media_type = "STORIES";
  else if (opts.caption) params.caption = opts.caption;

  const { id: containerId } = await graph(`${await IG_USER()}/media`, params);

  // polling 1×/min, máx 5 min (PRD §4.3)
  for (let i = 0; i < 5; i++) {
    const res = await fetch(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${await TOKEN()}`,
    );
    const { status_code } = (await res.json()) as any;
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR") throw new Error("Container da Meta retornou ERROR");
    await Bun.sleep(60_000);
  }

  const { id: igMediaId } = await graph(`${await IG_USER()}/media_publish`, {
    creation_id: containerId,
  });

  if (mediaId) await q`UPDATE media SET expired = 1 WHERE id = ${mediaId}`;
  const [postId, arteId] = colunasDaFonte(opts.fonte);
  await q`INSERT INTO publicacoes (post_id, arte_id, media_type, ig_media_id, permalink)
    VALUES (${postId}, ${arteId}, ${opts.mediaType}, ${igMediaId}, ${await permalink(igMediaId)})`;
  return igMediaId;
}
