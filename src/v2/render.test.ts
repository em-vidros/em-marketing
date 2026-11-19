import { expect, test } from "bun:test";
import sharp from "sharp";
import { AJUSTES_NEUTROS } from "./camadas";
import { renderizar } from "./render";

test("o enquadramento amplia a cena em volta do foco e o resto da cena sai da arte", async () => {
  const metade = { width: 540, height: 1350, channels: 3 as const };
  const vermelho = await sharp({ create: { ...metade, background: "#FF0000" } }).png().toBuffer();
  const azul = await sharp({ create: { ...metade, background: "#0000FF" } }).png().toBuffer();
  const cena = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#000000" } })
    .composite([{ input: vermelho, left: 0, top: 0 }, { input: azul, left: 540, top: 0 }])
    .jpeg({ quality: 100 })
    .toBuffer();

  const png = await renderizar({ formato: "feed", camadas: [], ajustes: { ...AJUSTES_NEUTROS, zoom: 2, focoX: 0 } }, new Uint8Array(cena));
  const cor = async (left: number) => [...(await sharp(png).extract({ left, top: 600, width: 1, height: 1 }).raw().toBuffer()).subarray(0, 3)];

  const [esquerda, direita] = await Promise.all([cor(20), cor(1060)]);
  expect(esquerda[0]! > 200 && esquerda[2]! < 50).toBe(true);
  expect(direita[0]! > 200 && direita[2]! < 50).toBe(true);
});
