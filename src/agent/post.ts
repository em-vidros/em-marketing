import { db } from "../db";
import type { ArtVariant, Brief } from "../domain/art/pipeline";

/**
 * Máquina de estados do post de uma conversa. As invariantes do fluxo moram
 * aqui, não no prompt: a tool pergunta a `exigir` se pode rodar antes de gastar
 * geração e grava o resultado por `transicionar`, que confere de novo.
 */

export type Formato = "feed" | "stories" | "ambos";
export type MediaType = "IMAGE" | "STORIES";
export type Arte = ArtVariant;

export interface Headline {
  headline: string;
  apoio: string;
}

/** A peça escolhida veio da geração (tem headline) ou do banco de fotos reais (§8.2, não tem). */
export type Peca = { origem: "gerada"; headline: Headline; arte: Arte } | { origem: "foto"; arte: Arte };

interface Base {
  postId: number;
  brief: Brief;
}
interface ComPeca extends Base {
  formato: Formato;
  peca: Peca;
  /** Versão 9:16 no formato "ambos". Em "stories" a própria arte já é 9:16. */
  storyPath: string | null;
}

export type EtapaPost =
  | (Base & { etapa: "brief" })
  | (Base & { etapa: "formato"; formato: Formato })
  | (Base & { etapa: "headline"; formato: Formato; headline: Headline })
  | (Base & { etapa: "artes"; formato: Formato; headline: Headline; artes: Arte[] })
  | (ComPeca & { etapa: "escolhida" })
  | (ComPeca & { etapa: "legenda"; legenda: string })
  | (ComPeca & { etapa: "registrado"; legenda: string | null; linearId: string });

export type Etapa = EtapaPost["etapa"];

export type Evento =
  | { tipo: "formato"; formato: Formato }
  | { tipo: "headline"; headline: Headline }
  | { tipo: "artes"; artes: Arte[] }
  | { tipo: "escolha"; variante: number }
  | { tipo: "foto"; arte: Arte; storyPath: string | null }
  | { tipo: "story"; path: string }
  | { tipo: "legenda"; legenda: string }
  | { tipo: "registro"; linearId: string };

export type TipoEvento = Evento["tipo"];

/** De quais etapas cada evento pode partir. */
const ORIGEM = {
  formato: ["brief", "formato", "headline"],
  headline: ["formato", "headline", "artes"],
  artes: ["headline", "artes", "escolhida"],
  escolha: ["artes"],
  foto: ["formato", "headline", "artes", "escolhida"],
  story: ["escolhida", "legenda"],
  legenda: ["escolhida", "legenda"],
  registro: ["escolhida", "legenda"],
} as const satisfies Record<TipoEvento, readonly Etapa[]>;

export type Origem<T extends TipoEvento> = Extract<EtapaPost, { etapa: (typeof ORIGEM)[T][number] }>;

export type Permissao<P> = { ok: true; post: P } | { ok: false; motivo: string };

function naOrigem<T extends TipoEvento>(post: EtapaPost, tipo: T): post is Origem<T> {
  return (ORIGEM[tipo] as readonly Etapa[]).includes(post.etapa);
}

const formatoDe = (p: EtapaPost): Formato | null => (p.etapa === "brief" ? null : p.formato);

const precisaStory = (p: ComPeca) => p.formato === "ambos" && p.storyPath === null;

/** O que o fluxo pede agora. Vai para o modelo nas recusas e no resumo do estado. */
export function proximoPasso(p: EtapaPost): string {
  switch (p.etapa) {
    case "brief":
      return "confirmar o brief e chamar definir_formato";
    case "formato":
      return p.brief.precisaFotoReal ? "buscar_fotos e depois usar_foto (§8.2)" : "definir_headline";
    case "headline":
      return "gerar_3_artes";
    case "artes":
      return "escolher_arte";
    case "escolhida":
      if (p.formato === "stories") return "salvar_linear";
      return precisaStory(p) && p.peca.origem === "gerada" ? "derivar_story e depois escrever_legenda" : "escrever_legenda";
    case "legenda":
      return precisaStory(p) ? "derivar_story" : "salvar_linear";
    case "registrado":
      return "publicar_agora ou agendar_publicacao, com aprovação humana";
  }
}

export function exigir<T extends TipoEvento>(post: EtapaPost | null, tipo: T): Permissao<Origem<T>> {
  const nao = (motivo: string) => ({ ok: false as const, motivo });
  if (!post) return nao("Não há post em andamento nesta conversa. Chame montar_brief primeiro.");
  const formato = formatoDe(post);

  switch (tipo) {
    case "headline":
    case "foto":
      if (!formato) return nao("Invariante 1: o formato não foi definido. Chame definir_formato.");
      break;
    case "artes":
      if (post.brief.precisaFotoReal)
        return nao(
          "Invariante 4 (§8.2): a peça representa produto, obra, fábrica ou pessoas da EM Vidros e exige foto real. Não gere." +
            " Chame buscar_fotos; se o banco não tiver, peça a foto com o guia do §8.3: luz natural difusa de lado," +
            " ângulo de 15 a 30° fora do eixo, fundo limpo, enquadramento vertical.",
        );
      if (!formato) return nao("Invariante 1: o formato não foi definido. Chame definir_formato.");
      if (post.etapa === "formato") return nao("Invariante 2: o headline vem antes da imagem. Chame definir_headline.");
      if (post.etapa === "escolhida" && post.peca.origem === "foto")
        return nao("A arte deste post é uma foto real do banco. Para gerar, monte um brief novo.");
      break;
    case "legenda":
      if (formato === "stories") return nao("Invariante 3: stories não têm legenda. Não chame esta tool.");
      break;
    case "story":
      if (formato !== "ambos") return nao("derivar_story só existe no formato ambos.");
      if ("peca" in post && post.peca.origem === "foto")
        return nao("§8.2: a arte escolhida é uma foto real e não pode ser regenerada em 9:16. A versão vertical já saiu da própria foto.");
      break;
    case "registro":
      if (post.etapa === "escolhida" && post.formato !== "stories")
        return nao("Post com feed leva legenda antes do Linear. Chame escrever_legenda.");
      if ((post.etapa === "escolhida" || post.etapa === "legenda") && precisaStory(post))
        return nao("No formato ambos falta a versão stories. Chame derivar_story.");
      break;
  }

  if (!naOrigem(post, tipo))
    return nao(`Fora de ordem: o post ${post.postId} está na etapa "${post.etapa}". Próximo passo: ${proximoPasso(post)}.`);
  return { ok: true, post };
}

/** Headline que alimenta uma nova geração. Uma escolhida de foto real já foi recusada por exigir. */
export function headlineParaGerar(p: Origem<"artes">): Headline | null {
  if (p.etapa !== "escolhida") return p.headline;
  return p.peca.origem === "gerada" ? p.peca.headline : null;
}

export function transicionar(post: EtapaPost | null, evento: Evento): Permissao<EtapaPost> {
  const ok = (p: EtapaPost) => ({ ok: true as const, post: p });

  switch (evento.tipo) {
    case "formato": {
      const r = exigir(post, "formato");
      if (!r.ok) return r;
      return ok({ etapa: "formato", postId: r.post.postId, brief: r.post.brief, formato: evento.formato });
    }
    case "headline": {
      const r = exigir(post, "headline");
      if (!r.ok) return r;
      const { postId, brief, formato } = r.post;
      return ok({ etapa: "headline", postId, brief, formato, headline: evento.headline });
    }
    case "artes": {
      const r = exigir(post, "artes");
      if (!r.ok) return r;
      const p = r.post;
      const headline = headlineParaGerar(p);
      if (!headline) return { ok: false, motivo: "Sem headline para gerar." };
      return ok({ etapa: "artes", postId: p.postId, brief: p.brief, formato: p.formato, headline, artes: evento.artes });
    }
    case "escolha": {
      const r = exigir(post, "escolha");
      if (!r.ok) return r;
      const arte = r.post.artes.find((a) => a.variant === evento.variante);
      if (!arte) return { ok: false, motivo: `Não existe a variação v${evento.variante}. As opções são ${r.post.artes.map((a) => `v${a.variant}`).join(", ")}.` };
      const { postId, brief, formato, headline } = r.post;
      return ok({ etapa: "escolhida", postId, brief, formato, peca: { origem: "gerada", headline, arte }, storyPath: null });
    }
    case "foto": {
      const r = exigir(post, "foto");
      if (!r.ok) return r;
      const { postId, brief, formato } = r.post;
      return ok({ etapa: "escolhida", postId, brief, formato, peca: { origem: "foto", arte: evento.arte }, storyPath: evento.storyPath });
    }
    case "story": {
      const r = exigir(post, "story");
      if (!r.ok) return r;
      return ok({ ...r.post, storyPath: evento.path });
    }
    case "legenda": {
      const r = exigir(post, "legenda");
      if (!r.ok) return r;
      return ok({ ...r.post, etapa: "legenda", legenda: evento.legenda });
    }
    case "registro": {
      const r = exigir(post, "registro");
      if (!r.ok) return r;
      const legenda = r.post.etapa === "legenda" ? r.post.legenda : null;
      return ok({ ...r.post, etapa: "registrado", legenda, linearId: evento.linearId });
    }
  }
}

/** O JPEG e a legenda de uma publicação. Só sai post registrado no Linear, no formato que ele tem. */
export function midiaParaPublicar(
  post: EtapaPost | null,
  mediaType: MediaType,
): Permissao<{ postId: number; path: string; legenda: string | undefined }> {
  if (!post) return { ok: false, motivo: "Não há post em andamento nesta conversa." };
  if (post.etapa !== "registrado")
    return { ok: false, motivo: `O post precisa estar salvo no Linear antes de publicar. Próximo passo: ${proximoPasso(post)}.` };
  const { postId, formato, peca, storyPath, legenda } = post;
  if (mediaType === "IMAGE") {
    if (formato === "stories") return { ok: false, motivo: "Este post é só stories; não há peça de feed." };
    return { ok: true, post: { postId, path: peca.arte.path, legenda: legenda ?? undefined } };
  }
  if (formato === "feed") return { ok: false, motivo: "Este post é só feed; não há peça 9:16." };
  const path = formato === "stories" ? peca.arte.path : storyPath;
  if (!path) return { ok: false, motivo: "Falta a versão stories." };
  return { ok: true, post: { postId, path, legenda: undefined } };
}

export function resumoDoPost(post: EtapaPost | null): string {
  if (!post) return "Nenhum post em andamento nesta conversa.";
  const formato = formatoDe(post);
  return [
    `Post ${post.postId}, etapa "${post.etapa}".`,
    `Brief: ${JSON.stringify(post.brief)}.`,
    formato ? `Formato: ${formato}.` : "Formato ainda não definido.",
    `Próximo passo: ${proximoPasso(post)}.`,
  ].join(" ");
}

// --- persistência: a linha de posts continua sendo a fonte que o scheduler e a cota leem ---

interface PostRow {
  id: number;
  brief: string;
  formato: Formato | null;
  headline: string | null;
  arts: string | null;
  chosen: number | null;
  story_path: string | null;
  legenda: string | null;
  linear_issue_id: string | null;
}

function lerLinha(row: PostRow): EtapaPost {
  const base: Base = { postId: row.id, brief: JSON.parse(row.brief) };
  if (!row.formato) return { ...base, etapa: "brief" };
  const formato = row.formato;
  const headline: Headline | null = row.headline ? JSON.parse(row.headline) : null;
  const artes: Arte[] = row.arts ? JSON.parse(row.arts) : [];
  const arte = row.chosen ? artes.find((a) => a.variant === row.chosen) : undefined;

  if (arte) {
    const peca: Peca = arte.style === "foto-real" || !headline ? { origem: "foto", arte } : { origem: "gerada", headline, arte };
    const comPeca: ComPeca = { ...base, formato, peca, storyPath: row.story_path };
    if (row.linear_issue_id) return { ...comPeca, etapa: "registrado", legenda: row.legenda, linearId: row.linear_issue_id };
    if (row.legenda) return { ...comPeca, etapa: "legenda", legenda: row.legenda };
    return { ...comPeca, etapa: "escolhida" };
  }
  if (headline && artes.length) return { ...base, etapa: "artes", formato, headline, artes };
  if (headline) return { ...base, etapa: "headline", formato, headline };
  return { ...base, etapa: "formato", formato };
}

const STATUS: Record<Etapa, string> = {
  brief: "draft",
  formato: "draft",
  headline: "draft",
  artes: "generated",
  escolhida: "chosen",
  legenda: "chosen",
  registrado: "archived",
};

export function postDaConversa(conversaId: string): EtapaPost | null {
  const row = db
    .query("SELECT p.* FROM conversas c JOIN posts p ON p.id = c.post_id WHERE c.id = ?")
    .get(conversaId) as PostRow | null;
  return row ? lerLinha(row) : null;
}

export function abrirConversa(conversaId: string, botId: string): void {
  db.query("INSERT INTO conversas (id, bot_id) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").run(conversaId, botId);
}

/** Um brief novo abre um post novo e vira o post em andamento da conversa. */
export function criarPost(conversaId: string, brief: Brief, formato: Formato | null): EtapaPost {
  const { id } = db
    .query("INSERT INTO posts (brief, pilar, formato) VALUES (?, ?, ?) RETURNING id")
    .get(JSON.stringify(brief), brief.pilar, formato) as { id: number };
  db.query("UPDATE conversas SET post_id = ?, updated_at = datetime('now') WHERE id = ?").run(id, conversaId);
  const base: Base = { postId: id, brief };
  return formato ? { ...base, etapa: "formato", formato } : { ...base, etapa: "brief" };
}

export function gravarPost(post: EtapaPost): void {
  const formato = formatoDe(post);
  let headline: Headline | null = null;
  let artes: Arte[] | null = null;
  let chosen: number | null = null;
  let storyPath: string | null = null;
  let legenda: string | null = null;
  let linearId: string | null = null;

  switch (post.etapa) {
    case "brief":
    case "formato":
      break;
    case "headline":
      headline = post.headline;
      break;
    case "artes":
      headline = post.headline;
      artes = post.artes;
      break;
    case "escolhida":
    case "legenda":
    case "registrado":
      headline = post.peca.origem === "gerada" ? post.peca.headline : null;
      artes = [post.peca.arte];
      chosen = post.peca.arte.variant;
      storyPath = post.storyPath;
      if (post.etapa !== "escolhida") legenda = post.legenda;
      if (post.etapa === "registrado") linearId = post.linearId;
      break;
  }

  db.query(
    `UPDATE posts SET formato = ?, headline = ?, arts = ?, chosen = ?, story_path = ?, legenda = ?, linear_issue_id = ?, status = ?
      WHERE id = ?`,
  ).run(
    formato,
    headline && JSON.stringify(headline),
    artes && JSON.stringify(artes),
    chosen,
    storyPath,
    legenda,
    linearId,
    STATUS[post.etapa],
    post.postId,
  );
}
