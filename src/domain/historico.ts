import { q } from "../v2/banco";
import { credenciais } from "./instagram/meta-login";

/**
 * O que a EM Vidros já aprovou, para cada geração nova seguir a mesma linha e superar a anterior.
 * Duas fontes: os posts que a equipe aprovou neste sistema (arte escolhida, agendados ou publicados)
 * e as legendas mais curtidas do feed real do Instagram. Quanto mais posts saem, mais exemplos entram.
 */
export interface PostDaMarca {
  origem: "aprovado aqui" | "feed do Instagram";
  pilar: string | null;
  headline: string | null;
  legenda: string | null;
  curtidas?: number;
}

const POR_FONTE = 6;
const CACHE_DO_FEED_MS = 60 * 60_000;
let feed: { em: number; posts: PostDaMarca[] } | null = null;

async function aprovadosAqui(): Promise<PostDaMarca[]> {
  const linhas = await q<{ pilar: string | null; headline: string | null; legenda: string | null }>`SELECT pilar, headline, legenda FROM posts
    WHERE (chosen IS NOT NULL OR status IN ('scheduled','published')) AND (headline IS NOT NULL OR legenda IS NOT NULL)
    ORDER BY id DESC LIMIT ${POR_FONTE}`;
  return linhas.map((l) => ({ origem: "aprovado aqui", ...l }));
}

/** As legendas do feed, das mais curtidas para baixo. Sem Instagram conectado, ou com a API fora, fica vazio. */
async function doFeed(): Promise<PostDaMarca[]> {
  if (feed && Date.now() - feed.em < CACHE_DO_FEED_MS) return feed.posts;
  try {
    const { igUserId, pageToken } = await credenciais();
    const url = `https://graph.facebook.com/v23.0/${igUserId}/media?fields=caption,like_count&limit=25&access_token=${encodeURIComponent(pageToken)}`;
    const json = (await (await fetch(url, { signal: AbortSignal.timeout(4000) })).json()) as { data?: { caption?: string; like_count?: number }[] };
    const posts = (json.data ?? [])
      .filter((m) => m.caption?.trim())
      .sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
      .slice(0, POR_FONTE)
      .map((m): PostDaMarca => ({ origem: "feed do Instagram", pilar: null, headline: null, legenda: m.caption!.trim(), curtidas: m.like_count ?? 0 }));
    feed = { em: Date.now(), posts };
  } catch {
    feed = { em: Date.now(), posts: [] };
  }
  return feed.posts;
}

export async function postsDaMarca(): Promise<PostDaMarca[]> {
  const [aqui, instagram] = await Promise.all([aprovadosAqui().catch(() => []), doFeed()]);
  return [...aqui, ...instagram];
}

const linha = (p: PostDaMarca) =>
  [
    `- [${p.origem}${p.pilar ? `, ${p.pilar}` : ""}${p.curtidas !== undefined ? `, ${p.curtidas} curtidas` : ""}]`,
    p.headline && `headline: "${p.headline}"`,
    p.legenda && `legenda: "${p.legenda.slice(0, 400).replace(/\n+/g, " / ")}"`,
  ]
    .filter(Boolean)
    .join(" ");

/** O bloco que vai no prompt de headline e legenda. Vazio quando ainda não há exemplo. */
export function comoExemplos(posts: readonly PostDaMarca[]): string {
  if (posts.length === 0) return "";
  return [
    "",
    "Posts que a EM Vidros já aprovou, do mais recente para trás. Siga a mesma voz e o mesmo nível de concretude.",
    "Não repita headline, gancho nem estrutura de nenhum deles: a peça nova tem de ser melhor que estes.",
    ...posts.map(linha),
  ].join("\n");
}

/**
 * As últimas variações que a equipe escolheu, como nota para o gerador de arte: o estilo que ganhou
 * das outras duas naquele pilar. Vai junto das leituras da Biblioteca em gerar_3_artes.
 */
export async function escolhasDeArte(): Promise<string[]> {
  const linhas = await q<{ pilar: string | null; arts: string | null; chosen: number; headline: string | null }>`SELECT pilar, arts, chosen, headline FROM posts
    WHERE chosen IS NOT NULL AND arts IS NOT NULL ORDER BY id DESC LIMIT ${POR_FONTE}`;
  return linhas.flatMap((l) => {
    const estilo = (JSON.parse(l.arts!) as { variant: number; style: string }[]).find((a) => a.variant === l.chosen)?.style;
    if (!estilo || estilo === "foto-real") return [];
    return [`An EM Vidros team member recently picked the "${estilo}" variant over the other two for a ${l.pilar ?? "brand"} post${l.headline ? ` headlined "${l.headline}"` : ""}. Treat it as evidence of what the team approves and push that direction further.`];
  });
}
