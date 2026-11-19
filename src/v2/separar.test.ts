import { expect, test } from "bun:test";
import sharp from "sharp";
import { FORMATOS } from "./camadas";
import { remendar } from "./separar";

const { largura, altura } = FORMATOS.story;
const lisa = (cor: string, canais: 3 | 4 = 3) =>
  sharp({ create: { width: largura, height: altura, channels: canais, background: cor } }).png().toBuffer();
const corEm = async (imagem: Uint8Array, x: number, y: number) => [...(await sharp(imagem).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer()).subarray(0, 3)];
const perto = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 12);

const AREA = { x: 100, y: 400, largura: 600, altura: 200 };

// O modelo redesenha a imagem inteira: o que muda fora da área (o 20/11 do calendário sumiu em produção) não pode voltar.
test("só a área apagada sai da imagem do modelo; fora dela fica a original", async () => {
  const original = await sharp({ create: { width: largura, height: altura, channels: 3, background: "#F0F0F0" } })
    .composite([{ input: { create: { width: 100, height: 100, channels: 3, background: "#2F646A" } }, left: 800, top: 1000 }])
    .jpeg({ quality: 100 })
    .toBuffer();

  const cena = await remendar(original, await lisa("#E4E1D8"), [AREA], "story");

  expect(perto(await corEm(cena, 400, 500), [0xe4, 0xe1, 0xd8])).toBe(true);
  expect(perto(await corEm(cena, 850, 1050), [0x2f, 0x64, 0x6a])).toBe(true);
});

// Em produção o modelo devolveu a área transparente ou preta, e a cena gravou um retângulo preto no lugar do texto.
test("área devolvida transparente é recusada em vez de virar preto na cena", async () => {
  const vazia = await sharp({ create: { width: largura, height: altura, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  expect(remendar(await lisa("#F0F0F0"), vazia, [AREA], "story")).rejects.toThrow("vazia");
});

test("área devolvida pintada de preto também é recusada", async () => {
  const comBuraco = await sharp(await lisa("#F0F0F0"))
    .composite([{ input: { create: { width: AREA.largura, height: AREA.altura, channels: 3, background: "#000" } }, left: AREA.x, top: AREA.y }])
    .png()
    .toBuffer();
  expect(remendar(await lisa("#F0F0F0"), comBuraco, [AREA], "story")).rejects.toThrow("vazia");
});
