import { colunasDaFonte, fonteDa, primeira, utcDe, type ColunasDaFonte, type Fonte, type TipoMidia } from "../../db";
import { q } from "../../v2/banco";
import { publishImage } from "../instagram";

/**
 * Scheduler próprio (a Meta não tem agendamento nativo, PRD §4.3b).
 * Tick a cada 30 s no servidor local; na Vercel, um cron chama tickDaFila. O container é criado só na hora de publicar.
 */
export function startScheduler() {
  setInterval(tickDaFila, 30_000);
}

interface Devida {
  id: number;
  media_type: TipoMidia;
  jpeg_path: string;
  legenda: string | null;
}

/** Uma passada pela fila: publica o que já venceu. O UPDATE condicional pega cada linha uma vez só, mesmo com duas passadas ao mesmo tempo. */
export async function tickDaFila(): Promise<void> {
  const devidas = await q<Devida & ColunasDaFonte>`UPDATE queue SET status = 'publishing'
    WHERE status = 'pending' AND publish_at <= ${utcDe(Date.now())}
    RETURNING id, post_id, arte_id, peca_id, media_type, jpeg_path, legenda`;

  for (const item of devidas) {
    const fonte = fonteDa(item);
    const nome = fonte.tipo === "post" ? `post ${fonte.postId}` : fonte.tipo === "arte" ? `arte ${fonte.arteId}` : `peça pronta ${fonte.pecaId}`;
    try {
      if (!item.jpeg_path) throw new Error("Arquivo da arte não encontrado");
      const igId = await publishImage({ fonte, jpegPath: item.jpeg_path, mediaType: item.media_type, caption: item.legenda ?? undefined });
      await q`UPDATE queue SET status = 'done' WHERE id = ${item.id}`;
      if (fonte.tipo === "post") await q`UPDATE posts SET status = 'published' WHERE id = ${fonte.postId}`;
      console.log(`publicado no Instagram (${item.media_type}), ${nome}, id ${igId}`);
    } catch (err: any) {
      // Nunca falha em silêncio (US-6)
      await q`UPDATE queue SET status = 'failed', error = ${String(err)} WHERE id = ${item.id}`;
      if (fonte.tipo === "post") await q`UPDATE posts SET status = 'failed' WHERE id = ${fonte.postId}`;
      console.error(`falha ao publicar (${item.media_type}), ${nome}:`, err);
    }
  }
}

export function listQueue() {
  return q<{ id: number; media_type: "IMAGE" | "STORIES"; publish_at: string; brief: string | null; peca_tema: string | null }>`SELECT q.id, q.media_type, q.publish_at, p.brief, pp.tema AS peca_tema
    FROM queue q LEFT JOIN posts p ON p.id = q.post_id LEFT JOIN pecas_prontas pp ON pp.id::text = q.peca_id
    WHERE q.status = 'pending' ORDER BY q.publish_at`;
}

export async function cancelQueueItem(id: number): Promise<boolean> {
  return (await q`UPDATE queue SET status = 'cancelled' WHERE id = ${id} AND status = 'pending' RETURNING id`).length > 0;
}

/** O que entra na fila: de onde veio, a mídia, o JPEG já pronto e a legenda (só IMAGE). */
export interface PecaDaFila {
  fonte: Fonte;
  midia: TipoMidia;
  jpegPath: string;
  legenda: string | null;
}

/** publishAt em "AAAA-MM-DD HH:MM:SS" UTC (db.utcDe), que o tick compara como texto. Devolve o id da fila. */
export async function enqueue(peca: PecaDaFila, publishAt: string): Promise<number> {
  const [postId, arteId, pecaId] = colunasDaFonte(peca.fonte);
  const { id } = (await primeira(
    q<{ id: number }>`INSERT INTO queue (post_id, arte_id, peca_id, media_type, publish_at, jpeg_path, legenda)
      VALUES (${postId}, ${arteId}, ${pecaId}, ${peca.midia}, ${publishAt}, ${peca.jpegPath}, ${peca.legenda}) RETURNING id`,
  ))!;
  if (peca.fonte.tipo === "post") await q`UPDATE posts SET status = 'scheduled' WHERE id = ${peca.fonte.postId}`;
  return id;
}
