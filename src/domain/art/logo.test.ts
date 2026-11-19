import { expect, test } from "bun:test";
import sharp from "sharp";
import { aplicarLogo } from "./logo";

const fundo = (cor: string) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: cor } }).jpeg().toBuffer();

/** Os pixels de luminância de um retângulo. `stats()` ignora o `extract()` encadeado, por isso a conta é feita aqui. */
const luz = async (img: Buffer, left: number, top: number, width: number, height: number) =>
  [...(await sharp(img).extract({ left, top, width, height }).greyscale().raw().toBuffer())];

/** Desvio de luminância num retângulo: zero é fundo liso, acima disso tem logo desenhada. */
async function agitacao(img: Buffer, left: number, top: number) {
  const px = await luz(img, left, top, 190, 158);
  const media = px.reduce((a, b) => a + b, 0) / px.length;
  return Math.sqrt(px.reduce((a, b) => a + (b - media) ** 2, 0) / px.length);
}

test("a logo oficial entra no canto pedido e não suja o resto da arte", async () => {
  const arte = await aplicarLogo(await fundo("#F0EFEA"), "feed");
  expect(await agitacao(arte, 1080 - 64 - 190, 1350 - 64 - 158)).toBeGreaterThan(20);
  expect(await agitacao(arte, 64, 1350 - 64 - 158)).toBeLessThan(2);
});

test("fundo escuro recebe a versão branca: o texto VIDROS fica claro", async () => {
  const arte = await aplicarLogo(await fundo("#1F4A4F"), "feed");
  expect(Math.max(...(await luz(arte, 1080 - 64 - 190, 1350 - 64 - 158, 190, 158)))).toBeGreaterThan(220);
});

test("a versão sai do fundo do canto, não da arte inteira", async () => {
  const metade = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#F0EFEA" } })
    .composite([{ input: { create: { width: 1080, height: 400, channels: 3, background: "#1F4A4F" } }, left: 0, top: 950 }])
    .jpeg()
    .toBuffer();
  const arte = await aplicarLogo(metade, "feed");
  expect(Math.max(...(await luz(arte, 1080 - 64 - 190, 1350 - 64 - 158, 190, 158)))).toBeGreaterThan(220);
});
