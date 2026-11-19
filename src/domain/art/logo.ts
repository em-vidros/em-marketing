import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readFileSync } from "node:fs";

/**
 * A logo oficial entra por código, nunca pelo modelo de imagem: ele redesenhava a marca e copiava as
 * versões antigas que aparecem nas referências do Instagram. Os SVGs são os do pacote oficial
 * (brand/assets/logo, conferidos com scripts/sync-assets.ts).
 */
const SVG = {
  cor: readFileSync("brand/assets/logo/emvidros-oficial.svg"),
  branca: readFileSync("brand/assets/logo/emvidros-branca.svg"),
} as const;

/** Altura sobre largura do logo oficial (viewBox 2272×1888). */
const PROPORCAO = 1888 / 2272;

export type Canto = "inferior-direito" | "inferior-esquerdo" | "inferior-centro";

/** Largura da logo e margem, por formato. No story, a base de 320 px fica livre para a interface do Instagram (§6.2). */
const MEDIDAS = {
  feed: { largura: 190, margem: 64, base: 64 },
  stories: { largura: 210, margem: 80, base: 360 },
} as const;

const rasterizar = (variante: keyof typeof SVG, largura: number) =>
  new Resvg(SVG[variante], { fitTo: { mode: "width", value: largura } }).render().asPng();

/** Luminância média de 0 a 1 de um retângulo da arte. A conta é no pixel: `stats()` ignora o `extract()` encadeado. */
async function luminancia(img: Buffer, area: { left: number; top: number; width: number; height: number }): Promise<number> {
  const px = await sharp(img).extract(area).greyscale().raw().toBuffer();
  let soma = 0;
  for (const v of px) soma += v;
  return soma / px.length / 255;
}

/** Cola a logo oficial no canto pedido. Fundo escuro recebe a versão branca; fundo claro, a colorida. */
export async function aplicarLogo(jpeg: Buffer, formato: "feed" | "stories", canto: Canto = "inferior-direito"): Promise<Buffer> {
  const { width, height } = await sharp(jpeg).metadata();
  if (!width || !height) throw new Error("Arte sem dimensão para aplicar a logo.");
  const m = MEDIDAS[formato];
  const altura = Math.round(m.largura * PROPORCAO);
  const left = canto === "inferior-direito" ? width - m.margem - m.largura : canto === "inferior-esquerdo" ? m.margem : Math.round((width - m.largura) / 2);
  const top = height - m.base - altura;
  const variante = (await luminancia(jpeg, { left, top, width: m.largura, height: altura })) < 0.55 ? "branca" : "cor";
  return sharp(jpeg)
    .composite([{ input: rasterizar(variante, m.largura), left, top }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
