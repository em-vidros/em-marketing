import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import sharp from "sharp";
import { estudioDeTeste, iaDeTeste } from "../../../test/estudio";
import { executar } from "..";
import { pegarArte } from "../../v2/artes";
import type { Camada } from "../../v2/camadas";
import type { ReferenciasDoTurno } from "../pedido";
import { toolsDeArtesComTexto } from "./artesComTexto";

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;
const uso = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const turno = (chunks: Chunk[], unified: "stop" | "tool-calls") => ({
  stream: simulateReadableStream<Chunk>({ chunks: [...chunks, { type: "finish", finishReason: { unified, raw: undefined }, usage: uso }] }),
});
const chamada = (toolName: string, input: unknown) => turno([{ type: "tool-call", toolCallId: "c1", toolName, input: JSON.stringify(input) }], "tool-calls");
const fala = (t: string) => turno([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t }, { type: "text-end", id: "t" }], "stop");

const base = estudioDeTeste();
const execute = (t: unknown, entrada: unknown) => (t as { execute: (e: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(entrada, { toolCallId: "t", messages: [] });
const textos = (camadas: Camada[]) => Object.fromEntries(camadas.flatMap((c) => (c.tipo === "texto" ? [[c.id, c.texto] as const] : [])));

describe("criar_convite", () => {
  test("cria a arte com o texto exato, deixa o campo que a pessoa não disse de fora e devolve o que o cartão mostra", async () => {
    const ia = iaDeTeste();
    const { criar_convite } = toolsDeArtesComTexto({ estudio: { ...base, ia }, autor: "ana@emvidros.com.br" });
    const r = await execute(criar_convite, { titulo: "Você é nosso convidado especial", evento: "Café da manhã especial", data: "28 de novembro", hora: "a partir das 8h", local: "Imperatriz" });
    expect(r).toMatchObject({ ok: true, formato: "feed", textos: ["Você é nosso convidado especial", "Café da manhã especial", "28 de novembro", "a partir das 8h", "Imperatriz"] });
    const arte = (await pegarArte(base.banco, r.arteId as string))!;
    expect(textos(arte.camadas)).toEqual({
      titulo: "Você é nosso convidado especial",
      evento: "Café da manhã especial",
      data: "28 de novembro",
      hora: "a partir das 8h",
      local: "Imperatriz",
    });
    expect(arte.criadaPor).toBe("ana@emvidros.com.br");
    expect(r.url).toMatch(new RegExp(`^/api/artes/${arte.id}/png\\?v=`));
    expect(ia.cenas).toHaveLength(1);
  });

  test("sem nenhum campo recusa com o motivo, sem gastar a geração", async () => {
    const ia = iaDeTeste();
    const { criar_convite } = toolsDeArtesComTexto({ estudio: { ...base, ia }, autor: "ana" });
    expect(await execute(criar_convite, { titulo: "   " })).toEqual({ ok: false, motivo: "Preencha ao menos um campo." });
    expect(ia.cenas).toHaveLength(0);
  });

  test("sem estúdio ligado, recusa em vez de quebrar", async () => {
    const { criar_convite } = toolsDeArtesComTexto({ autor: "ana" });
    expect(await execute(criar_convite, { titulo: "Oi" })).toMatchObject({ ok: false });
  });
});

describe("criar_aniversario", () => {
  const referencias = (coladas: string[]): ReferenciasDoTurno & { usadas: unknown[] } => {
    const usadas: unknown[] = [];
    return { coladas, usadas, carregar: async () => [], usar: (a) => void usadas.push(...a) };
  };

  test("a foto colada no pedido vira o círculo da arte e deixa de valer como referência de estilo", async () => {
    const foto = await base.arquivos.salvar(new Uint8Array(await sharp({ create: { width: 500, height: 700, channels: 3, background: "#3366cc" } }).png().toBuffer()), "png");
    const refs = referencias([foto]);
    const { criar_aniversario } = toolsDeArtesComTexto({ estudio: { ...base, ia: iaDeTeste() }, autor: "ana", referencias: refs });
    const r = await execute(criar_aniversario, { nome: "Ana Paula", mensagem: "Parabéns pelos 5 anos de casa", foto_colada: true, formato: "story" });
    expect(r).toMatchObject({ ok: true, formato: "story" });
    const arte = (await pegarArte(base.banco, r.arteId as string))!;
    expect(textos(arte.camadas)).toEqual({ nome: "Ana Paula", mensagem: "Parabéns pelos 5 anos de casa" });
    expect(arte.camadas.some((c) => c.tipo === "imagem")).toBe(true);
    expect(refs.usadas).toEqual([{ origem: "pedido", arquivo: foto }]);
  });

  test("pedir a foto sem nenhuma colada recusa e diz o que fazer", async () => {
    const ia = iaDeTeste();
    const { criar_aniversario } = toolsDeArtesComTexto({ estudio: { ...base, ia }, autor: "ana", referencias: referencias([]) });
    expect(await execute(criar_aniversario, { nome: "Ana", foto_colada: true })).toMatchObject({ ok: false, motivo: expect.stringContaining("colar a foto") });
    expect(ia.cenas).toHaveLength(0);
  });
});

describe("na conversa", () => {
  async function conversar(botId: "chefe" | "post", ferramenta: string, entrada: unknown) {
    const ia = iaDeTeste();
    const modelo = new MockLanguageModelV4({ doStream: [chamada(ferramenta, entrada), fala("Pronto.")] });
    const result = await executar(botId, `teste-${crypto.randomUUID()}`, [{ role: "user", content: "Faz o convite do café da manhã de sexta." }], {
      resolverModelo: () => modelo,
      estudio: { ...base, ia },
      autor: "ana@emvidros.com.br",
    });
    const saidas: unknown[] = [];
    for await (const parte of result.stream) if (parte.type === "tool-result") saidas.push(parte.output);
    return { saidas, ia, chamadas: modelo.doStreamCalls };
  }

  for (const bot of ["chefe", "post"] as const) {
    test(`o ${bot} cria o convite direto, sem delegar nem pedir 3 variações`, async () => {
      const { saidas, ia, chamadas } = await conversar(bot, "criar_convite", { evento: "Café da manhã especial", data: "sexta, 28 de novembro", hora: "8h", local: "Imperatriz" });
      expect(saidas).toEqual([expect.objectContaining({ ok: true, textos: ["Café da manhã especial", "sexta, 28 de novembro", "8h", "Imperatriz"] })]);
      expect(ia.cenas).toHaveLength(1);
      const ferramentas = chamadas[0]?.tools?.map((t) => t.name) ?? [];
      expect(ferramentas).toContain("criar_convite");
      expect(ferramentas).toContain("criar_aniversario");
    });
  }
});
