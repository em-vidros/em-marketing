import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gravarArquivo } from "../../armazem";
import { generateArt, type Formato } from "./generate";
import { validarArte } from "./validate";
import type { Problema } from "../brand/validate";
import styleMap from "../../../styles/map.json";

export const PILARES = ["PROVA", "AUTORIDADE", "GENTE", "MARCA"] as const;
export type Pilar = (typeof PILARES)[number];

export interface Brief {
  /** §12.1 — todo post pertence a exatamente um pilar. */
  pilar: Pilar;
  tema: string;
  angulo?: string;
  data?: string;
  /**
   * §8.2 — a peça representa produto, obra, fábrica, maquinário ou pessoas da
   * EM Vidros? Se sim, ela exige foto real e não pode ser gerada.
   */
  precisaFotoReal?: boolean;
}

export interface ArtVariant {
  variant: number;
  style: string;
  path: string;
  /** Gate visual (§4, §6) — medido no JPEG final, ver art/validate.ts. */
  problemas: Problema[];
}

/** §3.5 — fundo escuro pede a versão branca do logotipo. */
const DARK_STYLES = new Set(["faixa-teal", "faixa-foto", "teal-parabens", "teal-chamada"]);

/** §8.2 — estilos que representam algo real e por isso nunca são gerados. */
const STYLES_SEM_GERACAO = new Set(["foto-real"]);

/** Estilos com foto ou cena cheia: as cores do mundo entram, e o gate de paleta não vale. */
export const STYLES_COM_CENA = new Set(["faixa-foto", "teal-parabens"]);

/** Quantas referências reais da EM Vidros acompanham cada geração. Mais que isso dilui o logo. */
const REFERENCIAS_POR_ARTE = 2;

/**
 * O que a marca não aceita em nenhuma arte. Os posts reais da @emvidros usam vidro 3D, brilho,
 * foto de arquitetura e fundo teal, então isso é permitido; a recusa é inventar o que parece real
 * da empresa (§8.2), mexer no logo ou fugir da família de cor.
 */
const NEGATIVOS_IA = `
HARD CONSTRAINTS (brand policy — violating any of these makes the image unusable):
- Do NOT depict identifiable people presented as EM Vidros employees, customers or partners. Generic people must be small, from behind or out of focus.
- Do NOT present anything as a real EM Vidros store, factory, truck, delivered project or product photo; that must be real photography. Aspirational architecture with glass is fine as inspiration.
- Do NOT invent a logo. The EM Vidros logo is supplied as the first reference image and must be reproduced faithfully, never redrawn or restyled. No other brand logos.
- Colour family: teal (#2F646A, #63B5AF and their tints and shades), white, off-white #F0EFEA, greys #414141 and #8A8A8A. Photographs may keep their natural colours. No purple, no blue as an accent, no neon.
- All text must be in correct Brazilian Portuguese, spelled exactly as given. No invented extra text, no lorem ipsum, no fake small print.
- The other reference images are real EM Vidros posts: follow their quality, finish and palette, never their exact text or layout.
`.trim();

/** As referências reais de um estilo, em ordem estável a partir de uma semente, para variar entre gerações. */
export function referenciasDoEstilo(styleId: string, semente = 0): string[] {
  const dir = `brand/referencias-posts/${styleId}`;
  if (!existsSync(dir)) return [];
  const arquivos = readdirSync(dir).filter((n) => n.endsWith(".jpg")).sort();
  if (!arquivos.length) return [];
  return Array.from({ length: Math.min(REFERENCIAS_POR_ARTE, arquivos.length) }, (_, i) => `${dir}/${arquivos[(semente + i) % arquivos.length]}`);
}

export function stylesFor(pilar: string): string[] {
  const trio = (styleMap as unknown as Record<string, string[]>)[pilar.toUpperCase()];
  return trio ?? ["teal-chamada", "faixa-foto", "vidro-3d"];
}

export function buildPrompt(opts: {
  styleId: string;
  formato: Formato;
  brief: Brief;
  headline: string;
  apoio?: string;
  /** Leituras das referências da Biblioteca: princípios a seguir, nunca o visual a copiar. */
  inspiracoes?: string[];
  /** O estilo que o usuário pediu, em palavras. Quando vem, manda sobre o estilo da casa. */
  direcao?: string;
}): string {
  if (STYLES_SEM_GERACAO.has(opts.styleId))
    throw new Error(`Estilo "${opts.styleId}" exige foto real (§8.2) e não pode ser gerado.`);

  const md = readFileSync(`styles/${opts.styleId}.md`, "utf8");
  const template = md.match(/```\n([\s\S]*?)```/)?.[1];
  if (!template) throw new Error(`Sem template em styles/${opts.styleId}.md`);

  // §6.2 — story tem topo de 250 px e base de 320 px cobertos pela interface.
  const formatDesc =
    opts.formato === "feed"
      ? "post (4:5 portrait, 1080x1350, 80px margins on all sides)"
      : "story (9:16 vertical, 1080x1920 — keep the top 250px and the bottom 320px free of any critical element; 80px side margins)";
  const desc = `${opts.brief.tema}${opts.brief.angulo ? ` — angle: ${opts.brief.angulo}` : ""}${opts.brief.data ? ` (date: ${opts.brief.data})` : ""} [content pillar: ${opts.brief.pilar}]`;

  const preenchido = template
    .replace("{FORMAT_DESC}", formatDesc)
    .replace("{TIPO_POST_DESCRIPTION}", desc)
    .replace("{HEADLINE}", opts.headline)
    .replace("{SUPPORT_LINES}", opts.formato === "feed" && opts.apoio ? `Support line: "${opts.apoio}"` : "");

  const inspiracao = opts.inspiracoes?.length
    ? `\n\nThe team saved these reference artworks for inspiration. Each note describes why one works. Apply the principles; never copy their subject, layout, colors or text:\n${opts.inspiracoes.map((l) => `- ${l}`).join("\n")}`
    : "";
  const direcao = opts.direcao
    ? `\n\nART DIRECTION FROM THE CLIENT (this overrides the visual language above wherever they conflict; keep the brand logo, colour family and professional agency quality):\n${opts.direcao}`
    : "";
  return `${preenchido}${inspiracao}${direcao}\n\n${NEGATIVOS_IA}`;
}

/** US-3: gera exatamente 3 variações em estilos distintos, em paralelo. */
export async function generate3Arts(opts: {
  postId: number;
  brief: Brief;
  formato: Formato;
  headline: string;
  apoio?: string;
  styles?: string[];
  inspiracoes?: string[];
  /** Estilo pedido pelo usuário. As 3 variações seguem a direção, cada uma sobre a base de um estilo da casa. */
  direcao?: string;
  /** Imagens de referência que o usuário mandou (bytes já baixados). Vão para as 3 variações. */
  referenciasDoUsuario?: Uint8Array[];
}): Promise<ArtVariant[]> {
  if (opts.brief.precisaFotoReal)
    throw new Error(
      "§8.2: este post representa produto, obra, fábrica ou pessoas da EM Vidros e exige foto real. Peça a foto ao usuário em vez de gerar.",
    );

  const styles = (opts.styles ?? stylesFor(opts.brief.pilar)).filter((s) => !STYLES_SEM_GERACAO.has(s));
  if (styles.length < 3) throw new Error(`Só ${styles.length} estilos geráveis para o pilar ${opts.brief.pilar}.`);
  // A semente muda a cada geração do mesmo post, então "gerar de novo" mostra outras referências ao modelo.
  const semente = Math.floor(Date.now() / 1000);
  const doUsuario = opts.referenciasDoUsuario ?? [];

  return Promise.all(
    styles.slice(0, 3).map(async (styleId, i) => {
      const daCasa = referenciasDoEstilo(styleId, semente + i).slice(0, doUsuario.length ? 1 : REFERENCIAS_POR_ARTE);
      const jpeg = await generateArt({
        prompt: buildPrompt({ styleId, formato: opts.formato, brief: opts.brief, headline: opts.headline, apoio: opts.apoio, inspiracoes: opts.inspiracoes, direcao: opts.direcao }),
        formato: opts.formato,
        logoVariant: DARK_STYLES.has(styleId) ? "branco" : "cor",
        referencias: [...daCasa.map((c) => readFileSync(c)), ...doUsuario],
      });
      const estilo = opts.direcao ? `${styleId}+pedido` : styleId;
      const path = await gravarArquivo("arts", `post${opts.postId}-${opts.formato}-v${i + 1}-${styleId}.jpg`, jpeg, "image/jpeg");
      const problemas = await validarArte(jpeg, opts.formato, { paleta: !STYLES_COM_CENA.has(styleId) && !opts.direcao });
      return { variant: i + 1, style: estilo, path, problemas };
    }),
  );
}

const estiloBase = (style: string) => style.replace(/\+pedido$/, "");

/** Fluxo "Os dois": deriva a versão Stories do conceito escolhido. */
export async function deriveStory(opts: {
  postId: number;
  brief: Brief;
  headline: string;
  chosen: ArtVariant;
}): Promise<{ path: string; problemas: Problema[] }> {
  const jpeg = await generateArt({
    prompt:
      buildPrompt({ styleId: estiloBase(opts.chosen.style), formato: "stories", brief: opts.brief, headline: opts.headline }) +
      "\n\nIMPORTANT: keep the exact same visual concept, colors, hero element and mood as the second reference image — this is the 9:16 Stories adaptation of that approved artwork, recomposed for vertical (not cropped).",
    formato: "stories",
    logoVariant: DARK_STYLES.has(estiloBase(opts.chosen.style)) ? "branco" : "cor",
    base: opts.chosen.path,
  });
  const path = await gravarArquivo("arts", `post${opts.postId}-stories-derived.jpg`, jpeg, "image/jpeg");
  return { path, problemas: await validarArte(jpeg, "stories", { paleta: !STYLES_COM_CENA.has(estiloBase(opts.chosen.style)) }) };
}
