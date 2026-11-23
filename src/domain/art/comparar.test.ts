import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { custoDe } from "../precos";
import { compararQualidades, custoPorPost, estimarCusto, htmlDoRelatorio, PEDIDOS_DE_EXEMPLO, type PostDoRelatorio } from "./comparar";
import { generateArt } from "./generate";

const MODELO = "gpt-image-2.6-sunburst";
/** O que o fetch falso informa de consumo em cada qualidade: o high gasta 4 vezes a saída do medium. */
const SAIDA = { medium: 1_500, high: 6_000 } as const;

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Um fetch que atende só a OpenAI de imagens: devolve sempre a mesma imagem, com o `usage` da qualidade pedida. Nunca sai para a rede. */
async function fetchFalso() {
  const png = await sharp({ create: { width: 1088, height: 1360, channels: 3, background: "#2F646A" } }).png().toBuffer();
  const pedidos: { url: string; qualidade: string }[] = [];
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    if (!/\/v1\/images\/(generations|edits)$/.test(new URL(url).pathname)) throw new Error(`o fetch falso só atende imagens: ${url}`);
    const corpo = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body));
    const qualidade = String(corpo.quality) as keyof typeof SAIDA;
    pedidos.push({ url, qualidade });
    const comImagem = url.includes("/edits");
    return Response.json({
      created: 1,
      data: [{ b64_json: png.toString("base64") }],
      usage: {
        input_tokens: 800 + (comImagem ? 1_100 : 0),
        output_tokens: SAIDA[qualidade],
        input_tokens_details: { text_tokens: 800, image_tokens: comImagem ? 1_100 : 0 },
      },
    });
  }) as typeof fetch;
  return pedidos;
}

beforeAll(() => {
  // O cliente da OpenAI pede uma chave; o fetch falso a recebe e a descarta.
  process.env.OPENAI_API_KEY ||= "sk-teste-falsa";
});

describe("custoPorPost", () => {
  test("o post de 3 artes é a média por arte vezes 3, e a diferença é high menos medium", () => {
    const medium = custoDe({ modelo: MODELO, entrada: 800, saida: SAIDA.medium })!;
    const high = custoDe({ modelo: MODELO, entrada: 800, saida: SAIDA.high })!;
    const resumo = custoPorPost([{ medium: { custo: medium }, high: { custo: high } }, { medium: { custo: medium + 0.02 }, high: { custo: high + 0.02 } }])!;

    expect(resumo.medium).toBeCloseTo((medium + 0.01) * 3, 10);
    expect(resumo.high).toBeCloseTo((high + 0.01) * 3, 10);
    expect(resumo.diferenca).toBeCloseTo((high - medium) * 3, 10);
    expect(resumo.vezes).toBeGreaterThan(1);
  });

  test("sem o custo de uma das chamadas, a conta não fecha em vez de subestimar", () => {
    expect(custoPorPost([{ medium: { custo: 0.05 }, high: { custo: null } }])).toBeNull();
    expect(custoPorPost([])).toBeNull();
  });
});

describe("estimarCusto", () => {
  test("escala com o número de pedidos e põe o high acima do medium", () => {
    const um = estimarCusto(1);
    const tres = estimarCusto(3);
    expect(tres.total).toBeCloseTo(um.total * 3, 10);
    expect(tres.chamadas).toBe(6);
    expect(tres.porQualidade.high).toBeGreaterThan(tres.porQualidade.medium);
    expect(estimarCusto(3, false).total).toBeLessThan(tres.total);
  });
});

describe("htmlDoRelatorio", () => {
  const linha = (arquivo: string, custo: number, tempoMs: number, tokensDeSaida: number) => ({ arquivo, custo, tempoMs, tokensDeSaida });
  const posts: PostDoRelatorio[] = [
    { titulo: "Teste <b>", headline: 'Vidro "certo"', guia: "Guiada por uma referência", medium: linha("01-medium.jpg", 0.058, 21_000, 1_500), high: linha("01-high.jpg", 0.19, 64_500, 6_000) },
  ];

  test("traz cada par lado a lado com custo e tempo, e a diferença por post de 3 artes no topo", () => {
    const html = htmlDoRelatorio({ posts, geradoEm: new Date("2026-11-23T12:00:00Z"), modelo: MODELO, estimativa: estimarCusto(1) });

    expect(html).toContain('src="01-medium.jpg"');
    expect(html).toContain('src="01-high.jpg"');
    expect(html).toContain("US$ 0,058");
    expect(html).toContain("US$ 0,190");
    expect(html).toContain("21,0 s");
    expect(html).toContain("64,5 s");
    // 3 artes: (0,190 - 0,058) x 3 = 0,396.
    expect(html).toContain("+US$ 0,396");
    expect(html).toContain("Guiada por uma referência. Por arte, o high custa +US$ 0,132.");
    expect(html.indexOf("+US$ 0,396")).toBeLessThan(html.indexOf("<article>"));
  });

  test("o texto do pedido não vira HTML", () => {
    const html = htmlDoRelatorio({ posts, geradoEm: new Date(), modelo: MODELO });
    expect(html).not.toContain("Teste <b>");
    expect(html).toContain("Teste &lt;b&gt;");
    expect(html).toContain("Vidro &quot;certo&quot;");
  });
});

describe("compararQualidades", () => {
  const referencia = { origem: "biblioteca" as const, id: "r1", arquivo: "r1.jpg", leitura: "Faixa teal sob foto de arquitetura.", imagem: new Uint8Array([1, 2, 3]) };

  test("as duas qualidades saem do mesmo prompt e das mesmas referências, e o custo vem do usage de cada resposta", async () => {
    const chamadas = await fetchFalso();
    const pedidosDaGeracao: Parameters<typeof generateArt>[0][] = [];
    const gerar = (pedido: Parameters<typeof generateArt>[0]) => (pedidosDaGeracao.push(pedido), generateArt(pedido));

    const [par] = await compararQualidades([{ pedido: PEDIDOS_DE_EXEMPLO[0]!, referencia }], { gerar });

    expect(chamadas.map((c) => c.qualidade)).toEqual(["medium", "high"]);
    const [medium, high] = pedidosDaGeracao;
    expect(medium!.prompt).toBe(high!.prompt);
    expect(medium!.prompt).toContain(referencia.leitura);
    expect(medium!.referencias).toEqual([referencia.imagem]);
    expect(high!.referencias).toEqual([referencia.imagem]);

    expect(par!.medium.consumo?.saida).toBe(SAIDA.medium);
    expect(par!.high.consumo?.saida).toBe(SAIDA.high);
    expect(par!.medium.custo).toBeCloseTo((800 * 5 + 1_100 * 8 + SAIDA.medium * 30) / 1e6, 10);
    expect(par!.high.custo).toBeCloseTo((800 * 5 + 1_100 * 8 + SAIDA.high * 30) / 1e6, 10);
    expect(par!.high.tempoMs).toBeGreaterThan(0);
    expect((await sharp(par!.high.jpeg).metadata()).height).toBe(1350);
  });

  test("sem referência, as duas partem do visual da casa pela rota de geração", async () => {
    const chamadas = await fetchFalso();
    const [par] = await compararQualidades([{ pedido: PEDIDOS_DE_EXEMPLO[1]! }]);

    expect(chamadas.map((c) => c.url.split("/").pop())).toEqual(["generations", "generations"]);
    expect(par!.temReferencia).toBe(false);
    expect(par!.medium.custo).toBeCloseTo((800 * 5 + SAIDA.medium * 30) / 1e6, 10);
  });

  test("uma resposta sem usage fica sem custo, em vez de custar zero", async () => {
    const png = await sharp({ create: { width: 1088, height: 1360, channels: 3, background: "#2F646A" } }).png().toBuffer();
    globalThis.fetch = (async () => Response.json({ created: 1, data: [{ b64_json: png.toString("base64") }] })) as unknown as typeof fetch;

    const [par] = await compararQualidades([{ pedido: PEDIDOS_DE_EXEMPLO[2]! }]);
    expect(par!.medium.custo).toBeNull();
    expect(custoPorPost([par!])).toBeNull();
  });

  test("generateArt pede high quando ninguém escolhe a qualidade, como o app sempre pediu", async () => {
    const chamadas = await fetchFalso();
    await generateArt({ prompt: "p", formato: "feed" });
    expect(chamadas.map((c) => c.qualidade)).toEqual(["high"]);
  });
});
