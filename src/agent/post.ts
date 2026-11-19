import { guardarImagens, primeira, utcDe, type ImagemNova } from "../db";
import { q } from "../v2/banco";
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
  /** As variações geradas, a escolhida entre elas. Ficam para o usuário rever e trocar de arte. Foto real tem só a própria. */
  opcoes: Arte[];
  /** Versão 9:16 no formato "ambos". Em "stories" a própria arte já é 9:16. */
  storyPath: string | null;
}

export type EtapaPost =
  | (Base & { etapa: "brief" })
  | (Base & { etapa: "formato"; formato: Formato })
  | (Base & { etapa: "headline"; formato: Formato; headline: Headline })
  | (Base & { etapa: "artes"; formato: Formato; headline: Headline; artes: Arte[] })
  | (ComPeca & { etapa: "escolhida" })
  | (ComPeca & { etapa: "legenda"; legenda: string });

export type Etapa = EtapaPost["etapa"];

export type Evento =
  | { tipo: "formato"; formato: Formato }
  | { tipo: "headline"; headline: Headline }
  | { tipo: "artes"; artes: Arte[] }
  | { tipo: "escolha"; variante: number }
  | { tipo: "foto"; arte: Arte; storyPath: string | null }
  | { tipo: "story"; path: string }
  | { tipo: "legenda"; legenda: string };

export type TipoEvento = Evento["tipo"];

/** De quais etapas cada evento pode partir. */
const ORIGEM = {
  formato: ["brief", "formato", "headline"],
  headline: ["formato", "headline", "artes"],
  artes: ["headline", "artes", "escolhida", "legenda"],
  escolha: ["artes", "escolhida", "legenda"],
  foto: ["formato", "headline", "artes", "escolhida"],
  story: ["escolhida", "legenda"],
  legenda: ["escolhida", "legenda"],
} as const satisfies Record<TipoEvento, readonly Etapa[]>;

export type Origem<T extends TipoEvento> = Extract<EtapaPost, { etapa: (typeof ORIGEM)[T][number] }>;

export type Permissao<P> = { ok: true; post: P } | { ok: false; motivo: string };

function naOrigem<T extends TipoEvento>(post: EtapaPost, tipo: T): post is Origem<T> {
  return (ORIGEM[tipo] as readonly Etapa[]).includes(post.etapa);
}

const formatoDe = (p: EtapaPost): Formato | null => (p.etapa === "brief" ? null : p.formato);

const precisaStory = (p: ComPeca) => p.formato === "ambos" && p.storyPath === null;

const PRONTO = "o Chefe publica com publicar_agora ou agenda com agendar_publicacao, com aprovação humana";

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
      if (p.formato === "stories") return PRONTO;
      return precisaStory(p) && p.peca.origem === "gerada" ? "derivar_story e depois escrever_legenda" : "escrever_legenda";
    case "legenda":
      return precisaStory(p) ? "derivar_story" : PRONTO;
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
            " Chame buscar_fotos e usar_foto. Se o banco não tiver foto que sirva, monte um brief novo com precisa_foto_real false" +
            " e um ângulo tipográfico que não mostre produto, obra nem pessoas, e gere a partir dele.",
        );
      if (!formato) return nao("Invariante 1: o formato não foi definido. Chame definir_formato.");
      if (post.etapa === "formato") return nao("Invariante 2: o headline vem antes da imagem. Chame definir_headline.");
      if ("peca" in post && post.peca.origem === "foto")
        return nao("A arte deste post é uma foto real do banco. Para gerar, monte um brief novo.");
      break;
    case "escolha":
      if ("peca" in post && post.peca.origem === "foto") return nao("A arte deste post é uma foto real do banco; não há variações para escolher.");
      break;
    case "legenda":
      if (formato === "stories") return nao("Invariante 3: stories não têm legenda. Não chame esta tool.");
      break;
    case "story":
      if (formato !== "ambos") return nao("derivar_story só existe no formato ambos.");
      if ("peca" in post && post.peca.origem === "foto")
        return nao("§8.2: a arte escolhida é uma foto real e não pode ser regenerada em 9:16. A versão vertical já saiu da própria foto.");
      break;
  }

  if (!naOrigem(post, tipo))
    return nao(`Fora de ordem: o post ${post.postId} está na etapa "${post.etapa}". Próximo passo: ${proximoPasso(post)}.`);
  return { ok: true, post };
}

/** Headline que alimenta uma nova geração. Uma escolhida de foto real já foi recusada por exigir. */
export function headlineParaGerar(p: Origem<"artes">): Headline | null {
  if (!("peca" in p)) return p.headline;
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
      const p = r.post;
      const opcoes = "peca" in p ? p.opcoes : p.artes;
      const headline = "peca" in p ? (p.peca.origem === "gerada" ? p.peca.headline : null) : p.headline;
      const arte = opcoes.find((a) => a.variant === evento.variante);
      if (!arte) return { ok: false, motivo: `Não existe a variação v${evento.variante}. As opções são ${opcoes.map((a) => `v${a.variant}`).join(", ")}.` };
      if (!headline) return { ok: false, motivo: "A arte deste post é uma foto real do banco; não há variações para escolher." };
      const { postId, brief, formato } = p;
      const mesma = "peca" in p && p.peca.arte.variant === arte.variant;
      const peca: Peca = { origem: "gerada", headline, arte };
      // A legenda é do brief e vale para qualquer variação; a versão 9:16 sai do conceito, então só fica se a arte for a mesma.
      const storyPath = mesma ? p.storyPath : null;
      if (p.etapa === "legenda") return ok({ etapa: "legenda", postId, brief, formato, peca, opcoes, storyPath, legenda: p.legenda });
      return ok({ etapa: "escolhida", postId, brief, formato, peca, opcoes, storyPath });
    }
    case "foto": {
      const r = exigir(post, "foto");
      if (!r.ok) return r;
      const { postId, brief, formato } = r.post;
      return ok({ etapa: "escolhida", postId, brief, formato, peca: { origem: "foto", arte: evento.arte }, opcoes: [evento.arte], storyPath: evento.storyPath });
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
  }
}

/** O JPEG e a legenda de uma publicação. Sai post com a peça escolhida, no formato que ele tem. */
export function midiaParaPublicar(
  post: EtapaPost | null,
  mediaType: MediaType,
): Permissao<{ postId: number; path: string; legenda: string | undefined }> {
  if (!post) return { ok: false, motivo: "Não há post em andamento nesta conversa." };
  if (!("peca" in post)) return { ok: false, motivo: `O post ainda não tem a peça escolhida. Próximo passo: ${proximoPasso(post)}.` };
  const { postId, formato, peca, storyPath } = post;
  const legenda = post.etapa === "escolhida" ? null : post.legenda;
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
    const comPeca: ComPeca = { ...base, formato, peca, opcoes: artes, storyPath: row.story_path };
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
};

export async function postDaConversa(conversaId: string): Promise<EtapaPost | null> {
  const row = await primeira(q<PostRow>`SELECT p.* FROM conversas c JOIN posts p ON p.id = c.post_id WHERE c.id = ${conversaId}`);
  return row ? lerLinha(row) : null;
}

/** O post pelo id, lido como a conversa lê o dela. É por onde a tela de calendário agenda. */
export async function postPorId(postId: number): Promise<EtapaPost | null> {
  const row = await primeira(q<PostRow>`SELECT * FROM posts WHERE id = ${postId}`);
  return row ? lerLinha(row) : null;
}

export async function abrirConversa(conversaId: string, botId: string): Promise<void> {
  await q`INSERT INTO conversas (id, bot_id) VALUES (${conversaId}, ${botId}) ON CONFLICT (id) DO NOTHING`;
}

/** Um brief novo abre um post novo e vira o post em andamento da conversa. */
export async function criarPost(conversaId: string, brief: Brief, formato: Formato | null): Promise<EtapaPost> {
  const { id } = (await primeira(q<{ id: number }>`INSERT INTO posts (brief, pilar, formato) VALUES (${JSON.stringify(brief)}, ${brief.pilar}, ${formato}) RETURNING id`))!;
  await q`UPDATE conversas SET post_id = ${id}, updated_at = ${utcDe(Date.now())} WHERE id = ${conversaId}`;
  const base: Base = { postId: id, brief };
  return formato ? { ...base, etapa: "formato", formato } : { ...base, etapa: "brief" };
}

export async function gravarPost(post: EtapaPost): Promise<void> {
  const formato = formatoDe(post);
  let headline: Headline | null = null;
  let artes: Arte[] | null = null;
  let chosen: number | null = null;
  let storyPath: string | null = null;
  let legenda: string | null = null;

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
      headline = post.peca.origem === "gerada" ? post.peca.headline : null;
      artes = post.opcoes;
      chosen = post.peca.arte.variant;
      storyPath = post.storyPath;
      if (post.etapa === "legenda") legenda = post.legenda;
      break;
  }

  await q`UPDATE posts SET formato = ${formato}, headline = ${headline && JSON.stringify(headline)}, arts = ${artes && JSON.stringify(artes)},
    chosen = ${chosen}, story_path = ${storyPath}, legenda = ${legenda}, status = ${STATUS[post.etapa]}
    WHERE id = ${post.postId}`;
  const daArte = (a: Arte): ImagemNova => ({
    path: a.path,
    tipo: a.style === "foto-real" ? "foto" : "variacao",
    variante: a.variant,
    estilo: a.style,
    formato: formato === "stories" ? "stories" : "feed",
  });
  const story: ImagemNova[] = storyPath ? [{ path: storyPath, tipo: "story", variante: null, estilo: null, formato: "stories" }] : [];
  await guardarImagens(post.postId, [...(artes ?? []).map(daArte), ...story]);
}
