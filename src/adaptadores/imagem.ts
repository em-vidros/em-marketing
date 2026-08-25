/**
 * Normalização determinística das artes. Sem modelo, sem rede, sem estado.
 *
 * O modelo emite na dimensão dele (`formats.*.generation.expected`); quem decide o
 * pixel final é este arquivo, a partir de `brand/tokens.json`. Separar as duas
 * coisas é o que faz a dimensão exata da US-5 sobreviver a troca de modelo.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import tokens from "../../brand/tokens.json";
import type { Formato } from "../modelos/tipos";

/** Hash de conteúdo de qualquer artefato: PNG, JPEG ou texto UTF-8. */
export function sha256(conteudo: string | Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

/** PNG mestre da US-5: dimensão exata, sRGB, sem perda. */
export async function normalizarMestre(
  png: Buffer,
  formato: Formato,
): Promise<{ png: Buffer; largura: number; altura: number; sha256: string }> {
  const { width: largura, height: altura } = tokens.formats[formato].final;
  const mestre = await sharp(png)
    .resize(largura, altura, { fit: "cover", position: "attention" })
    .toColorspace("srgb")
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { png: mestre, largura, altura, sha256: sha256(mestre) };
}

/** JPEG de revisão no celular. Nunca substitui o mestre na entrega (US-5). */
export async function derivarPreview(masterPng: Buffer): Promise<{ jpeg: Buffer; sha256: string }> {
  const jpeg = await sharp(masterPng)
    .toColorspace("srgb")
    .jpeg({ quality: tokens.output.quality })
    .toBuffer();
  if (jpeg.byteLength > tokens.output.maxBytes)
    throw new Error(
      `Preview JPEG acima do teto: ${jpeg.byteLength} bytes, máximo ${tokens.output.maxBytes}`,
    );
  return { jpeg, sha256: sha256(jpeg) };
}
