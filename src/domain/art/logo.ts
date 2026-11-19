import { Resvg } from "@resvg/resvg-js";
import sharp, { type OverlayOptions } from "sharp";
import { readFileSync } from "node:fs";

/**
 * A logo oficial entra por código, nunca pelo modelo de imagem: ele redesenhava a marca e copiava as
 * versões antigas que aparecem nas referências do Instagram. Os SVGs são os do pacote oficial
 * (brand/assets/logo, conferidos com scripts/sync-assets.ts).
 */
const branca = readFileSync("brand/assets/logo/emvidros-branca.svg", "utf8");

/**
 * A logo branca oficial mantém o emblema em teal, que some sobre fundo teal. A versão toda branca é a mesma
 * geometria com todo preenchimento em branco, como o símbolo "EM Branco" do pacote oficial.
 */
const todaBranca = branca.replace(/fill:(rgb\([^)]*\)|url\(#[^)]*\))/g, "fill:white");

const SVG = {
  cor: readFileSync("brand/assets/logo/emvidros-oficial.svg"),
  branca: Buffer.from(todaBranca),
} as const;

/** Selo dos posts reais: teal profundo com cantos arredondados, para a logo branca ler sobre teal médio. */
const SELO = { cor: "#2F646A", padding: 16, raio: 16 } as const;

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

const colar = (jpeg: Buffer, camadas: OverlayOptions[]) => sharp(jpeg).composite(camadas).jpeg({ quality: 90 }).toBuffer();

/** Cola a logo oficial no canto pedido. A versão sai do fundo daquele canto. */
export async function aplicarLogo(jpeg: Buffer, formato: "feed" | "stories", canto: Canto = "inferior-direito"): Promise<Buffer> {
  const { width, height } = await sharp(jpeg).metadata();
  if (!width || !height) throw new Error("Arte sem dimensão para aplicar a logo.");
  const m = MEDIDAS[formato];
  const altura = Math.round(m.largura * PROPORCAO);
  const left = canto === "inferior-direito" ? width - m.margem - m.largura : canto === "inferior-esquerdo" ? m.margem : Math.round((width - m.largura) / 2);
  const top = height - m.base - altura;
  const luz = await luminancia(jpeg, { left, top, width: m.largura, height: altura });
  // Fundo claro: colorida. Escuro: toda branca. Meio-tom (teal médio, foto): branca dentro do selo, para não sumir.
  if (luz >= 0.62) return colar(jpeg, [{ input: rasterizar("cor", m.largura), left, top }]);
  if (luz < 0.35) return colar(jpeg, [{ input: rasterizar("branca", m.largura), left, top }]);
  const { padding, raio, cor } = SELO;
  const w = m.largura + padding * 2;
  const h = altura + padding * 2;
  const selo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${raio}" fill="${cor}"/></svg>`);
  // O selo cresce para fora a partir da posição da logo, mas nunca passa da borda da arte.
  const seloLeft = Math.min(Math.max(left - padding, 16), width - w - 16);
  const seloTop = Math.min(top - padding, height - h - 16);
  return colar(jpeg, [
    { input: new Resvg(selo).render().asPng(), left: seloLeft, top: seloTop },
    { input: rasterizar("branca", m.largura), left: seloLeft + padding, top: seloTop + padding },
  ]);
}
