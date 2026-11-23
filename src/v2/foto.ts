import sharp from "sharp";
import { PIXELS_MAXIMOS } from "./arquivos";

const LADO = 800;
const ANEL = 16;

const circulo = (d: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`);

/** A foto de uma pessoa recortada em círculo, com um anel branco, em PNG com fundo transparente. */
export async function fotoEmCirculo(bytes: Uint8Array): Promise<Uint8Array> {
  const miolo = LADO - 2 * ANEL;
  const quadrada = await sharp(bytes, { limitInputPixels: PIXELS_MAXIMOS }).rotate().resize(miolo, miolo, { fit: "cover" }).png().toBuffer();
  const recortada = await sharp(quadrada).composite([{ input: circulo(miolo), blend: "dest-in" }]).png().toBuffer();
  const png = await sharp({ create: { width: LADO, height: LADO, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: circulo(LADO) }, { input: recortada, left: ANEL, top: ANEL }])
    .png()
    .toBuffer();
  return new Uint8Array(png);
}
