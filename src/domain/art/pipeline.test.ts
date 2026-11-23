import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import sharp from "sharp";
import type { generateArt } from "./generate";
import { buildPrompt, generate3Arts, type ArtVariant, type Brief, type Visual } from "./pipeline";

const brief: Brief = { pilar: "AUTORIDADE", tema: "espessura certa por aplicação", angulo: "box e guarda-corpo", precisaFotoReal: false };
const daCasa: Visual = { tipo: "casa" };
const VISUAIS: Visual[] = [{ tipo: "referencia", leitura: "Faixa teal sob foto de arquitetura." }, daCasa, { tipo: "adaptacao" }];

describe("buildPrompt", () => {
  test("não sobra marca do molde em nenhum visual e formato", () => {
    for (const visual of VISUAIS) {
      for (const formato of ["feed", "stories"] as const) {
        const prompt = buildPrompt({ formato, brief, headline: "Teste", apoio: "Apoio", visual, anexos: 1, direcao: "colagem" });
        expect(prompt).not.toMatch(/\{[A-Z_]+\}/);
        expect(prompt).toContain('Headline: "Teste"');
      }
    }
  });

  test("story declara as zonas seguras corretas do §6.2", () => {
    const prompt = buildPrompt({ formato: "stories", brief, headline: "H", visual: daCasa });
    expect(prompt).toContain("top 250px");
    expect(prompt).toContain("bottom 320px");
    expect(prompt).toContain("80px side margins");
  });

  test("feed não leva zona segura de story", () => {
    expect(buildPrompt({ formato: "feed", brief, headline: "H", visual: daCasa })).not.toContain("320px");
  });

  test("apoio só entra no feed", () => {
    expect(buildPrompt({ formato: "feed", brief, headline: "H", apoio: "linha de apoio", visual: daCasa })).toContain("linha de apoio");
    expect(buildPrompt({ formato: "stories", brief, headline: "H", apoio: "linha de apoio", visual: daCasa })).not.toContain("linha de apoio");
  });

  test("todo prompt carrega as restrições do §8.2 e da paleta", () => {
    for (const visual of VISUAIS) {
      const prompt = buildPrompt({ formato: "feed", brief: { ...brief, pilar: "MARCA" }, headline: "H", visual });
      expect(prompt).toContain("must be real photography");
      expect(prompt).toContain("#2F646A");
      expect(prompt).not.toMatch(/#(2C7A75|5FA9A2|3FA9A0|00A99D|3D3D3D)/i);
    }
  });

  test("o estilo que o usuário pediu entra no prompt e manda sobre o visual da referência", () => {
    const prompt = buildPrompt({ formato: "feed", brief, headline: "H", visual: VISUAIS[0]!, direcao: "ilustração flat com traço de giz" });
    expect(prompt).toContain("overrides the visual language");
    expect(prompt).toContain("ilustração flat com traço de giz");
  });
});

describe("generate3Arts", () => {
  type Pedido = Parameters<typeof generateArt>[0];

  async function gerarComFalso(opts: Pick<Parameters<typeof generate3Arts>[0], "referencias" | "anexos">) {
    const pedidos: Pedido[] = [];
    const cena = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#F0EFEA" } }).jpeg().toBuffer();
    const gerar = async (pedido: Pedido) => (pedidos.push(pedido), cena);

    const artes: ArtVariant[] = await generate3Arts({ postId: 990_001, brief, formato: "feed", headline: "Vidro certo", ...opts }, gerar);
    for (const a of artes) rmSync(a.path, { force: true });

    return { artes, pedidos };
  }

  test("cada variação parte de uma referência diferente: a imagem dela vai primeiro, a leitura dela vai no prompt e as imagens coladas vão depois", async () => {
    const referencias = ["a", "b", "c"].map((id, i) => ({ id, leitura: `leitura da ${id}`, imagem: new Uint8Array([i + 1]) }));
    const colada = new Uint8Array([9]);
    const { artes, pedidos } = await gerarComFalso({ referencias, anexos: [colada] });

    expect(artes.map((a) => a.referencia)).toEqual(["a", "b", "c"]);
    for (const r of referencias) {
      const pedido = pedidos.find((p) => p.prompt.includes(r.leitura));
      expect(pedido?.referencias).toEqual([r.imagem, colada]);
    }
  });

  test("com a Biblioteca vazia, as 3 variações saem no visual da casa, sem imagem de referência", async () => {
    const { artes, pedidos } = await gerarComFalso({ referencias: [], anexos: [] });

    expect(artes.map((a) => a.referencia)).toEqual([null, null, null]);
    expect(pedidos.map((p) => [p.referencias, p.prompt.includes("house look")])).toEqual([
      [[], true],
      [[], true],
      [[], true],
    ]);
  });
});
