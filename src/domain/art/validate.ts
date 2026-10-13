import sharp from "sharp";
import { tokens } from "../brand";
import type { Problema } from "../brand/validate";
import type { Formato } from "./generate";

/**
 * Gate visual da arte — a metade do checklist do capítulo 16 que `brand/validate.ts`
 * não alcança, porque aquele só lê texto.
 *
 * O modelo de imagem RECEBE a paleta e a regra 70/20/10 no prompt (NEGATIVOS_IA em
 * pipeline.ts). A F1 já provou que regra lida não é regra cumprida: a mesma lição
 * que motivou validar a legenda em código vale para o pixel.
 *
 * O que dá para verificar por medição e o que não dá:
 *   - cor, dimensão e peso   → objetivo, medido aqui
 *   - margem e hierarquia    → exige entender o layout; fica com o humano
 *
 * CALIBRAÇÃO: os limiares abaixo são estimativas. Nenhuma arte real existe ainda
 * (o gate da F1 está travado no billing do modelo de imagem), então eles foram
 * escolhidos a partir da paleta e testados contra imagens sintéticas. Revisar
 * contra o primeiro lote real antes de confiar neles para reprovar.
 */
export const LIMIARES = {
  /** Croma abaixo disto é cinza/off-white/areia: neutro, sem julgamento de matiz. */
  cromaNeutro: 0.1,
  /** Faixa de matiz do teal do sistema: #2F646A = 186°, #63B5AF = 176°. */
  matizTeal: [155, 210] as const,
  /** Fração de pixels com matiz fora do sistema. */
  foraDaPaletaAviso: 0.008,
  foraDaPaletaErro: 0.03,
  /** §4 "70/20/10": se a arte parece muito verde, ela está errada. */
  tealAviso: 0.25,
  neutroMinimo: 0.55,
  /** §6.2: desvio-padrão de luminância (0–255) numa zona segura de story. */
  sdZonaSegura: 18,
  /** Largura da amostra. Reduzir é o que torna a análise barata. */
  amostraPx: 160,
} as const;

export interface Composicao {
  neutro: number;
  teal: number;
  fora: number;
  matizesFora: number[];
}

function croma(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Matiz em graus (0–360). Só faz sentido acima do croma neutro. */
function matiz(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Classifica cada pixel em neutro / teal do sistema / matiz estranho ao sistema. */
export async function composicao(jpeg: Buffer): Promise<Composicao> {
  const { data, info } = await sharp(jpeg)
    .resize(LIMIARES.amostraPx, null, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const total = info.width * info.height;
  let neutro = 0;
  let teal = 0;
  const fora = new Map<number, number>();
  const [tMin, tMax] = LIMIARES.matizTeal;

  for (let i = 0; i < total; i++) {
    const r = data[i * 3]!;
    const g = data[i * 3 + 1]!;
    const b = data[i * 3 + 2]!;
    if (croma(r, g, b) < LIMIARES.cromaNeutro) {
      neutro++;
      continue;
    }
    const h = matiz(r, g, b);
    if (h >= tMin && h <= tMax) teal++;
    else {
      const balde = Math.round(h / 15) * 15;
      fora.set(balde, (fora.get(balde) ?? 0) + 1);
    }
  }

  const nFora = [...fora.values()].reduce((s, n) => s + n, 0);
  return {
    neutro: neutro / total,
    teal: teal / total,
    fora: nFora / total,
    // só os matizes com presença real, do mais presente ao menos
    matizesFora: [...fora.entries()]
      .filter(([, n]) => n / total >= 0.002)
      .sort((a, b) => b[1] - a[1])
      .map(([h]) => h),
  };
}

/**
 * Desvio-padrão da luminância numa faixa horizontal — proxy de "tem conteúdo aqui".
 *
 * O desvio é calculado no pixel de propósito: `sharp().stats()` mede a imagem de
 * entrada e ignora o `extract()` encadeado antes dele, o que faria as duas faixas
 * reportarem sempre o mesmo número — o da peça inteira.
 */
async function agitacao(jpeg: Buffer, top: number, height: number): Promise<number> {
  const meta = await sharp(jpeg).metadata();
  if (!meta.width || !meta.height || top + height > meta.height) return 0;

  const { data, info } = await sharp(jpeg)
    .extract({ left: 0, top, width: meta.width, height })
    .greyscale()
    .resize(LIMIARES.amostraPx, null, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = info.width * info.height;
  let soma = 0;
  for (let i = 0; i < n; i++) soma += data[i]!;
  const media = soma / n;
  let variancia = 0;
  for (let i = 0; i < n; i++) variancia += (data[i]! - media) ** 2;
  return Math.sqrt(variancia / n);
}

/**
 * Verifica a arte final contra o que é mensurável no brandbook.
 * Devolve problemas — não lança e não regenera: a geração já foi paga, quem
 * decide refazer é o humano (é o mesmo contrato do validador de legenda, com a
 * diferença de que texto barato pode ser reescrito em loop e imagem não).
 */
export async function validarArte(jpeg: Buffer, formato: Formato): Promise<Problema[]> {
  const p: Problema[] = [];
  const esperado = tokens.formats[formato].final;

  const meta = await sharp(jpeg).metadata();
  if (meta.width !== esperado.width || meta.height !== esperado.height)
    p.push({
      regra: "§6.1 dimensão",
      severidade: "erro",
      detalhe: `saiu ${meta.width}×${meta.height}, esperado ${esperado.width}×${esperado.height}`,
    });

  if (jpeg.byteLength > tokens.output.maxBytes)
    p.push({
      regra: "peso",
      severidade: "erro",
      detalhe: `${(jpeg.byteLength / 1e6).toFixed(1)} MB acima do teto de ${tokens.output.maxBytes / 1e6} MB`,
    });

  const c = await composicao(jpeg);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (c.fora >= LIMIARES.foraDaPaletaAviso)
    p.push({
      regra: "§4.1 paleta",
      severidade: c.fora >= LIMIARES.foraDaPaletaErro ? "erro" : "aviso",
      detalhe:
        `${pct(c.fora)} da arte tem matiz fora do sistema` +
        (c.matizesFora.length ? ` (≈ ${c.matizesFora.map((h) => `${h}°`).join(", ")})` : "") +
        ". A paleta é teal, grafite e neutros — nenhuma outra cor aparece.",
    });

  if (c.teal >= LIMIARES.tealAviso)
    p.push({
      regra: "§4.3 proporção 70/20/10",
      severidade: "aviso",
      detalhe: `${pct(c.teal)} de teal (alvo ≈ 10%). Se a arte parece "muito verde", ela está errada — exceto no estilo faixa-teal, cujo fundo é teal por definição.`,
    });

  if (c.neutro < LIMIARES.neutroMinimo)
    p.push({
      regra: "§4.3 proporção 70/20/10",
      severidade: "aviso",
      detalhe: `só ${pct(c.neutro)} de neutro (alvo ≈ 70% entre off-white, areia e grafite).`,
    });

  if (formato === "stories") {
    const { topPx, bottomPx } = tokens.formats.stories.safeZones;
    const topo = await agitacao(jpeg, 0, topPx);
    const base = await agitacao(jpeg, esperado.height - bottomPx, bottomPx);
    for (const [nome, sd, px] of [
      ["topo", topo, topPx],
      ["base", base, bottomPx],
    ] as const)
      if (sd > LIMIARES.sdZonaSegura)
        p.push({
          regra: "§6.2 zona segura",
          severidade: "aviso",
          detalhe: `os ${px} px do ${nome} parecem ter conteúdo (variação de luminância ${sd.toFixed(0)}). Essa faixa fica coberta pela interface do Instagram — confira se algo importante caiu ali.`,
        });
  }

  return p;
}
