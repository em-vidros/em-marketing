import { gravarArquivo } from "../../armazem";
import { tokens } from "../brand";
import { gerarConferida } from "./conferencia";
import { generateArt, lerTextoDaArte, type Formato } from "./generate";
import { aplicarLogo } from "./logo";
import { validarArte } from "./validate";
import type { Problema } from "../brand/validate";
import type { Publico } from "../publico";

export const PILARES = ["PROVA", "AUTORIDADE", "GENTE", "MARCA"] as const;
export type Pilar = (typeof PILARES)[number];

export interface Brief {
  /** §12.1 — todo post pertence a exatamente um pilar. */
  pilar: Pilar;
  /** §1.2 — para quem o post fala. A chamada da headline e da legenda segue o público. Brief antigo não tem. */
  publico?: Publico;
  tema: string;
  angulo?: string;
  data?: string;
  /**
   * §8.2 — a peça representa produto, obra, fábrica, maquinário ou pessoas da
   * EM Vidros? Se sim, ela exige foto real e não pode ser gerada.
   */
  precisaFotoReal?: boolean;
}

/**
 * A imagem que guiou uma variação: uma referência da Biblioteca, com a leitura da equipe, ou uma imagem que a
 * pessoa colou no pedido, que ninguém leu. `arquivo` é a chave em /api/arquivos.
 */
export type Ancora = { origem: "biblioteca"; id: string; arquivo: string; leitura: string } | { origem: "pedido"; arquivo: string };

/** Uma âncora pronta para o modelo de imagem, com a própria imagem em JPEG. */
export type ReferenciaParaGerar = Ancora & { imagem: Uint8Array };

export interface ArtVariant {
  variant: number;
  /**
   * A imagem que guiou a variação. Null: a variação saiu no visual da casa.
   * Ausente nas artes gravadas antes das referências no chat, que não guardavam a imagem.
   */
  ancora?: Ancora | null;
  /** Só nas artes gravadas antes das referências no chat: o id da referência que guiou, sem a imagem. */
  referencia?: string;
  path: string;
  /** Gate visual (§4, §6) — medido no JPEG final, ver art/validate.ts. */
  problemas: Problema[];
  /** As versões de antes dos ajustes, a mais recente por último. Voltar tira a última daqui. */
  anteriores?: VersaoAnterior[];
}

/** Uma versão da arte antes de um ajuste, com a story que valia para ela. */
export interface VersaoAnterior {
  path: string;
  problemas: Problema[];
  storyPath: string | null;
}

/** De onde vem a cara da arte: uma referência da Biblioteca, uma imagem do pedido ou o visual padrão da casa. */
export type Visual = { tipo: "referencia"; leitura: string } | { tipo: "pedido" } | { tipo: "casa" };

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

/** §6.2: o topo e a base da story ficam cobertos pela interface do Instagram. */
const { topPx: TOPO, bottomPx: BASE } = tokens.formats.stories.safeZones;

const FORMATOS_DO_PROMPT: Record<Formato, { descricao: string; tela: string }> = {
  feed: { descricao: "post (4:5 portrait, 1080x1350, 80px margins on all sides)", tela: "1080x1350" },
  stories: {
    descricao: `story (9:16 vertical, 1080x1920; keep the top ${TOPO}px and the bottom ${BASE}px free of any critical element; 80px side margins)`,
    tela: `1080x1920, above the bottom ${BASE}px`,
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

/** O texto que o prompt manda pintar na arte, na ordem do prompt. É o que a conferência procura na arte pronta. */
export const textosDaArte = (formato: Formato, headline: string, apoio?: string): string[] => [headline, ...(formato === "feed" && apoio ? [apoio] : [])];

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
  const [, apoio] = textosDaArte(formato, opts.headline, opts.apoio);
  const partes: Record<string, string> = {
    FORMATO: FORMATOS_DO_PROMPT[formato].descricao,
    TEMA: `${brief.tema}${brief.angulo ? `, angle: ${brief.angulo}` : ""}${brief.data ? ` (date: ${brief.data})` : ""} [content pillar: ${brief.pilar}]`,
    VISUAL: linguagemVisual(visual),
    ANEXOS: anexos > 0 ? `EXTRA IMAGES: the ${visual.tipo === "referencia" || visual.tipo === "pedido" ? "images after the first one" : "attached images"} were sent by the client in the chat. Use them for what they show (a subject, a mood, a detail), never as a reason to drop the visual language above.` : "",
    DIRECAO: opts.direcao
      ? `ART DIRECTION FROM THE CLIENT (this overrides the visual language above wherever they conflict; keep the colour family and professional agency quality):\n${opts.direcao}`
      : "",
    HEADLINE: opts.headline,
    APOIO: apoio ? `Support line: "${apoio}"` : "",
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
    case "pedido":
      return "VISUAL LANGUAGE: match the visual language of the first image (palette, composition, typography, finish). The client attached it to this request to show the look they want. Never copy its text, subject, layout details or logo.";
    case "casa":
      return "VISUAL LANGUAGE: the EM Vidros house look. Teal family (#2F646A, #63B5AF) with white and off-white #F0EFEA, one clear focal element, a bold geometric sans headline with strong weight contrast, generous margins and a clean, premium advertising-agency finish.";
  }
}

/** Os modelos que o pipeline chama. Os testes trocam os dois juntos, para nenhum teste chegar à OpenAI. */
export interface IaDaArte {
  gerar: typeof generateArt;
  lerTexto: (jpeg: Uint8Array) => Promise<string[]>;
}

const IA_DA_OPENAI: IaDaArte = { gerar: generateArt, lerTexto: lerTextoDaArte };

/**
 * US-3: gera 3 variações em paralelo, cada uma ancorada numa imagem diferente, da Biblioteca ou do pedido.
 * Sem âncora, a variação sai no visual padrão da casa. `ia` só muda nos testes.
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
    /** As âncoras, uma por variação, em rodízio quando vêm menos de 3. */
    referencias: readonly ReferenciaParaGerar[];
    /** Imagens extras do pedido (links colados, escolhas além da terceira). Vão nas 3 variações, depois da âncora. */
    anexos: readonly Uint8Array[];
    /** Chamada a cada variação pronta, na ordem em que terminam, para a conversa mostrar a arte sem esperar as 3. */
    aoFicarPronta?: (arte: ArtVariant) => void;
  },
  ia: IaDaArte = IA_DA_OPENAI,
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
      const visual: Visual = !ancora ? { tipo: "casa" } : ancora.origem === "biblioteca" ? { tipo: "referencia", leitura: ancora.leitura } : { tipo: "pedido" };
      const prompt = buildPrompt({ formato, brief, headline, apoio, visual, anexos: anexos.length, direcao });
      // A conferência lê a arte antes do logo: o logo colado não é texto pedido.
      const pedido = { prompt, formato, referencias: [...(ancora ? [ancora.imagem] : []), ...anexos] };
      const { gerada, problemas: doTexto } = await gerarConferida(comLembrete(ia, pedido), ia.lerTexto, textosDaArte(formato, headline, apoio));

      const jpeg = await aplicarLogo(gerada, formato);
      const path = await gravarArquivo("arts", `post${postId}-${formato}-v${variant}-${semente}.jpg`, jpeg, "image/jpeg");
      // A paleta só se mede no visual da casa: a referência e a direção do usuário trazem as cores delas, muitas vezes de foto.
      const problemas = [...doTexto, ...(await validarArte(jpeg, formato, { paleta: !ancora && !direcao }))];

      const arte: ArtVariant = { variant, ancora: ancora ? semImagem(ancora) : null, path, problemas };
      opts.aoFicarPronta?.(arte);
      return arte;
    }),
  );
}

/**
 * A story da arte escolhida, numa geração só: o modelo recebe a arte de feed e a recompõe em 9:16, com a mesma cena e o
 * mesmo texto. Sem o pedido explícito de sangrar até a borda, o modelo cola o quadro do feed no meio, com faixas.
 */
export function promptDaStory(opts: { brief: Brief; headline: string; apoio?: string }): string {
  const fim = 1920 - BASE;
  return `Recompose the attached image as its native Instagram Story. The attached image is an approved Instagram feed post (4:5) by "EM Vidros", a Brazilian flat-glass and aluminium distributor. Subject: ${opts.brief.tema}${opts.brief.angulo ? `, angle: ${opts.brief.angulo}` : ""}.

OUTPUT: a 9:16 vertical story, 1080x1920, designed for vertical from the start.

SAME PIECE: keep the same scene, the same hero element, the same colours, light, typography style and mood. Someone who saw the feed post must recognise it at once as the same campaign.

FULL BLEED: the scene fills the whole 9:16 canvas, edge to edge. Extend the background and the scene upward and downward and rearrange the elements for the tall canvas. Do NOT paste the feed image inside the story. No frame within a frame, no border, no bars or bands above or below, no letterbox, no blurred copy of the post behind it, no card, no rounded rectangle.

SAFE AREAS: Instagram covers the top ${TOPO}px and the bottom ${BASE}px. Nothing written and no key element there; they hold only background. All text sits between y=${TOPO} and y=${fim}, with 80px side margins.

TEXT IN THE ART (the same words as the feed post; render EXACTLY, in Brazilian Portuguese, no spelling changes, no emoji, nothing else written):
Headline: "${opts.headline}"
${opts.apoio ? `Support line: "${opts.apoio}"` : ""}

LOGO AREA: keep the right side just above the bottom ${BASE}px (about 260x220px, ending at y=${fim}) clean and calm, because the official logo goes there. Leave out the logo of the feed post.

${NEGATIVOS_IA}`.replace(/\n{3,}/g, "\n\n");
}

/** Os textos da story derivada: os mesmos da arte de feed. */
export const textosDaStory = (headline: string, apoio?: string): string[] => [headline, ...(apoio ? [apoio] : [])];

/**
 * Fluxo "Os dois": a story de verdade da arte escolhida, recomposta em 9:16 a partir dela e conferida como as artes novas.
 * `apoio` é a linha de apoio do feed, para a story levar o mesmo texto. `ia` só muda nos testes.
 */
export async function deriveStory(
  opts: {
    postId: number;
    brief: Brief;
    headline: string;
    apoio?: string;
    chosen: ArtVariant;
  },
  ia: IaDaArte = IA_DA_OPENAI,
): Promise<{ path: string; problemas: Problema[] }> {
  const pedido = { prompt: promptDaStory(opts), formato: "stories" as const, base: opts.chosen.path };
  const { gerada, problemas: doTexto } = await gerarConferida(comLembrete(ia, pedido), ia.lerTexto, textosDaStory(opts.headline, opts.apoio));
  const jpeg = await aplicarLogo(gerada, "stories");
  const path = await gravarArquivo("arts", `post${opts.postId}-stories-derived-${Math.floor(Date.now() / 1000)}.jpg`, jpeg, "image/jpeg");

  return { path, problemas: [...doTexto, ...(await validarArte(jpeg, "stories", { paleta: !opts.chosen.ancora && !opts.chosen.referencia }))] };
}

/** Gera o pedido, e na refação o mesmo pedido com o lembrete da grafia no fim do prompt. */
const comLembrete =
  (ia: IaDaArte, pedido: Parameters<typeof generateArt>[0]) =>
  (lembrete?: string) =>
    ia.gerar(lembrete ? { ...pedido, prompt: `${pedido.prompt}\n\n${lembrete}` } : pedido);

const semImagem = (r: ReferenciaParaGerar): Ancora =>
  r.origem === "biblioteca" ? { origem: r.origem, id: r.id, arquivo: r.arquivo, leitura: r.leitura } : { origem: r.origem, arquivo: r.arquivo };
