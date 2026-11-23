import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import type { Area, Elementos } from "../../v2/separar";
import { ajustarArte, type IaDoAjuste, type PedidoDeAjuste } from "./ajuste";
import { REGRA_DO_TEXTO } from "./conferencia";

const [W, H] = [1080, 1350];
const bloco = (texto: string, y: number) =>
  ({ texto, x: 120, y, largura: 600, altura: 90, tamanho: 80, fonte: "Poppins", peso: "700", cor: "#2F646A", alinhamento: "esquerda" }) as const;
const ELEMENTOS: Elementos = { textos: [bloco("Box sob medida", 300), bloco("Entrega rápida em Imperatriz", 700)], logo: null };

/** A arte off-white; a IA falsa devolve a imagem inteira vermelha, para o teste ver onde ela entrou. */
const arte = () => sharp({ create: { width: W, height: H, channels: 3, background: "#F0EFEA" } }).jpeg().toBuffer();
const vermelha = () => sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#D02020" } }).png().toBuffer();

function iaFalsa(leituras: string[][] = [], caixa: Area | null = null) {
  const edicoes: { area: Area; prompt: string }[] = [];
  const ia: IaDoAjuste = {
    lerElementos: async () => ELEMENTOS,
    acharObjeto: async () => caixa,
    editarArea: async (_, __, area, prompt) => (edicoes.push({ area, prompt }), vermelha()),
    lerTexto: async () => leituras.shift() ?? [],
  };
  return { ia, edicoes };
}

/** Vermelho é onde a edição entrou; off-white é a arte de antes. */
async function mudou(jpeg: Uint8Array, x: number, y: number) {
  const { data } = await sharp(jpeg).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return data[0]! > 150 && data[1]! < 100;
}

const ajustar = async (pedido: PedidoDeAjuste, ia: IaDoAjuste) => ajustarArte({ jpeg: await arte(), formato: "feed", pedido, problemas: [] }, ia);

describe("ajuste da arte", () => {
  test("a máscara do texto cobre só o bloco citado, e fora dela a arte fica igual", async () => {
    const { ia, edicoes } = iaFalsa([["Box sob medida em 7 dias"]]);
    const r = await ajustar({ tipo: "texto", atual: "Box sob medida", novo: "Box sob medida em 7 dias" }, ia);
    if (!r.ok) throw new Error(r.motivo);

    expect(edicoes).toHaveLength(1);
    const { area } = edicoes[0]!;
    // O bloco de 300 a 390 com folga; o texto novo é mais longo, então a área vai de margem a margem.
    expect(area).toEqual({ x: 40, y: 272, largura: W - 80, altura: 146 });
    expect(await mudou(r.jpeg, 540, 345)).toBe(true);
    for (const [x, y] of [
      [540, 100],
      [540, 745],
      [540, 1300],
      [10, 345],
    ] as const)
      expect(await mudou(r.jpeg, x, y)).toBe(false);
  });

  test("a máscara do objeto é a caixa que o modelo de visão achou, com folga", async () => {
    const { ia, edicoes } = iaFalsa([], { x: 800, y: 1000, largura: 150, altura: 200 });
    const r = await ajustar({ tipo: "objeto", objeto: "the vase in the corner", mudanca: "remove it" }, ia);
    if (!r.ok) throw new Error(r.motivo);

    expect(edicoes.map((e) => e.area)).toEqual([{ x: 772, y: 972, largura: 206, altura: 256 }]);
    expect(edicoes[0]!.prompt).toContain("remove it");
    expect(await mudou(r.jpeg, 875, 1100)).toBe(true);
    expect(await mudou(r.jpeg, 540, 345)).toBe(false);
  });

  test("o texto ajustado passa pela conferência: errado na primeira, é refeito uma vez com o lembrete da grafia", async () => {
    const { ia, edicoes } = iaFalsa([["Box sob medda"], ["Box sob medida"]]);
    const r = await ajustar({ tipo: "texto", atual: "Entrega rápida em Imperatriz", novo: "Box sob medida" }, ia);
    if (!r.ok) throw new Error(r.motivo);

    expect(edicoes).toHaveLength(2);
    expect(edicoes[1]!.prompt).toContain('wrote "medda" instead of "medida"');
    expect(r.problemas).toEqual([]);
  });

  test("se a refação também erra, o ajuste fica com o aviso do texto no lugar do aviso antigo", async () => {
    const { ia } = iaFalsa([["Box sob medda"], ["Box sob medda"]]);
    const antigo = { regra: REGRA_DO_TEXTO, severidade: "erro" as const, detalhe: "Na arte, faltou \"Imperatriz\"." };
    const r = await ajustarArte(
      { jpeg: await arte(), formato: "feed", pedido: { tipo: "texto", atual: "Box sob medida", novo: "Box sob medida" }, problemas: [antigo] },
      ia,
    );
    if (!r.ok) throw new Error(r.motivo);
    expect(r.problemas.map((p) => p.detalhe)).toEqual(['Na arte, saiu "medda" no lugar de "medida".']);
  });

  test("texto ou objeto que não está na arte não gasta edição e diz o que a arte tem", async () => {
    const { ia, edicoes } = iaFalsa();
    const texto = await ajustar({ tipo: "texto", atual: "Promoção de inverno", novo: "Outra" }, ia);
    const objeto = await ajustar({ tipo: "objeto", objeto: "a cat", mudanca: "remove it" }, ia);

    expect(texto).toEqual({ ok: false, motivo: expect.stringContaining('"Box sob medida", "Entrega rápida em Imperatriz"') });
    expect(objeto.ok).toBe(false);
    expect(edicoes).toHaveLength(0);
  });
});
