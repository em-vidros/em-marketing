import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { composicao, LIMIARES, validarArte } from "./validate";

const solido = (hex: string, w = 1080, h = 1350) =>
  sharp({ create: { width: w, height: h, channels: 3, background: hex } }).jpeg({ quality: 90 }).toBuffer();

const regras = (ps: { regra: string }[]) => ps.map((p) => p.regra);
const erros = (ps: { severidade: string }[]) => ps.filter((p) => p.severidade === "erro");

describe("composicao — classificação de pixel", () => {
  test("off-white do sistema é neutro, não é matiz", async () => {
    const c = await composicao(await solido("#F0EFEA"));
    expect(c.neutro).toBeGreaterThan(0.99);
    expect(c.fora).toBeLessThan(0.01);
  });

  test("areia e linha também caem em neutro (croma baixo, não cinza puro)", async () => {
    for (const hex of ["#E4E1D8", "#D8D5CE", "#8A8A8A", "#414141", "#FFFFFF"]) {
      const c = await composicao(await solido(hex, 200, 200));
      expect(c.neutro).toBeGreaterThan(0.99);
    }
  });

  test("os dois teais do sistema entram na faixa de matiz", async () => {
    for (const hex of ["#2F646A", "#63B5AF"]) {
      const c = await composicao(await solido(hex, 200, 200));
      expect(c.teal).toBeGreaterThan(0.99);
      expect(c.fora).toBeLessThan(0.01);
    }
  });

  test("teal legado #00A99D ainda cai na faixa — o gate de cor não substitui o de hex", async () => {
    // Honestidade sobre o alcance: 174° é teal. Descontinuada ≠ fora da paleta.
    const c = await composicao(await solido("#00A99D", 200, 200));
    expect(c.teal).toBeGreaterThan(0.99);
  });

  test("cor funcional fora de contexto é matiz estranho ao sistema", async () => {
    for (const hex of ["#B4552E", "#4A7C59"]) {
      const c = await composicao(await solido(hex, 200, 200));
      expect(c.fora).toBeGreaterThan(0.9);
      expect(c.matizesFora.length).toBeGreaterThan(0);
    }
  });

  test("azul e roxo, que não existem no sistema, são reprovados", async () => {
    for (const hex of ["#1E3A8A", "#7C3AED", "#DC2626", "#F59E0B"]) {
      const c = await composicao(await solido(hex, 200, 200));
      expect(c.fora).toBeGreaterThan(0.9);
    }
  });
});

describe("validarArte", () => {
  test("peça off-white no formato certo passa limpa", async () => {
    expect(await validarArte(await solido("#F0EFEA"), "feed")).toEqual([]);
  });

  test("dimensão errada é erro", async () => {
    const ps = await validarArte(await solido("#F0EFEA", 1080, 1080), "feed");
    expect(regras(ps)).toContain("§6.1 dimensão");
    expect(erros(ps).length).toBeGreaterThan(0);
  });

  test("1080×1080 é reprovado também no formato stories", async () => {
    const ps = await validarArte(await solido("#F0EFEA", 1080, 1080), "stories");
    expect(regras(ps)).toContain("§6.1 dimensão");
  });

  test("arte fora da paleta é ERRO, não aviso", async () => {
    const ps = await validarArte(await solido("#B4552E"), "feed");
    const paleta = ps.find((p) => p.regra === "§4.1 paleta");
    expect(paleta?.severidade).toBe("erro");
  });

  test("arte inteira de teal é aviso de proporção, nunca erro — faixa-teal é legítimo", async () => {
    const ps = await validarArte(await solido("#2F646A"), "feed");
    expect(erros(ps)).toEqual([]);
    expect(regras(ps)).toContain("§4.3 proporção 70/20/10");
  });

  test("mancha colorida pequena passa do limiar de aviso sem virar erro", async () => {
    const mancha = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#F0EFEA" } })
      .composite([
        {
          input: await sharp({ create: { width: 130, height: 130, channels: 3, background: "#DC2626" } }).png().toBuffer(),
          top: 100,
          left: 100,
        },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
    const c = await composicao(mancha);
    expect(c.fora).toBeGreaterThan(LIMIARES.foraDaPaletaAviso);
    expect(c.fora).toBeLessThan(LIMIARES.foraDaPaletaErro);
    const ps = await validarArte(mancha, "feed");
    expect(ps.find((p) => p.regra === "§4.1 paleta")?.severidade).toBe("aviso");
  });
});

describe("zonas seguras do story (§6.2)", () => {
  const story = (top?: number) => {
    const base = sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#F0EFEA" } });
    if (top === undefined) return base.jpeg({ quality: 90 }).toBuffer();
    return sharp({ create: { width: 600, height: 100, channels: 3, background: "#414141" } })
      .png()
      .toBuffer()
      .then((barra) => base.composite([{ input: barra, top, left: 100 }]).jpeg({ quality: 90 }).toBuffer());
  };

  test("story limpo não acusa nada", async () => {
    expect(await validarArte(await story(), "stories")).toEqual([]);
  });

  test("conteúdo nos 250 px do topo vira aviso", async () => {
    const ps = await validarArte(await story(60), "stories");
    expect(ps.some((p) => p.regra === "§6.2 zona segura" && p.detalhe.includes("topo"))).toBe(true);
  });

  test("conteúdo nos 320 px da base vira aviso", async () => {
    const ps = await validarArte(await story(1920 - 200), "stories");
    expect(ps.some((p) => p.regra === "§6.2 zona segura" && p.detalhe.includes("base"))).toBe(true);
  });

  test("conteúdo no meio da peça não acusa zona segura", async () => {
    const ps = await validarArte(await story(900), "stories");
    expect(regras(ps)).not.toContain("§6.2 zona segura");
  });

  test("zona segura é sempre aviso — o layout quem julga é o humano", async () => {
    const ps = await validarArte(await story(60), "stories");
    expect(erros(ps)).toEqual([]);
  });
});
