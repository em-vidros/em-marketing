import { expect, test, describe } from "bun:test";
import { capitulos, CONVERSA, VOZ, VISUAL, tokens } from "./index";

describe("fatiamento do brandbook", () => {
  // Se um heading `# N. Título` mudar de forma, o cérebro quebra no boot.
  // Este teste é o alarme.
  test("os capítulos que o código consome existem", () => {
    for (const n of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16]) {
      expect(() => capitulos(n)).not.toThrow();
      expect(capitulos(n).length).toBeGreaterThan(100);
    }
  });

  test("capítulo inexistente lança", () => {
    expect(() => capitulos(99)).toThrow(/99/);
  });

  test("cada fatia traz o conteúdo certo", () => {
    expect(capitulos(9)).toContain("Léxico proibido");
    expect(capitulos(11)).toContain("Lista branca");
    expect(capitulos(12)).toContain("AUTORIDADE");
    expect(capitulos(8)).toContain("Onde a IA é permitida");
  });

  test("VOZ traz o léxico proibido e o sistema de hashtag", () => {
    const v = VOZ();
    expect(v).toContain("Você sabia");
    expect(v).toContain("#EMVidros");
  });

  test("CONVERSA traz os pilares e o checklist, e é bem menor que o brandbook inteiro", () => {
    const c = CONVERSA();
    expect(c).toContain("Checklist de aprovação");
    expect(c).toContain("PROVA");
    expect(c.length).toBeLessThan(30_000);
  });

  test("VISUAL traz cor, tipografia e textura", () => {
    const v = VISUAL();
    expect(v).toContain("#2F646A");
    expect(v).toContain("Poppins");
    expect(v).toContain("JATEADO");
  });
});

describe("tokens contra o brandbook", () => {
  test("a paleta bate com o capítulo 4", () => {
    const cap4 = capitulos(4);
    for (const hex of ["#2F646A", "#63B5AF", "#414141", "#F0EFEA", "#E4E1D8", "#D8D5CE", "#8A8A8A", "#B4552E", "#4A7C59"])
      expect(cap4).toContain(hex);
    expect(tokens.color.primary.tealProfundo.hex).toBe("#2F646A");
    expect(tokens.color.primary.tealClaro.hex).toBe("#63B5AF");
    expect(tokens.color.primary.grafite.hex).toBe("#414141");
  });

  test("nenhuma cor descontinuada sobrou como valor de cor", () => {
    // Percorre a árvore coletando só valores que SÃO uma cor (string hex
    // isolada), ignorando prosa — a chave `descontinuadas` e as notas citam os
    // hexes legados de propósito.
    const usados = new Set<string>();
    const walk = (node: unknown, chave = ""): void => {
      if (typeof node === "string") {
        if (/^#[0-9a-f]{6}$/i.test(node.trim()) && chave !== "descontinuadas") usados.add(node.toUpperCase());
      } else if (Array.isArray(node)) node.forEach((v) => walk(v, chave));
      else if (node && typeof node === "object")
        for (const [k, v] of Object.entries(node)) walk(v, k === "descontinuadas" ? k : chave || k);
    };
    walk(tokens);

    expect(usados.size).toBeGreaterThan(5);
    for (const hex of ["#00A99D", "#32A999", "#2C7A75", "#5FA9A2", "#3FA9A0", "#1B5E63", "#3D3D3D"])
      expect([...usados]).not.toContain(hex);
  });

  test("os percentuais dos pilares somam 1", () => {
    const soma = Object.values(tokens.pilares).reduce((s, p) => s + p.percentual, 0);
    expect(soma).toBeCloseTo(1, 5);
  });

  test("as zonas seguras do story são 250 no topo e 320 na base", () => {
    expect(tokens.formats.stories.safeZones).toEqual({ topPx: 250, bottomPx: 320 });
  });
});
