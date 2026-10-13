import { expect, test, describe } from "bun:test";
import { existsSync } from "node:fs";
import { buildPrompt, stylesFor, PILARES, type Brief } from "./pipeline";
import styleMap from "../../styles/map.json";
import { tokens } from "../brand";

const brief: Brief = { pilar: "AUTORIDADE", tema: "espessura certa por aplicação", angulo: "box e guarda-corpo", precisaFotoReal: false };

describe("mapa de estilos", () => {
  test("todo pilar do brandbook tem um trio", () => {
    for (const p of PILARES) expect(stylesFor(p)).toHaveLength(3);
  });

  test("os trios batem com as chaves de tokens.pilares", () => {
    const doMapa = Object.keys(styleMap).filter((k) => !k.startsWith("_")).sort();
    expect(doMapa).toEqual([...PILARES].sort());
    expect(doMapa).toEqual(Object.keys(tokens.pilares).sort());
  });

  test("todo estilo referenciado existe em disco", () => {
    for (const p of PILARES) for (const s of stylesFor(p)) expect(existsSync(`styles/${s}.md`)).toBe(true);
  });

  test("cada trio tem três estilos distintos", () => {
    for (const p of PILARES) expect(new Set(stylesFor(p)).size).toBe(3);
  });

  test("foto-real está fora do mapa — §8.2 proíbe gerá-lo", () => {
    for (const p of PILARES) expect(stylesFor(p)).not.toContain("foto-real");
  });
});

describe("buildPrompt", () => {
  test("não sobra placeholder em nenhum estilo e formato", () => {
    for (const p of PILARES)
      for (const styleId of stylesFor(p))
        for (const formato of ["feed", "stories"] as const) {
          const prompt = buildPrompt({ styleId, formato, brief: { ...brief, pilar: p }, headline: "Teste", apoio: "Apoio" });
          expect(prompt).not.toMatch(/\{[A-Z_]+\}/);
          expect(prompt).toContain("Teste");
        }
  });

  test("story declara as zonas seguras corretas do §6.2", () => {
    const prompt = buildPrompt({ styleId: "tecnico-poppins", formato: "stories", brief, headline: "H" });
    expect(prompt).toContain("top 250px");
    expect(prompt).toContain("bottom 320px");
  });

  test("feed não leva zona segura de story", () => {
    const prompt = buildPrompt({ styleId: "tecnico-poppins", formato: "feed", brief, headline: "H" });
    expect(prompt).not.toContain("320px");
  });

  test("apoio só entra no feed", () => {
    expect(buildPrompt({ styleId: "tecnico-poppins", formato: "feed", brief, headline: "H", apoio: "linha de apoio" })).toContain("linha de apoio");
    expect(buildPrompt({ styleId: "tecnico-poppins", formato: "stories", brief, headline: "H", apoio: "linha de apoio" })).not.toContain("linha de apoio");
  });

  test("todo prompt carrega as restrições do §8.2 e da paleta", () => {
    const prompt = buildPrompt({ styleId: "editorial-serifado", formato: "feed", brief: { ...brief, pilar: "MARCA" }, headline: "H" });
    expect(prompt).toContain("must be real photography");
    expect(prompt).toContain("#2F646A");
    expect(prompt).not.toMatch(/#(2C7A75|5FA9A2|3FA9A0|00A99D|3D3D3D)/i);
  });

  test("foto-real se recusa a virar prompt", () => {
    expect(() => buildPrompt({ styleId: "foto-real", formato: "feed", brief, headline: "H" })).toThrow(/§8.2/);
  });
});
