import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { simulateReadableStream, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { BRIEF_FALSO, openaiFalsa } from "../../test/openaiFalsa";
import { q } from "../v2/banco";
import { executar } from ".";
import { montarBrief } from "./brief";
import { definirHeadline, escreverLegenda } from "../domain/caption";
import { postDaConversa, type EtapaPost } from "./post";
import type { ProgressoDoPost } from "./produzir";

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;

const uso = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const turno = (chunks: Chunk[], unified: "stop" | "tool-calls") => ({
  stream: simulateReadableStream<Chunk>({ chunks: [...chunks, { type: "finish", finishReason: { unified, raw: undefined }, usage: uso }] }),
});
const texto = (t: string) => turno([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t }, { type: "text-end", id: "t" }], "stop");
const chamar = (toolName: string, input: object = {}) =>
  turno([{ type: "tool-call", toolCallId: `${toolName}-${crypto.randomUUID()}`, toolName, input: JSON.stringify(input) }], "tool-calls");

let rede: Awaited<ReturnType<typeof openaiFalsa>> | null = null;
const arquivos: string[] = [];
afterEach(() => {
  rede?.restaurar();
  rede = null;
  for (const p of arquivos.splice(0)) rmSync(p, { force: true });
});

function guardarArquivos(p: EtapaPost | null) {
  if (p && "artes" in p) arquivos.push(...p.artes.map((a) => a.path));
  if (p && "opcoes" in p) arquivos.push(...p.opcoes.map((a) => a.path), ...(p.storyPath ? [p.storyPath] : []));
}

/** Um turno do Chefe com o modelo falso dado. Devolve as saídas de produzir_post, prévias e final, na ordem. */
async function turnoDoChefe(conversaId: string, chefe: MockLanguageModelV4, messages: ModelMessage[]) {
  const result = await executar("chefe", conversaId, messages, { resolverModelo: () => chefe });
  const saidas: { previa: boolean; saida: ProgressoDoPost }[] = [];
  for await (const p of result.stream)
    if (p.type === "tool-result" && p.toolName === "produzir_post") saidas.push({ previa: !!p.preliminary, saida: p.output as ProgressoDoPost });
  return saidas;
}

// Cada rodada de 3 artes passa pelo sharp (logo e gate visual), uns 2,5 s: os testes que geram têm prazo de 20 s.
describe("produzir_post", () => {
  test("um pedido de post ao Chefe: 2 passos do Chefe até as 3 artes, cada arte chega sozinha, a legenda vem pronta e a story sai direto depois da escolha", async () => {
    // As 3 imagens terminam em tempos diferentes: a primeira prévia sai antes das outras duas.
    rede = await openaiFalsa({ brief: { ...BRIEF_FALSO, formato: "ambos" }, espera: { imagem: (n) => [10, 120, 240][n - 1] ?? 0 } });
    const conversaId = `produzir-${crypto.randomUUID()}`;
    const pedido = "Post de AUTORIDADE sobre vidro temperado x comum, feed e stories.";
    const chefe = new MockLanguageModelV4({ doStream: [chamar("produzir_post", { pedido }), texto("Qual você quer?")] });

    const saidas = await turnoDoChefe(conversaId, chefe, [{ role: "user", content: pedido }]);
    guardarArquivos(await postDaConversa(conversaId));

    // Quantas artes cada prévia traz: uma a uma, na ordem em que ficam prontas.
    const previas = saidas.filter((s) => s.previa).map((s) => [s.saida.fase, s.saida.artes.length]);
    expect(previas).toEqual([
      ["brief", 0],
      ["headline", 0],
      ["artes", 1],
      ["artes", 2],
      ["artes", 3],
      ["pronto", 3],
    ]);
    const final = saidas.at(-1)!;
    expect(final).toMatchObject({ previa: false, saida: { fase: "pronto", formato: "ambos", legenda: { texto: expect.stringContaining("#EMVidros") } } });
    expect(final.saida.artes.map((a) => a.imagemId)).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(chefe.doStreamCalls).toHaveLength(2);
    expect(["brief", "headline", "legenda", "leitura", "imagem"].map((t) => [t, rede!.contar(t as never)])).toEqual([
      ["brief", 1],
      ["headline", 1],
      ["legenda", 1],
      ["leitura", 3],
      ["imagem", 3],
    ]);
    expect(await postDaConversa(conversaId)).toMatchObject({ etapa: "artes", legenda: expect.stringContaining("#EMVidros") });

    const depois = new MockLanguageModelV4({ doStream: [chamar("escolher_arte", { variante: 2 }), chamar("derivar_story"), texto("Pronto para publicar.")] });
    await turnoDoChefe(conversaId, depois, [{ role: "user", content: "Quero a variação 2." }]);
    const pronto = await postDaConversa(conversaId);
    guardarArquivos(pronto);

    expect(depois.doStreamCalls).toHaveLength(3);
    expect(pronto).toMatchObject({ etapa: "legenda", peca: { arte: { variant: 2 } }, storyPath: expect.any(String), legenda: expect.stringContaining("#EMVidros") });
    expect([rede.contar("leitura"), rede.contar("imagem")]).toEqual([4, 4]);
  }, 20_000);

  test("o Chefe produz o post sem delegar ao Post e chama a story direto", async () => {
    const chefe = new MockLanguageModelV4({ doStream: texto("Oi.") });
    await turnoDoChefe(`produzir-${crypto.randomUUID()}`, chefe, [{ role: "user", content: "Oi" }]);
    const ferramentas = (chefe.doStreamCalls[0]?.tools ?? []).map((t) => t.name);

    expect(ferramentas).toEqual(expect.arrayContaining(["produzir_post", "escolher_arte", "derivar_story", "pesquisar_referencias", "usar_foto"]));
    expect(ferramentas).not.toContain("delegar_post");
  });

  test("foto real sem foto no banco: a peça sai do brief tipográfico, com o aviso de que uma foto deixaria melhor", async () => {
    const alternativa = { tema: "o que muda entre temperado e comum", angulo: "comparação tipográfica" };
    rede = await openaiFalsa({ brief: { ...BRIEF_FALSO, tema: "box entregue xqzsemfoto", precisa_foto_real: true, alternativa_tipografica: alternativa } });
    const conversaId = `produzir-${crypto.randomUUID()}`;
    const chefe = new MockLanguageModelV4({ doStream: [chamar("produzir_post", { pedido: "Post da obra entregue." }), texto("Qual?")] });

    const saidas = await turnoDoChefe(conversaId, chefe, [{ role: "user", content: "Post da obra entregue." }]);
    guardarArquivos(await postDaConversa(conversaId));

    expect(saidas.at(-1)?.saida).toMatchObject({
      fase: "pronto",
      brief: { ...alternativa, precisaFotoReal: false },
      avisos: [expect.stringContaining("Uma foto real deixaria a peça melhor")],
    });
    expect(rede.contar("imagem")).toBe(3);
  }, 20_000);

  test("foto real com foto no banco: nada é gerado e o Chefe recebe as fotos para usar_foto", async () => {
    const palavra = `xq${crypto.randomUUID().slice(0, 6)}`;
    await q`INSERT INTO fotos (path, descricao, tags) VALUES (${`/tmp/${palavra}.jpg`}, ${`Box entregue ${palavra}`}, ${palavra})`;
    rede = await openaiFalsa({ brief: { ...BRIEF_FALSO, tema: `box ${palavra}`, precisa_foto_real: true, alternativa_tipografica: { tema: "t", angulo: "a" } } });
    const conversaId = `produzir-${crypto.randomUUID()}`;
    const chefe = new MockLanguageModelV4({ doStream: [chamar("produzir_post", { pedido: "Post do box entregue." }), texto("Achei uma foto.")] });

    const saidas = await turnoDoChefe(conversaId, chefe, [{ role: "user", content: "Post do box entregue." }]);

    expect(saidas.at(-1)?.saida).toMatchObject({ fase: "foto", fotosCandidatas: [expect.objectContaining({ descricao: `Box entregue ${palavra}` })] });
    expect([rede.contar("headline"), rede.contar("imagem")]).toEqual([0, 0]);
    expect(await postDaConversa(conversaId)).toMatchObject({ etapa: "formato", brief: { precisaFotoReal: true } });
  });
});

/** Onde dois textos deixam de ser iguais. */
const prefixoComum = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(0, i);
};

describe("cache de prompt", () => {
  test("brief, headline e legenda mandam a parte fixa antes da que muda: dois posts diferentes repetem o prefixo até o pedido", async () => {
    rede = await openaiFalsa();
    await montarBrief("Post sobre box de vidro para o Dia das Mães.");
    await montarBrief("Post sobre espelho bisotado na sala.");
    const [a, b] = [
      { pilar: "AUTORIDADE", tema: "temperado x comum", precisaFotoReal: false },
      { pilar: "PROVA", tema: "Dia do Vidraceiro", precisaFotoReal: false },
    ] as const;
    await definirHeadline(a, "feed");
    await definirHeadline(b, "stories");
    await escreverLegenda(a, "Headline A");
    await escreverLegenda(b, "Headline B");

    const pedidos = (tipo: "brief" | "headline" | "legenda") =>
      rede!.chamadas.filter((c) => c.tipo === tipo).map((c) => `${c.corpo.instructions}\n${String(c.corpo.input)}`);
    const comum = (tipo: "brief" | "headline" | "legenda") => prefixoComum(...(pedidos(tipo) as [string, string]));

    // Tudo até o pedido é igual entre os dois posts; o que muda vem no fim.
    expect(comum("brief")).toContain("--- BRANDBOOK (capítulos de conteúdo) ---");
    expect(comum("brief")).toContain("--- DATA DE HOJE ---");
    expect(comum("headline")).toContain("Responda SÓ o JSON.");
    expect(comum("headline")).toContain("\n\nBrief: {");
    expect(comum("legenda")).toContain("Responda SÓ a legenda.");
    expect(comum("legenda")).toContain("\n\nBrief: {");
    expect(new Set(rede.chamadas.map((c) => c.corpo.prompt_cache_key))).toEqual(new Set(["em-vidros-brief", "em-vidros-headline", "em-vidros-legenda"]));
  });
});
