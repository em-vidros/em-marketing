import { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import sharp from "sharp";
import { z } from "zod";
import { lerArquivo } from "../../armazem";
import { tokens } from "../brand";
import { MODELO_DE_IMAGEM, MODELO_DE_TEXTO, openai } from "../../openai";

export type Formato = "feed" | "stories";

/** A qualidade pedida ao modelo de imagem. Cada nível custa mais tokens de saída; scripts/comparar-qualidade.ts mede a diferença. */
export type Qualidade = "low" | "medium" | "high";

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
  /** A referência da Biblioteca e depois as imagens que o usuário mandou. Vão depois da base. */
  referencias?: Uint8Array[];
  /** `high` quando não vem, como o app sempre gerou. */
  qualidade?: Qualidade;
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

  const pedido = { model: MODELO_DE_IMAGEM, prompt: opts.prompt, size: f.tamanho, quality: opts.qualidade ?? "high", output_format: "png" } as const;
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

const TextoLido = z.object({ textos: z.array(z.string()).max(24) });

const INSTRUCOES_DA_LEITURA = `
Você recebe uma arte de Instagram e copia todo texto que foi desenhado nela, um bloco por item, na ordem de leitura.
- Copie letra por letra, com acento, maiúscula e pontuação como estão na imagem. Não corrija nada: se a imagem diz "Vidor", escreva "Vidor".
- Não conte letras que fazem parte de uma foto ou ilustração, como placas e embalagens.
- Sem texto na arte, devolva a lista vazia.
`.trim();

/** Lê o texto pintado numa arte com o modelo de visão. O uso entra na conta pelo mesmo cliente de `openai()`. */
export async function lerTextoDaArte(jpeg: Uint8Array): Promise<string[]> {
  const resposta = await (await openai()).responses.parse({
    model: MODELO_DE_TEXTO,
    reasoning: { effort: "low" },
    instructions: INSTRUCOES_DA_LEITURA,
    input: [{ role: "user", content: [{ type: "input_image", detail: "high", image_url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` }] }],
    text: { format: zodTextFormat(TextoLido, "texto_lido") },
  });
  if (!resposta.output_parsed) throw new Error("O modelo não devolveu o texto da arte.");
  return resposta.output_parsed.textos;
}
