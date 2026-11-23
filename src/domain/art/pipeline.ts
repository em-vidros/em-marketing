import { gravarArquivo } from "../../armazem";
import { generateArt, type Formato } from "./generate";
import { aplicarLogo } from "./logo";
import { validarArte } from "./validate";
import type { Problema } from "../brand/validate";

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

/** Uma referência da Biblioteca pronta para o modelo de imagem: a própria imagem em JPEG e a leitura da equipe. */
export interface ReferenciaParaGerar {
  id: string;
  leitura: string;
  imagem: Uint8Array;
}

export interface ArtVariant {
  variant: number;
  /** A referência da Biblioteca que guiou a variação. Null quando a Biblioteca não tinha nenhuma ou não respondeu. */
  referencia: string | null;
  path: string;
  /** Gate visual (§4, §6) — medido no JPEG final, ver art/validate.ts. */
  problemas: Problema[];
}

/** De onde vem a cara da arte: uma referência da Biblioteca, o visual padrão da casa, ou a arte de feed que a story adapta. */
export type Visual = { tipo: "referencia"; leitura: string } | { tipo: "casa" } | { tipo: "adaptacao" };

/**
 * O que a marca não aceita em nenhuma arte. Os posts reais da @emvidros usam vidro 3D, brilho,
 * foto de arquitetura e fundo teal, então isso é permitido; a recusa é inventar o que parece real
 * da empresa (§8.2), mexer no logo ou fugir da família de cor.
 */
const NEGATIVOS_IA = `
HARD CONSTRAINTS (brand policy; violating any of these makes the image unusable):
- Do NOT depict identifiable people presented as EM Vidros employees, customers or partners. Generic people must be small, from behind or out of focus.
- Do NOT present anything as a real EM Vidros store, factory, truck, delivered project or product photo; that must be real photography. Aspirational architecture with glass is fine as inspiration.
- Do NOT draw any logo, brand mark, emblem or the words "EM Vidros" / "VIDROS" anywhere. The official logo is placed afterwards by the design team. Ignore the logos that appear in the reference images. No other brand logos either.
- Colour family: teal (#2F646A, #63B5AF and their tints and shades), white, off-white #F0EFEA, greys #414141 and #8A8A8A. Photographs may keep their natural colours. No purple, no blue as an accent, no neon.
- All text must be in correct Brazilian Portuguese, spelled exactly as given. No invented extra text, no lorem ipsum, no fake small print.
- The reference images are EM Vidros-approved pieces. Follow their look, never their text or logo.
`.trim();

/** §6.2: a story tem topo de 250 px e base de 320 px cobertos pela interface do Instagram. */
const FORMATOS_DO_PROMPT: Record<Formato, { descricao: string; tela: string }> = {
  feed: { descricao: "post (4:5 portrait, 1080x1350, 80px margins on all sides)", tela: "1080x1350" },
  stories: {
    descricao: "story (9:16 vertical, 1080x1920; keep the top 250px and the bottom 320px free of any critical element; 80px side margins)",
    tela: "1080x1920, above the bottom 320px",
  },
};

/** O prompt comum a toda arte. A cara vem da referência em {VISUAL}; o resto é formato, texto, área do logo e proibições. */
const MOLDE = `A premium Instagram {FORMATO} for "EM Vidros", a Brazilian flat-glass and aluminium distributor.

{TEMA}

{VISUAL}

{ANEXOS}

{DIRECAO}

TEXT IN THE ART (render EXACTLY, in Brazilian Portuguese, no spelling changes, no emoji):
Headline: "{HEADLINE}"
{APOIO}

LOGO AREA: keep the bottom-right corner (about 260x220px of the final {TELA} canvas) clean and calm, with no text and no key element, because the official logo goes there.

{NEGATIVOS}`;

export function buildPrompt(opts: {
  formato: Formato;
  brief: Brief;
  headline: string;
  apoio?: string;
  visual: Visual;
  /** Quantas imagens que o usuário mandou na conversa vão depois da referência. */
  anexos?: number;
  /** O estilo que o usuário pediu, em palavras. Quando vem, manda sobre o visual da referência. */
  direcao?: string;
}): string {
  const { formato, brief, visual, anexos = 0 } = opts;
  const partes: Record<string, string> = {
    FORMATO: FORMATOS_DO_PROMPT[formato].descricao,
    TEMA: `${brief.tema}${brief.angulo ? `, angle: ${brief.angulo}` : ""}${brief.data ? ` (date: ${brief.data})` : ""} [content pillar: ${brief.pilar}]`,
    VISUAL: linguagemVisual(visual),
    ANEXOS: anexos > 0 ? `EXTRA IMAGES: the ${visual.tipo === "referencia" ? "images after the first one" : "attached images"} were sent by the client in the chat. Use them for what they show (a subject, a mood, a detail), never as a reason to drop the visual language above.` : "",
    DIRECAO: opts.direcao
      ? `ART DIRECTION FROM THE CLIENT (this overrides the visual language above wherever they conflict; keep the colour family and professional agency quality):\n${opts.direcao}`
      : "",
    HEADLINE: opts.headline,
    APOIO: formato === "feed" && opts.apoio ? `Support line: "${opts.apoio}"` : "",
    TELA: FORMATOS_DO_PROMPT[formato].tela,
    NEGATIVOS: NEGATIVOS_IA,
  };

  // Função no replace: texto do usuário com "$&" ou "{TEMA}" entra como está.
  return MOLDE.replace(/\{([A-Z]+)\}/g, (marca, chave: string) => partes[chave] ?? marca).replace(/\n{3,}/g, "\n\n");
}

function linguagemVisual(visual: Visual): string {
  switch (visual.tipo) {
    case "referencia":
      return `VISUAL LANGUAGE: match the visual language of the first reference image (palette, composition, typography, finish). It is an EM Vidros-approved piece. Never copy its text, subject, layout details or logo.\nThe EM Vidros team's note about it: ${visual.leitura}`;
    case "casa":
      return "VISUAL LANGUAGE: the EM Vidros house look. Teal family (#2F646A, #63B5AF) with white and off-white #F0EFEA, one clear focal element, a bold geometric sans headline with strong weight contrast, generous margins and a clean, premium advertising-agency finish.";
    case "adaptacao":
      return "VISUAL LANGUAGE: the supplied image is the approved feed artwork. Keep its exact visual concept, colours, hero element, typography and mood. This is its 9:16 Stories adaptation, recomposed for vertical, not cropped. Leave out its logo; the official logo is added afterwards.";
  }
}

/**
 * US-3: gera 3 variações em paralelo, cada uma ancorada numa referência diferente da Biblioteca.
 * Sem referência, a variação sai no visual padrão da casa. `gerar` só muda nos testes.
 */
export async function generate3Arts(
  opts: {
    postId: number;
    brief: Brief;
    formato: Formato;
    headline: string;
    apoio?: string;
    /** Estilo pedido pelo usuário. As 3 variações seguem a direção, cada uma sobre a base da sua referência. */
    direcao?: string;
    referencias: readonly ReferenciaParaGerar[];
    /** Imagens que o usuário mandou na conversa (bytes já baixados). Vão nas 3 variações, depois da referência. */
    anexos: readonly Uint8Array[];
  },
  gerar = generateArt,
): Promise<ArtVariant[]> {
  if (opts.brief.precisaFotoReal)
    throw new Error(
      "§8.2: este post representa produto, obra, fábrica ou pessoas da EM Vidros e exige foto real. Peça a foto ao usuário em vez de gerar.",
    );

  const { postId, brief, formato, headline, apoio, direcao, referencias, anexos } = opts;
  // A semente entra no nome do arquivo: gerar de novo não sobrescreve as variações anteriores, que ficam na Biblioteca.
  const semente = Math.floor(Date.now() / 1000);

  return Promise.all(
    [1, 2, 3].map(async (variant, i) => {
      const ancora = referencias.length > 0 ? referencias[i % referencias.length] : undefined;
      const visual: Visual = ancora ? { tipo: "referencia", leitura: ancora.leitura } : { tipo: "casa" };
      const prompt = buildPrompt({ formato, brief, headline, apoio, visual, anexos: anexos.length, direcao });
      const gerada = await gerar({ prompt, formato, referencias: [...(ancora ? [ancora.imagem] : []), ...anexos] });

      const jpeg = await aplicarLogo(gerada, formato);
      const path = await gravarArquivo("arts", `post${postId}-${formato}-v${variant}-${semente}.jpg`, jpeg, "image/jpeg");
      // A paleta só se mede no visual da casa: a referência e a direção do usuário trazem as cores delas, muitas vezes de foto.
      const problemas = await validarArte(jpeg, formato, { paleta: !ancora && !direcao });

      return { variant, referencia: ancora?.id ?? null, path, problemas };
    }),
  );
}

/** Fluxo "Os dois": deriva a versão Stories do conceito escolhido, com a arte escolhida como base. `gerar` só muda nos testes. */
export async function deriveStory(
  opts: {
    postId: number;
    brief: Brief;
    headline: string;
    chosen: ArtVariant;
  },
  gerar = generateArt,
): Promise<{ path: string; problemas: Problema[] }> {
  const gerada = await gerar({
    prompt: buildPrompt({ formato: "stories", brief: opts.brief, headline: opts.headline, visual: { tipo: "adaptacao" } }),
    formato: "stories",
    base: opts.chosen.path,
  });
  const jpeg = await aplicarLogo(gerada, "stories");
  const path = await gravarArquivo("arts", `post${opts.postId}-stories-derived-${Math.floor(Date.now() / 1000)}.jpg`, jpeg, "image/jpeg");

  return { path, problemas: await validarArte(jpeg, "stories", { paleta: opts.chosen.referencia === null }) };
}
