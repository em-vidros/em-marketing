import { gravarArquivo } from "../../armazem";
import { compararTexto, lembreteDeGrafia, problemaDoTexto, TEXTO_SEM_CONFERENCIA } from "./conferencia";
import { generateArt, lerTextoDaArte, type Formato } from "./generate";
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
}

/** De onde vem a cara da arte: uma referência da Biblioteca, o visual padrão da casa, ou a arte de feed que a story adapta. */
export type Visual = { tipo: "referencia"; leitura: string } | { tipo: "pedido" } | { tipo: "casa" } | { tipo: "adaptacao" };

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
    case "adaptacao":
      return "VISUAL LANGUAGE: the supplied image is the approved feed artwork. Keep its exact visual concept, colours, hero element, typography and mood. This is its 9:16 Stories adaptation, recomposed for vertical, not cropped. Leave out its logo; the official logo is added afterwards.";
  }
}

/** Os modelos que o pipeline chama. Os testes trocam os dois juntos, para nenhum teste chegar à OpenAI. */
export interface IaDaArte {
  gerar: typeof generateArt;
  lerTexto: (jpeg: Uint8Array) => Promise<string[]>;
}

const IA_DA_OPENAI: IaDaArte = { gerar: generateArt, lerTexto: lerTextoDaArte };

/**
 * Gera a arte e confere o texto pintado nela contra `textos`. Se não bate, gera de novo uma vez só, porque cada imagem
 * custa cerca de US$ 0,06. Se a segunda também erra, fica a que errou menos, com o aviso do que saiu errado.
 * Sem leitura (o modelo de visão falhou), a arte segue com o aviso de que não foi conferida.
 */
async function gerarConferida(ia: IaDaArte, pedido: Parameters<typeof generateArt>[0], textos: string[]): Promise<{ gerada: Buffer; problemas: Problema[] }> {
  const conferir = async (gerada: Buffer) => {
    const lidos = await ia.lerTexto(gerada).catch((erro: unknown) => (console.error("conferência do texto da arte:", erro), null));
    return { gerada, divergencias: lidos && compararTexto(textos, lidos) };
  };
  const primeira = await conferir(await ia.gerar(pedido));
  if (!primeira.divergencias) return { gerada: primeira.gerada, problemas: [TEXTO_SEM_CONFERENCIA] };
  if (!primeira.divergencias.length) return { gerada: primeira.gerada, problemas: [] };

  const segunda = await conferir(await ia.gerar({ ...pedido, prompt: `${pedido.prompt}\n\n${lembreteDeGrafia(primeira.divergencias)}` }));
  if (segunda.divergencias?.length === 0) return { gerada: segunda.gerada, problemas: [] };
  const melhor = segunda.divergencias && segunda.divergencias.length < primeira.divergencias.length ? segunda : primeira;
  return { gerada: melhor.gerada, problemas: [problemaDoTexto(melhor.divergencias!)] };
}

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
      const { gerada, problemas: doTexto } = await gerarConferida(
        ia,
        { prompt, formato, referencias: [...(ancora ? [ancora.imagem] : []), ...anexos] },
        textosDaArte(formato, headline, apoio),
      );

      const jpeg = await aplicarLogo(gerada, formato);
      const path = await gravarArquivo("arts", `post${postId}-${formato}-v${variant}-${semente}.jpg`, jpeg, "image/jpeg");
      // A paleta só se mede no visual da casa: a referência e a direção do usuário trazem as cores delas, muitas vezes de foto.
      const problemas = [...doTexto, ...(await validarArte(jpeg, formato, { paleta: !ancora && !direcao }))];

      return { variant, ancora: ancora ? semImagem(ancora) : null, path, problemas };
    }),
  );
}

/** Fluxo "Os dois": deriva a versão Stories do conceito escolhido, com a arte escolhida como base. `ia` só muda nos testes. */
export async function deriveStory(
  opts: {
    postId: number;
    brief: Brief;
    headline: string;
    chosen: ArtVariant;
  },
  ia: IaDaArte = IA_DA_OPENAI,
): Promise<{ path: string; problemas: Problema[] }> {
  const { gerada, problemas: doTexto } = await gerarConferida(
    ia,
    {
      prompt: buildPrompt({ formato: "stories", brief: opts.brief, headline: opts.headline, visual: { tipo: "adaptacao" } }),
      formato: "stories",
      base: opts.chosen.path,
    },
    textosDaArte("stories", opts.headline),
  );
  const jpeg = await aplicarLogo(gerada, "stories");
  const path = await gravarArquivo("arts", `post${opts.postId}-stories-derived-${Math.floor(Date.now() / 1000)}.jpg`, jpeg, "image/jpeg");

  return { path, problemas: [...doTexto, ...(await validarArte(jpeg, "stories", { paleta: !opts.chosen.ancora && !opts.chosen.referencia }))] };
}

const semImagem = (r: ReferenciaParaGerar): Ancora =>
  r.origem === "biblioteca" ? { origem: r.origem, id: r.id, arquivo: r.arquivo, leitura: r.leitura } : { origem: r.origem, arquivo: r.arquivo };
