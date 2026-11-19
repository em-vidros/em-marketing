import { toFile } from "openai";
import sharp from "sharp";
import { lerArquivo } from "../../armazem";
import { tokens } from "../brand";
import { MODELO_DE_IMAGEM, openai } from "../../openai";

export type Formato = "feed" | "stories";

/** Tamanho pedido ao modelo: a proporção exata do formato, lados múltiplos de 16, um pouco acima do final. */
const FORMATS = {
  feed: { tamanho: "1088x1360" as const, w: 1080, h: 1350 },
  stories: { tamanho: "1152x2048" as const, w: 1080, h: 1920 },
};

/**
 * Gera uma arte no formato pedido e normaliza para a dimensão exata
 * (resize cover + crop, JPEG q90 sRGB), conforme PRD §3.3.
 * `base` é o caminho (disco ou Blob) de uma arte aprovada que a nova deve seguir.
 */
export async function generateArt(opts: {
  prompt: string;
  formato: Formato;
  base?: string;
  /** Posts reais da EM Vidros ou imagens que o usuário mandou, como referência de estilo. Vão depois do logo. */
  referencias?: Uint8Array[];
}): Promise<Buffer> {
  const f = FORMATS[opts.formato];
  // A logo não vai para o modelo: ele redesenhava a marca. Ela é colada depois, por aplicarLogo.
  const imagens = [];
  if (opts.base) {
    const base = await lerArquivo(opts.base);
    if (!base) throw new Error("A arte escolhida sumiu do armazenamento.");
    imagens.push(await toFile(base, "base.jpg", { type: "image/jpeg" }));
  }
  for (const [i, ref] of (opts.referencias ?? []).entries()) imagens.push(await toFile(ref, `referencia-${i + 1}.jpg`, { type: "image/jpeg" }));

  const pedido = { model: MODELO_DE_IMAGEM, prompt: opts.prompt, size: f.tamanho, quality: "high", output_format: "png" } as const;
  const resposta = imagens.length ? await (await openai()).images.edit({ ...pedido, image: imagens }) : await (await openai()).images.generate(pedido);
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
