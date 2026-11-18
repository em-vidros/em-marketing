import { toFile } from "openai";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { tokens } from "../brand";
import { MODELO_DE_IMAGEM, openai } from "../../openai";

export type Formato = "feed" | "stories";

/** Tamanho pedido ao modelo: a proporção exata do formato, lados múltiplos de 16, um pouco acima do final. */
const FORMATS = {
  feed: { tamanho: "1088x1360" as const, w: 1080, h: 1350 },
  stories: { tamanho: "1152x2048" as const, w: 1080, h: 1920 },
};

/** Arquivos oficiais do §3.5. O logo entra como imagem de referência, fiel, nunca redesenhado. */
const LOGO_FILE = { cor: "emvidros-oficial.png", branco: "emvidros-branca.png" } as const;

const logo = (variant: "cor" | "branco") =>
  toFile(readFileSync(new URL(`../../../brand/assets/logo/${LOGO_FILE[variant]}`, import.meta.url).pathname), "logo.png", {
    type: "image/png",
  });

/**
 * Gera uma arte no formato pedido e normaliza para a dimensão exata
 * (resize cover + crop, JPEG q90 sRGB), conforme PRD §3.3.
 * `base` é o caminho de uma arte aprovada que a nova deve seguir.
 */
export async function generateArt(opts: {
  prompt: string;
  formato: Formato;
  logoVariant?: "cor" | "branco";
  base?: string;
}): Promise<Buffer> {
  const f = FORMATS[opts.formato];
  const imagens = [await logo(opts.logoVariant ?? "cor")];
  if (opts.base) imagens.push(await toFile(readFileSync(opts.base), "base.jpg", { type: "image/jpeg" }));

  const resposta = await openai().images.edit({
    model: MODELO_DE_IMAGEM,
    image: imagens,
    prompt: opts.prompt,
    size: f.tamanho,
    quality: "high",
    output_format: "png",
  });
  const base64 = resposta.data?.[0]?.b64_json;
  if (!base64) throw new Error("O modelo de imagem não devolveu a arte.");

  const jpeg = await sharp(Buffer.from(base64, "base64"))
    .resize(f.w, f.h, { fit: "cover", position: "attention" })
    .jpeg({ quality: tokens.output.quality })
    .toColorspace("srgb")
    .toBuffer();

  if (jpeg.byteLength > tokens.output.maxBytes) throw new Error(`JPEG acima de 8 MB: ${jpeg.byteLength}`);
  return jpeg;
}
