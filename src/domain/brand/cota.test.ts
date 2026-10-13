import { describe, expect, test } from "bun:test";
import { cotaDePilares } from "./cota";

const doPilar = (r: ReturnType<typeof cotaDePilares>, p: string) => r.itens.find((i) => i.pilar === p)!;

describe("cotaDePilares (§12.1)", () => {
  test("mês vazio já mostra o mês inteiro, não zero de zero", () => {
    const r = cotaDePilares({}, 0);
    expect(r.base).toBe(8); // cadência mínima do §13.3
    expect(doPilar(r, "PROVA").ideal).toBe(3);
    expect(doPilar(r, "AUTORIDADE").ideal).toBe(2);
    expect(doPilar(r, "GENTE").ideal).toBe(2);
    expect(doPilar(r, "MARCA").ideal).toBe(1);
  });

  test("a cota ideal soma a cadência mínima", () => {
    const r = cotaDePilares({}, 0);
    expect(r.itens.reduce((s, i) => s + i.ideal, 0)).toBe(8);
  });

  test("com poucos posts a base continua sendo o mês, não o que já saiu", () => {
    // O bug que isto trava: 40% de 2 arredonda para 1, então 1 PROVA em 2 posts
    // diria "no alvo" no dia 3 do mês.
    const r = cotaDePilares({ PROVA: 1, MARCA: 1 }, 2);
    expect(r.base).toBe(8);
    expect(doPilar(r, "PROVA").faltam).toBe(2);
  });

  test("acima da cadência mínima a base acompanha o real", () => {
    const r = cotaDePilares({}, 12);
    expect(r.base).toBe(12);
    expect(doPilar(r, "PROVA").ideal).toBe(5);
  });

  test("pilar acima do alvo não devolve falta negativa", () => {
    const r = cotaDePilares({ MARCA: 6 }, 8);
    expect(doPilar(r, "MARCA").faltam).toBe(0);
    expect(doPilar(r, "MARCA").feitos).toBe(6);
  });

  test("posts sem pilar não contam para nenhum pilar", () => {
    const r = cotaDePilares({ "(sem pilar)": 5 }, 5);
    expect(r.itens.every((i) => i.feitos === 0)).toBe(true);
  });

  test("PROVA é sempre o maior alvo — 40% é o peso do §12.1", () => {
    const r = cotaDePilares({}, 10);
    const maior = r.itens.reduce((a, b) => (b.ideal > a.ideal ? b : a));
    expect(maior.pilar).toBe("PROVA");
  });
});
