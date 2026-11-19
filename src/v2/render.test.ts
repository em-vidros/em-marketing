import { describe, expect, spyOn, test } from "bun:test";
import sharp from "sharp";
import { AJUSTES_NEUTROS } from "./camadas";
import type { Peso } from "./fontes";
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

describe("fontes do catálogo", () => {
  const playfair = Bun.file(`${process.cwd()}/brand/assets/fonts/PlayfairDisplay-Variable.ttf`);
  const texto = { id: "t", tipo: "texto", texto: "Ação e coração", tamanho: 120, entrelinha: 1.1, cor: "#000000", alinhamento: "esquerda", x: 40, y: 400, largura: 1000 } as const;
  const cena = sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#FFFFFF" } }).jpeg().toBuffer();
  const desenhar = async (fonte: string, peso: Peso) => sharp(await renderizar({ formato: "feed", camadas: [{ ...texto, fonte, peso }], ajustes: AJUSTES_NEUTROS }, new Uint8Array(await cena))).raw().toBuffer();
  const diferentes = (a: Buffer, b: Buffer) => a.filter((v, i) => v !== b[i]).length;

  test("o PNG desenha o texto com o arquivo baixado do CDN, e cai em Poppins quando o download falha", async () => {
    const rede = spyOn(globalThis, "fetch").mockImplementation((async (url: string) =>
      String(url).includes("/pacifico@") ? new Response(await playfair.arrayBuffer()) : new Response(null, { status: 503 })) as typeof fetch);

    try {
      const [baixada, local, poppins, semRede] = await Promise.all([desenhar("Pacifico", 400), desenhar("Playfair Display", 500), desenhar("Poppins", 400), desenhar("Lobster", 400)]);
      expect(diferentes(baixada, local)).toBe(0);
      expect(diferentes(baixada, poppins)).toBeGreaterThan(1000);
      expect(diferentes(semRede, poppins)).toBe(0);
    } finally {
      rede.mockRestore();
    }
  });
});
