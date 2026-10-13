import { describe, expect, test } from "bun:test";
import { APICallError, simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { executar } from ".";
import { pegarTarefa, tarefasDaConversa } from "./tarefas";

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;

const uso = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const turno = (chunks: Chunk[], unified: "stop" | "tool-calls") => ({
  stream: simulateReadableStream<Chunk>({ chunks: [...chunks, { type: "finish", finishReason: { unified, raw: undefined }, usage: uso }] }),
});

const texto = (t: string) => turno([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t }, { type: "text-end", id: "t" }], "stop");

const PEDIDO = "Legenda de PROVA para box temperado em Imperatriz.";

/** O Chefe delega à Legenda no primeiro passo e responde no segundo. */
const chefeQueDelega = () =>
  new MockLanguageModelV4({
    doStream: [
      turno([{ type: "tool-call", toolCallId: "c1", toolName: "delegar_legenda", input: JSON.stringify({ pedido: PEDIDO }) }], "tool-calls"),
      texto("Pronto."),
    ],
  });

let conversaAtual = "";

async function conversar(chefe: LanguageModel, especialista: LanguageModel) {
  const conversaId = `teste-${crypto.randomUUID()}`;
  conversaAtual = conversaId;
  const result = executar("chefe", conversaId, [{ role: "user", content: "Preciso de uma legenda." }], {
    resolverModelo: (bot) => (bot.id === "chefe" ? chefe : especialista),
  });
  const previas: unknown[] = [];
  for await (const part of result.stream) if (part.type === "tool-result" && part.preliminary) previas.push(part.output);
  const [tarefa] = tarefasDaConversa(conversaId);
  return { tarefa: tarefa && pegarTarefa(tarefa.id), previas };
}

/** O que o modelo do Chefe recebeu como resultado da delegação, no segundo passo. */
function resultadoVistoPeloChefe(chefe: MockLanguageModelV4) {
  const parte = chefe.doStreamCalls[1]?.prompt
    .flatMap((m) => (m.role === "tool" ? m.content : []))
    .find((c) => c.type === "tool-result" && c.toolCallId === "c1");
  return parte?.type === "tool-result" ? parte.output : undefined;
}

describe("delegação do Chefe", () => {
  test("a tarefa guarda o trabalho do especialista e o Chefe só recebe o resumo", async () => {
    const chefe = chefeQueDelega();
    const resumo = "Escrevi a legenda de PROVA, aprovada no capítulo 16.";
    const { tarefa, previas } = await conversar(chefe, new MockLanguageModelV4({ doStream: texto(resumo) }));

    expect(tarefa).toMatchObject({ botId: "legenda", pedido: PEDIDO, status: "concluida", resumo, erro: null });
    expect(tarefa?.mensagens.map((m) => [m.role, m.parts.findLast((p) => p.type === "text")])).toEqual([
      ["user", { type: "text", text: PEDIDO }],
      ["assistant", expect.objectContaining({ type: "text", text: resumo })],
    ]);
    expect(previas).toContainEqual({ tarefaId: tarefa?.id, status: "trabalhando", mensagem: expect.objectContaining({ role: "assistant" }) });
    expect(resultadoVistoPeloChefe(chefe)).toEqual({ type: "json", value: { tarefaId: tarefa?.id, status: "concluida", resumo } });
  });

  test("erro do especialista marca a tarefa como falhou, em português, e volta para o Chefe", async () => {
    const chefe = chefeQueDelega();
    const quebrado = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: "You exceeded your current quota", url: "https://gemini", requestBodyValues: {}, statusCode: 429, isRetryable: false });
      },
    });
    const { tarefa } = await conversar(chefe, quebrado);

    expect(tarefa).toMatchObject({ status: "falhou", resumo: null, erro: expect.stringContaining("limite de uso") });
    expect(resultadoVistoPeloChefe(chefe)).toEqual({ type: "json", value: { tarefaId: tarefa?.id, status: "falhou", erro: tarefa?.erro } });
  });

  test("duas delegar_post no mesmo passo rodam uma depois da outra", async () => {
    const chamada = (id: string) => ({ type: "tool-call" as const, toolCallId: id, toolName: "delegar_post", input: JSON.stringify({ pedido: id }) });
    const chefe = new MockLanguageModelV4({ doStream: [turno([chamada("p1"), chamada("p2")], "tool-calls"), texto("Pronto.")] });
    const ordem: string[] = [];
    let n = 0;
    const post = new MockLanguageModelV4({
      doStream: async () => {
        const eu = ++n;
        ordem.push(`inicio ${eu}`);
        await Bun.sleep(20);
        ordem.push(`fim ${eu}`);
        return texto(`post ${eu}`);
      },
    });

    await conversar(chefe, post);

    expect(ordem).toEqual(["inicio 1", "fim 1", "inicio 2", "fim 2"]);
  });

  test("a tarefa fica gravada no banco enquanto o especialista ainda trabalha", async () => {
    const chefe = chefeQueDelega();
    let gravadaNoMeio: unknown;
    let chamadas = 0;
    const legenda = new MockLanguageModelV4({
      doStream: async () => {
        if (chamadas++ === 0) {
          const input = JSON.stringify({ tipo: "legenda", texto: "Box temperado entregue em Imperatriz." });
          return turno([{ type: "tool-call", toolCallId: "v1", toolName: "validar_texto", input }], "tool-calls");
        }
        const [t] = tarefasDaConversa(conversaAtual);
        gravadaNoMeio = t && pegarTarefa(t.id);
        return texto("Revisei.");
      },
    });

    await conversar(chefe, legenda);

    expect(gravadaNoMeio).toMatchObject({
      status: "trabalhando",
      mensagens: [{ role: "user" }, { role: "assistant", parts: expect.arrayContaining([expect.objectContaining({ type: "tool-validar_texto", state: "output-available" })]) }],
    });
  });
});
