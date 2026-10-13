import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateArt, type Formato } from "./generate";
import { validarArte } from "./validate";
import type { Problema } from "../brand/validate";
import styleMap from "../../styles/map.json";

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
  interactionId: string;
  /** Gate visual (§4, §6) — medido no JPEG final, ver art/validate.ts. */
  problemas: Problema[];
}

/** §3.5 — fundo escuro pede a versão branca do logotipo. */
const DARK_STYLES = new Set(["faixa-teal"]);

/** §8.2 — estilos que representam algo real e por isso nunca são gerados. */
const STYLES_SEM_GERACAO = new Set(["foto-real"]);

/**
 * §8.2 vira instrução negativa explícita em todo prompt. O modelo já recebe o
 * estilo, mas a norma é recusa, não preferência — vale repetir na borda.
 */
const NEGATIVOS_IA = `
HARD CONSTRAINTS (brand policy — violating any of these makes the image unusable):
- Do NOT depict a real-looking photograph of a finished installation, a construction site, a factory floor, machinery, or any identifiable person. Those must be real photography, never generated.
- Do NOT depict a photorealistic EM Vidros product (glass panel, box, guard-rail, mirror, window) as if it were a real product photo.
- Abstract backgrounds, conceptual scenes, non-photographic graphic elements and typography are fine.
- Do NOT use glossy 3D renders, specular highlights, bevels, drop shadows or background gradients — the system is flat and matte. Texture suggests a factory; gloss suggests a render.
- Do NOT invent a logo. The EM Vidros logo is supplied as a reference image and must be reproduced faithfully, never redrawn or restyled.
- Colours are restricted to #2F646A, #63B5AF, #414141, #FFFFFF, #F0EFEA, #E4E1D8, #D8D5CE, #8A8A8A. No other hue appears.
`.trim();

export function stylesFor(pilar: string): string[] {
  const trio = (styleMap as unknown as Record<string, string[]>)[pilar.toUpperCase()];
  return trio ?? ["tecnico-poppins", "cartela-rotulo", "dado-numero"];
}

export function buildPrompt(opts: {
  styleId: string;
  formato: Formato;
  brief: Brief;
  headline: string;
  apoio?: string;
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

  return `${preenchido}\n\n${NEGATIVOS_IA}`;
}

/** US-3: gera exatamente 3 variações em estilos distintos, em paralelo. */
export async function generate3Arts(opts: {
  postId: number;
  brief: Brief;
  formato: Formato;
  headline: string;
  apoio?: string;
  styles?: string[];
}): Promise<ArtVariant[]> {
  if (opts.brief.precisaFotoReal)
    throw new Error(
      "§8.2: este post representa produto, obra, fábrica ou pessoas da EM Vidros e exige foto real. Peça a foto ao usuário em vez de gerar.",
    );

  const styles = (opts.styles ?? stylesFor(opts.brief.pilar)).filter((s) => !STYLES_SEM_GERACAO.has(s));
  if (styles.length < 3) throw new Error(`Só ${styles.length} estilos geráveis para o pilar ${opts.brief.pilar}.`);

  mkdirSync("data/arts", { recursive: true });
  return Promise.all(
    styles.slice(0, 3).map(async (styleId, i) => {
      const { jpeg, interactionId } = await generateArt({
        prompt: buildPrompt({ styleId, formato: opts.formato, brief: opts.brief, headline: opts.headline, apoio: opts.apoio }),
        formato: opts.formato,
        logoVariant: DARK_STYLES.has(styleId) ? "branco" : "cor",
      });
      const path = `data/arts/post${opts.postId}-${opts.formato}-v${i + 1}-${styleId}.jpg`;
      writeFileSync(path, jpeg);
      const problemas = await validarArte(jpeg, opts.formato);
      return { variant: i + 1, style: styleId, path, interactionId, problemas };
    }),
  );
}

/** Fluxo "Os dois": deriva a versão Stories do conceito escolhido. */
export async function deriveStory(opts: {
  postId: number;
  brief: Brief;
  headline: string;
  chosen: ArtVariant;
}): Promise<{ path: string; problemas: Problema[] }> {
  const { jpeg } = await generateArt({
    prompt:
      buildPrompt({ styleId: opts.chosen.style, formato: "stories", brief: opts.brief, headline: opts.headline }) +
      "\n\nIMPORTANT: keep the exact same visual concept, colors, hero element and mood as the previous image — this is the 9:16 Stories adaptation of that approved artwork, recomposed for vertical (not cropped).",
    formato: "stories",
    logoVariant: DARK_STYLES.has(opts.chosen.style) ? "branco" : "cor",
    previousInteractionId: opts.chosen.interactionId,
  });
  const path = `data/arts/post${opts.postId}-stories-derived.jpg`;
  writeFileSync(path, jpeg);
  return { path, problemas: await validarArte(jpeg, "stories") };
}
