import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateArt, type Formato } from "./generate";
import { reviewArt, refineInstruction, type ArtReview } from "./review";
import styleMap from "../../styles/map.json";

export interface Brief {
  tipo: keyof typeof styleMap | string;
  tema: string;
  angulo?: string;
  data?: string;
}

export interface ArtQa {
  tentativas: number;
  aprovada: boolean;
  score: number;
  pendencias: string[];
}

export interface ArtVariant {
  variant: number;
  style: string;
  path: string;
  interactionId: string;
  qa?: ArtQa;
}

const DARK_STYLES = new Set(["premium-escuro"]);

const MAX_ATTEMPTS = Math.max(1, Number(process.env.ART_MAX_ATTEMPTS ?? "3"));

/** Gera → julga → refina via previous_interaction_id, até aprovação ou teto (loop determinístico). */
async function generateWithQa(opts: {
  prompt: string;
  formato: Formato;
  logoVariant: "cor" | "branco";
  headline: string;
  tema: string;
  baseInteractionId?: string;
}): Promise<{ jpeg: Buffer; interactionId: string; qa: ArtQa }> {
  let interactionId: string | undefined = opts.baseInteractionId;
  let review: ArtReview | null = null;
  for (let attempt = 1; ; attempt++) {
    const r = await generateArt({
      prompt: attempt === 1 ? opts.prompt : refineInstruction(review!.violacoes),
      formato: opts.formato,
      logoVariant: opts.logoVariant,
      previousInteractionId: interactionId,
    });
    interactionId = r.interactionId;
    review = await reviewArt({
      jpeg: r.jpeg,
      formato: opts.formato,
      headline: opts.headline,
      tema: opts.tema,
    });
    if (review.aprovada || attempt >= MAX_ATTEMPTS) {
      return {
        jpeg: r.jpeg,
        interactionId: r.interactionId,
        qa: {
          tentativas: attempt,
          aprovada: review.aprovada,
          score: review.score,
          pendencias: review.violacoes.map((v) => `${v.criterio}: ${v.problema}`),
        },
      };
    }
  }
}

export function stylesFor(tipo: string): string[] {
  const trio = (styleMap as unknown as Record<string, string[]>)[tipo];
  return trio ?? ["minimal-editorial", "tipografico-bold", "produto-3d"];
}

export function buildPrompt(opts: {
  styleId: string;
  formato: Formato;
  brief: Brief;
  headline: string;
  apoio?: string;
}): string {
  const md = readFileSync(`styles/${opts.styleId}.md`, "utf8");
  const template = md.match(/```\n([\s\S]*?)```/)?.[1];
  if (!template) throw new Error(`Sem template em styles/${opts.styleId}.md`);
  const formatDesc =
    opts.formato === "feed"
      ? "post (4:5 portrait, 1080x1350)"
      : "story (9:16 vertical, 1080x1920 — keep the top 250px and bottom 250px free of any critical element)";
  const desc = `${opts.brief.tema}${opts.brief.angulo ? ` — angle: ${opts.brief.angulo}` : ""}${opts.brief.data ? ` (date: ${opts.brief.data})` : ""}`;
  return template
    .replace("{FORMAT_DESC}", formatDesc)
    .replace("{TIPO_POST_DESCRIPTION}", desc)
    .replace("{HEADLINE}", opts.headline)
    .replace(
      "{SUPPORT_LINES}",
      opts.formato === "feed" && opts.apoio ? `Support line: "${opts.apoio}"` : "",
    );
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
  const styles = opts.styles ?? stylesFor(opts.brief.tipo);
  mkdirSync("data/arts", { recursive: true });
  const results = await Promise.all(
    styles.slice(0, 3).map(async (styleId, i) => {
      const { jpeg, interactionId, qa } = await generateWithQa({
        prompt: buildPrompt({ styleId, formato: opts.formato, brief: opts.brief, headline: opts.headline, apoio: opts.apoio }),
        formato: opts.formato,
        logoVariant: DARK_STYLES.has(styleId) ? "branco" : "cor",
        headline: opts.headline,
        tema: opts.brief.tema,
      });
      const path = `data/arts/post${opts.postId}-${opts.formato}-v${i + 1}-${styleId}.jpg`;
      writeFileSync(path, jpeg);
      return { variant: i + 1, style: styleId, path, interactionId, qa };
    }),
  );
  return results;
}

/** Fluxo "Os dois": deriva a versão Stories do conceito escolhido. */
export async function deriveStory(opts: {
  postId: number;
  brief: Brief;
  headline: string;
  chosen: ArtVariant;
}): Promise<{ path: string; qa: ArtQa }> {
  const { jpeg, qa } = await generateWithQa({
    prompt:
      buildPrompt({ styleId: opts.chosen.style, formato: "stories", brief: opts.brief, headline: opts.headline }) +
      "\n\nIMPORTANT: keep the exact same visual concept, colors, hero element and mood as the previous image — this is the 9:16 Stories adaptation of that approved artwork, recomposed for vertical (not cropped).",
    formato: "stories",
    logoVariant: DARK_STYLES.has(opts.chosen.style) ? "branco" : "cor",
    headline: opts.headline,
    tema: opts.brief.tema,
    baseInteractionId: opts.chosen.interactionId,
  });
  const path = `data/arts/post${opts.postId}-stories-derived.jpg`;
  writeFileSync(path, jpeg);
  return { path, qa };
}
