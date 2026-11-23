import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import sharp from "sharp";
import type { generateArt } from "./generate";
import { REGRA_DO_TEXTO } from "./conferencia";
import { buildPrompt, deriveStory, generate3Arts, type ArtVariant, type Brief, type IaDaArte, type Visual } from "./pipeline";

const brief: Brief = { pilar: "AUTORIDADE", tema: "espessura certa por aplicação", angulo: "box e guarda-corpo", precisaFotoReal: false };
const daCasa: Visual = { tipo: "casa" };
const VISUAIS: Visual[] = [{ tipo: "referencia", leitura: "Faixa teal sob foto de arquitetura." }, daCasa, { tipo: "pedido" }];

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
    expect(prompt).toContain("bottom 340px");
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

  async function gerarComFalso(opts: Pick<Parameters<typeof generate3Arts>[0], "referencias" | "anexos">, cor = "#F0EFEA") {
    const pedidos: Pedido[] = [];
    const cena = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: cor } }).jpeg().toBuffer();
    const gerar = async (pedido: Pedido) => (pedidos.push(pedido), cena);

    const artes: ArtVariant[] = await generate3Arts({ postId: 990_001, brief, formato: "feed", headline: "Vidro certo", ...opts }, { gerar, lerTexto: async () => ["Vidro certo"] });
    for (const a of artes) rmSync(a.path, { force: true });

    return { artes, pedidos };
  }

  test("cada variação parte de uma referência diferente: a imagem dela vai primeiro, a leitura dela vai no prompt e as imagens coladas vão depois", async () => {
    const referencias = ["a", "b", "c"].map((id, i) => ({ origem: "biblioteca" as const, id, arquivo: `${id}.png`, leitura: `leitura da ${id}`, imagem: new Uint8Array([i + 1]) }));
    const colada = new Uint8Array([9]);
    const { artes, pedidos } = await gerarComFalso({ referencias, anexos: [colada] });

    expect(artes.map((a) => a.ancora)).toEqual(referencias.map(({ imagem: _, ...ancora }) => ancora));
    for (const r of referencias) {
      const pedido = pedidos.find((p) => p.prompt.includes(r.leitura));
      expect(pedido?.referencias).toEqual([r.imagem, colada]);
    }
  });

  test("com a Biblioteca vazia, as 3 variações saem no visual da casa, sem imagem de referência", async () => {
    const { artes, pedidos } = await gerarComFalso({ referencias: [], anexos: [] });

    expect(artes.map((a) => a.ancora)).toEqual([null, null, null]);
    expect(pedidos.map((p) => [p.referencias, p.prompt.includes("house look")])).toEqual([
      [[], true],
      [[], true],
      [[], true],
    ]);
  });

  test("o gate de paleta só mede a arte no visual da casa: a variação de uma referência e a story derivada dela pulam a checagem", async () => {
    const vermelho = "#D02020";
    const temPaleta = (a: { problemas: { regra: string }[] }) => a.problemas.some((p) => p.regra === "§4.1 paleta");
    const referencia = { origem: "biblioteca" as const, id: "foto", arquivo: "foto.png", leitura: "foto de obra", imagem: new Uint8Array([1]) };

    const daReferencia = await gerarComFalso({ referencias: [referencia], anexos: [] }, vermelho);
    const daCasa = await gerarComFalso({ referencias: [], anexos: [] }, vermelho);
    expect(daReferencia.artes.map(temPaleta)).toEqual([false, false, false]);
    expect(daCasa.artes.map(temPaleta)).toEqual([true, true, true]);

    const story = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: vermelho } }).jpeg().toBuffer();
    const derivar = async (chosen: ArtVariant) => {
      const derivada = await deriveStory({ postId: 990_002, brief, headline: "Vidro certo", chosen }, { gerar: async () => story, lerTexto: async () => ["Vidro certo"] });
      rmSync(derivada.path, { force: true });
      return derivada;
    };
    expect(temPaleta(await derivar(daReferencia.artes[0]!))).toBe(false);
    expect(temPaleta(await derivar(daCasa.artes[0]!))).toBe(true);
  });
});

describe("conferência do texto da arte", () => {
  type Pedido = Parameters<IaDaArte["gerar"]>[0];
  const CORES = { primeira: "#D02020", segunda: "#F0EFEA" } as const;

  /** A IA falsa: a primeira tentativa de cada variação sai vermelha, a refação sai off-white, e cada uma tem a leitura dada. */
  async function gerarComLeituras(leituras: { primeira: string[]; segunda: string[] }) {
    const pedidos: Pedido[] = [];
    const lidas = new Map<Uint8Array, string[]>();
    const cenas = {
      primeira: await sharp({ create: { width: 1080, height: 1350, channels: 3, background: CORES.primeira } }).jpeg().toBuffer(),
      segunda: await sharp({ create: { width: 1080, height: 1350, channels: 3, background: CORES.segunda } }).jpeg().toBuffer(),
    };
    const ia: IaDaArte = {
      gerar: async (pedido) => {
        pedidos.push(pedido);
        const vez = pedido.prompt.includes("SPELLING CHECK") ? "segunda" : "primeira";
        const cena = Buffer.from(cenas[vez]);
        lidas.set(cena, leituras[vez]);
        return cena;
      },
      lerTexto: async (jpeg) => lidas.get(jpeg) ?? [],
    };
    const artes = await generate3Arts({ postId: 990_003, brief, formato: "feed", headline: "Vidro certo", apoio: "Sem erro de grafia", referencias: [], anexos: [] }, ia);
    const vermelhas = await Promise.all(artes.map(async (a) => (await sharp(a.path).stats()).channels[0]!.mean > 150 && (await sharp(a.path).stats()).channels[1]!.mean < 150));
    for (const a of artes) rmSync(a.path, { force: true });
    const doTexto = artes.map((a) => a.problemas.filter((p) => p.regra === REGRA_DO_TEXTO).map((p) => p.detalhe));
    return { pedidos, doTexto, vermelhas };
  }

  test("o texto certo na primeira não refaz a arte", async () => {
    const { pedidos, doTexto } = await gerarComLeituras({ primeira: ["VIDRO CERTO", "Sem erro de grafia."], segunda: [] });
    expect(pedidos).toHaveLength(3);
    expect(doTexto).toEqual([[], [], []]);
  });

  test("o texto errado refaz a arte uma vez, com o erro no prompt, e a refação certa fica sem aviso", async () => {
    const { pedidos, doTexto, vermelhas } = await gerarComLeituras({ primeira: ["Vidor certo", "Sem erro de grafia"], segunda: ["Vidro certo", "Sem erro de grafia"] });
    expect(pedidos).toHaveLength(6);
    expect(pedidos.filter((p) => p.prompt.includes('wrote "Vidor" instead of "Vidro"'))).toHaveLength(3);
    expect(doTexto).toEqual([[], [], []]);
    expect(vermelhas).toEqual([false, false, false]);
  });

  test("o texto errado duas vezes refaz uma vez só, fica a arte que errou menos e a variação leva o aviso com a palavra", async () => {
    const { pedidos, doTexto, vermelhas } = await gerarComLeituras({
      primeira: ["Vidor certo", "Sem erro de grafia"],
      segunda: ["Vidor serto", "Sem erro de grafia", "Promoção"],
    });
    expect(pedidos).toHaveLength(6);
    expect(vermelhas).toEqual([true, true, true]);
    expect(doTexto).toEqual(Array(3).fill(['Na arte, saiu "Vidor" no lugar de "Vidro".']));
  });

  test("sem a leitura, a arte segue sem refação e com o aviso de que o texto não foi conferido", async () => {
    const cena = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#F0EFEA" } }).jpeg().toBuffer();
    let geradas = 0;
    const chosen: ArtVariant = { variant: 1, ancora: null, path: "base.jpg", problemas: [] };
    const story = await deriveStory({ postId: 990_004, brief, headline: "Vidro certo", chosen }, {
      gerar: async () => (geradas++, cena),
      lerTexto: async () => {
        throw new Error("visão fora do ar");
      },
    });
    rmSync(story.path, { force: true });
    expect(geradas).toBe(1);
    expect(story.problemas.filter((p) => p.regra === REGRA_DO_TEXTO).map((p) => p.severidade)).toEqual(["aviso"]);
  });
});

describe("story derivada", () => {
  type Pedido = Parameters<IaDaArte["gerar"]>[0];
  const chosen: ArtVariant = { variant: 2, ancora: null, path: "data/arts/escolhida.jpg", problemas: [] };

  async function derivar(lidos: string[][]) {
    const pedidos: Pedido[] = [];
    const story = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#F0EFEA" } }).jpeg().toBuffer();
    const r = await deriveStory(
      { postId: 990_003, brief, headline: "Vidro certo", apoio: "Espessura por aplicação", chosen },
      { gerar: async (p) => (pedidos.push(p), story), lerTexto: async () => lidos.shift() ?? [] },
    );
    rmSync(r.path, { force: true });
    return { ...r, pedidos };
  }

  test("pede uma geração só, em 9:16, a partir da arte escolhida, com as áreas seguras e o mesmo texto do feed", async () => {
    const { pedidos, problemas } = await derivar([["Vidro certo", "Espessura por aplicação"]]);

    expect(pedidos).toHaveLength(1);
    const [pedido] = pedidos;
    expect(pedido).toMatchObject({ formato: "stories", base: chosen.path });
    expect(pedido!.prompt).toContain("9:16");
    expect(pedido!.prompt).toContain("top 250px and the bottom 340px");
    expect(pedido!.prompt).toContain("between y=250 and y=1580");
    expect(pedido!.prompt).toContain("Do NOT paste the feed image inside the story");
    expect(pedido!.prompt).toContain('Headline: "Vidro certo"');
    expect(pedido!.prompt).toContain('Support line: "Espessura por aplicação"');
    expect(problemas.filter((p) => p.regra === REGRA_DO_TEXTO)).toEqual([]);
  });

  test("passa pela conferência do texto: a linha de apoio errada faz refazer uma vez", async () => {
    const { pedidos, problemas } = await derivar([["Vidro certo", "Espesura por aplicação"], ["Vidro certo", "Espesura por aplicação"]]);

    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]!.prompt).toContain('wrote "Espesura" instead of "Espessura"');
    expect(problemas.map((p) => p.regra)).toContain(REGRA_DO_TEXTO);
  });
});
