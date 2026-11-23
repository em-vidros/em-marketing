import sharp from "sharp";
import { z } from "zod";
import { FORMATOS, LIMITES, type Camada, type Formato } from "./camadas";
import type { Peso } from "./fontes";

/**
 * As fontes que a leitura pode escolher: as da marca e as parecidas com o que o modelo de imagem costuma desenhar.
 * `largura` é a largura média de um caractere em minúsculas, em fração do tamanho; os pesos são os que a família tem.
 */
const FONTES = {
  Poppins: { largura: 0.56, pesos: [400, 500, 600, 700, 800] },
  "Playfair Display": { largura: 0.5, pesos: [400, 500, 600, 700, 800] },
  Montserrat: { largura: 0.6, pesos: [400, 500, 600, 700, 800] },
  Inter: { largura: 0.53, pesos: [400, 500, 600, 700, 800] },
  Oswald: { largura: 0.42, pesos: [400, 500, 600, 700] },
  Anton: { largura: 0.45, pesos: [400] },
  "Bebas Neue": { largura: 0.38, pesos: [400] },
} satisfies Record<string, { largura: number; pesos: Peso[] }>;

type Fonte = keyof typeof FONTES;
const NOMES_DAS_FONTES = Object.keys(FONTES) as [Fonte, ...Fonte[]];

/**
 * O que o modelo de visão acha numa imagem pronta, em px da arte final (1080 de largura).
 * Os campos são todos obrigatórios porque a saída estruturada da OpenAI não aceita opcional; o que não existe vem null.
 */
export const Elementos = z.object({
  textos: z
    .array(
      z.object({
        texto: z.string().describe("O texto exato, com \\n onde a linha quebra na imagem."),
        x: z.number(),
        y: z.number(),
        largura: z.number(),
        altura: z.number(),
        tamanho: z.number().describe("Tamanho da fonte em px: a altura de uma linha sem a entrelinha."),
        fonte: z
          .enum(NOMES_DAS_FONTES)
          .describe("A mais parecida com a da imagem: Playfair Display para serifada, Anton, Oswald ou Bebas Neue para condensada, Poppins na dúvida."),
        peso: z.enum(["400", "500", "600", "700", "800"]),
        cor: z.string().describe("Hex como #2F646A."),
        alinhamento: z.enum(["esquerda", "centro", "direita"]),
      }),
    )
    .max(24),
  logo: z
    .object({
      x: z.number(),
      y: z.number(),
      largura: z.number(),
      altura: z.number(),
      variante: z.enum(["cor", "branca"]).describe("branca quando o logo é todo branco ou fica sobre um selo escuro."),
      selo: z.boolean().describe("true quando há um retângulo de cor atrás do logo."),
    })
    .nullable(),
});

export type Elementos = z.infer<typeof Elementos>;

export type Area = { x: number; y: number; largura: number; altura: number };

/** Folga em volta de cada elemento na máscara: o modelo erra a caixa por alguns px, e o selo do logo passa dela. */
const FOLGA = 28;
const FOLGA_DO_SELO = 44;

/**
 * Largura estimada da linha mais longa. Maiúscula ocupa mais que minúscula, por isso conta 1,25.
 * É estimativa, como linhasEstimadas: serve só para a fonte escolhida não estourar muito a caixa original.
 */
function larguraEstimada(texto: string, fonte: Fonte, tamanho: number) {
  const linha = (l: string) => [...l].reduce((soma, c) => soma + (c !== c.toLowerCase() ? 1.25 : c === " " ? 0.5 : 1), 0);
  return Math.max(...texto.split("\n").map(linha)) * tamanho * FONTES[fonte].largura;
}

const pesoMaisPerto = (fonte: Fonte, peso: number): Peso =>
  FONTES[fonte].pesos.reduce((melhor, p) => (Math.abs(p - peso) < Math.abs(melhor - peso) ? p : melhor), FONTES[fonte].pesos[0]!);

const prender = (v: number, minimo: number, maximo: number) => Math.round(Math.min(maximo, Math.max(minimo, v)));

/** A caixa com folga em volta, presa dentro da arte. */
export function comFolga(e: Area, formato: Formato, folga = FOLGA): Area {
  const { largura: W, altura: H } = FORMATOS[formato];
  const x = prender(e.x - folga, 0, W);
  const y = prender(e.y - folga, 0, H);
  return { x, y, largura: prender(e.x + e.largura + folga, x, W) - x, altura: prender(e.y + e.altura + folga, y, H) - y };
}

/** As áreas que o modelo de imagem apaga, com folga e presas dentro da arte. */
export function areasDosElementos({ textos, logo }: Elementos, formato: Formato): Area[] {
  const areas = textos.map((t) => comFolga(t, formato));
  if (logo) areas.push(comFolga(logo, formato, logo.selo ? FOLGA_DO_SELO : FOLGA));
  return areas.filter((a) => a.largura > 0 && a.altura > 0);
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Cada texto vira uma camada de texto e o logo vira a camada de logo, na ordem em que aparecem de cima para baixo. */
export function camadasDosElementos({ textos, logo }: Elementos, formato: Formato): Camada[] {
  const { largura: W, altura: H } = FORMATOS[formato];
  const [posMin, posMax] = LIMITES.posicao;
  const camadas: Camada[] = [...textos]
    .filter((t) => t.texto.trim())
    .sort((a, b) => a.y - b.y)
    .map((t, i) => {
      const texto = t.texto.trim().slice(0, LIMITES.caracteres);
      const linhas = texto.split("\n").length;
      // Se a fonte escolhida é mais larga que a desenhada, o tamanho encolhe até a linha caber na caixa lida.
      const estimada = larguraEstimada(texto, t.fonte, t.tamanho);
      const tamanho = prender(estimada > t.largura * 1.1 ? (t.tamanho * t.largura) / estimada : t.tamanho, 12, 400);
      // As quebras de linha vêm no texto, então a caixa vai até a borda do lado livre e nunca quebra outra linha.
      const centro = t.x + t.largura / 2;
      const [x, largura] =
        t.alinhamento === "esquerda"
          ? [t.x, W - t.x]
          : t.alinhamento === "direita"
            ? [0, t.x + t.largura]
            : [centro - Math.min(centro, W - centro), 2 * Math.min(centro, W - centro)];
      return {
        id: `texto-${i + 1}`,
        tipo: "texto",
        texto,
        fonte: t.fonte,
        peso: pesoMaisPerto(t.fonte, Number(t.peso)),
        tamanho,
        entrelinha: linhas > 1 ? Math.min(2.5, Math.max(1, Math.round((t.altura / linhas / t.tamanho) * 100) / 100)) : 1.1,
        cor: HEX.test(t.cor) ? t.cor.toUpperCase() : "#414141",
        alinhamento: t.alinhamento,
        x: prender(x, posMin, posMax),
        y: prender(t.y, posMin, Math.min(posMax, H)),
        largura: prender(largura, LIMITES.largura.texto[0], W),
      } satisfies Camada;
    });
  if (logo)
    camadas.push({
      id: "logo",
      tipo: "logo",
      variante: logo.variante,
      x: prender(logo.x, posMin, posMax),
      y: prender(logo.y, posMin, posMax),
      largura: prender(logo.largura, LIMITES.largura.logo[0], LIMITES.largura.logo[1]),
    });
  return camadas;
}

const cinza = (largura: number, altura: number) => ({ raw: { width: largura, height: altura, channels: 1 as const } });

/** O remendo para 8 px antes da borda da máscara: o modelo desenha uma linha onde ela acaba. */
const RECUO_DO_REMENDO = 8;

/**
 * Cola na original só as áreas que o modelo refez, com a borda suavizada. O modelo redesenha a imagem inteira,
 * e fora das áreas ele também muda coisas, como um número desenhado numa ilustração.
 * `comTexto`: a área ganha texto novo, que pode ser escuro, então o teste do buraco preto não vale.
 */
export async function remendar(original: Uint8Array, apagada: Uint8Array, areas: Area[], formato: Formato, { comTexto = false } = {}): Promise<Uint8Array> {
  const { largura: W, altura: H } = FORMATOS[formato];
  const furo = Buffer.alloc(W * H);
  for (const a of areas) {
    const x0 = Math.min(W, a.x + RECUO_DO_REMENDO);
    const x1 = Math.max(x0, a.x + a.largura - RECUO_DO_REMENDO);
    for (let y = a.y + RECUO_DO_REMENDO; y < a.y + a.altura - RECUO_DO_REMENDO; y++) furo.fill(255, y * W + x0, y * W + x1);
  }
  const rgba = await sharp(apagada).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const antes = await sharp(original).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const preto = (px: Buffer, i: number, canais: number) => px[i * canais]! + px[i * canais + 1]! + px[i * canais + 2]! < 40;
  let dentro = 0;
  let vazios = 0;
  let pretosAgora = 0;
  let pretosAntes = 0;
  for (let i = 0; i < W * H; i++)
    if (furo[i]) {
      dentro++;
      if (rgba[i * 4 + 3]! < 128) vazios++;
      if (preto(rgba, i, 4)) pretosAgora++;
      if (preto(antes, i, 3)) pretosAntes++;
    }
  // O modelo às vezes devolve a área transparente ou pintada de preto. Gravada, a cena fica com um buraco preto no lugar do texto.
  if (dentro > 0 && (vazios / dentro > 0.01 || (!comTexto && (pretosAgora - pretosAntes) / dentro > 0.3)))
    throw new Error("O modelo de imagem devolveu a área do texto vazia, sem o fundo. Tente de novo.");
  const borda = await sharp(furo, cinza(W, H)).blur(3).toColourspace("b-w").raw().toBuffer();
  // O alfa sai num passo só dele: no mesmo pipeline do joinChannel, o sharp perde o canal novo.
  const rgb = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().raw().toBuffer();
  const remendo = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).joinChannel(borda, cinza(W, H)).png().toBuffer();
  return sharp(original).resize(W, H, { fit: "fill" }).composite([{ input: remendo }]).jpeg({ quality: 90 }).toBuffer();
}
