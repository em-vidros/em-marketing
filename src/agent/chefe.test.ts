import { afterAll, describe, expect, test } from "bun:test";
import { APICallError, simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { executar } from ".";
import { PARADO_PELO_USUARIO } from "./conversas";
import { criarBot, NovoBot } from "./equipe";
import { pegarTarefa, tarefasDaConversa } from "./tarefas";
import { q } from "../v2/banco";

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
  const result = await executar("chefe", conversaId, [{ role: "user", content: "Preciso de uma legenda." }], {
    resolverModelo: (bot) => (bot.id === "chefe" ? chefe : especialista),
  });
  const previas: unknown[] = [];
  for await (const part of result.stream) if (part.type === "tool-result" && part.preliminary) previas.push(part.output);
  const [tarefa] = await tarefasDaConversa(conversaId);
  return { tarefa: tarefa && (await pegarTarefa(tarefa.id)), previas };
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
        throw new APICallError({ message: "You exceeded your current quota", url: "https://api.openai.com", requestBodyValues: {}, statusCode: 429, isRetryable: false });
      },
    });
    const { tarefa } = await conversar(chefe, quebrado);

    expect(tarefa).toMatchObject({ status: "falhou", resumo: null, erro: expect.stringContaining("limite de uso") });
    expect(resultadoVistoPeloChefe(chefe)).toEqual({ type: "json", value: { tarefaId: tarefa?.id, status: "falhou", erro: tarefa?.erro } });
  });

  test("a tarefa parada no meio fica como falhou, com o motivo, e não como concluída", async () => {
    const parar = new AbortController();
    const legenda = new MockLanguageModelV4({
      doStream: async () => {
        parar.abort();
        return { stream: new ReadableStream<Chunk>({ start: (c) => c.enqueue({ type: "text-start", id: "t" }) }) };
      },
    });
    const conversaId = `teste-${crypto.randomUUID()}`;
    const result = await executar("chefe", conversaId, [{ role: "user", content: "Preciso de uma legenda." }], {
      resolverModelo: (bot) => (bot.id === "chefe" ? chefeQueDelega() : legenda),
      abortSignal: parar.signal,
    });

    await result.consumeStream();
    // O turno do Chefe fecha antes de a tool gravar o fim da tarefa.
    const terminada = async () => (await tarefasDaConversa(conversaId)).find((t) => t.status === "falhou" || t.status === "concluida");
    let tarefa = await terminada();
    for (let i = 0; i < 100 && !tarefa; i++) tarefa = await Bun.sleep(10).then(terminada);

    expect(tarefa).toMatchObject({ status: "falhou", erro: PARADO_PELO_USUARIO });
  });

  /** Um bot criado tem as tools de post entre as livres: ele mexe no post da conversa como o Post mexia. */
  const criados: string[] = [];
  const botComPost = async () => {
    const bot = await criarBot(
      await NovoBot.parseAsync({ nome: "Peças", descricao: "Monta peças.", setor: "Marketing", forma: "circulo", cor: "#30A46C", prompt: "Você monta peças.", modelo: "openai:gpt-6-luna" }),
      "ana@emvidros.com.br",
    );
    criados.push(bot.id);
    return bot;
  };
  // O banco é de todos os arquivos de teste: um bot que sobra muda a lista da equipe dos outros.
  afterAll(async () => {
    for (const id of criados.splice(0)) {
      await q`DELETE FROM versoes_bot WHERE bot_id = ${id}`;
      await q`DELETE FROM bots WHERE id = ${id}`;
    }
  });

  test("duas delegações a um bot que mexe no post, no mesmo passo, rodam uma depois da outra", async () => {
    const { id } = await botComPost();
    const chamada = (c: string) => ({ type: "tool-call" as const, toolCallId: c, toolName: "delegar_bot", input: JSON.stringify({ botId: id, pedido: c }) });
    const chefe = new MockLanguageModelV4({ doStream: [turno([chamada("p1"), chamada("p2")], "tool-calls"), texto("Pronto.")] });
    const ordem: string[] = [];
    let n = 0;
    const bot = new MockLanguageModelV4({
      doStream: async () => {
        const eu = ++n;
        ordem.push(`inicio ${eu}`);
        await Bun.sleep(20);
        ordem.push(`fim ${eu}`);
        return texto(`bot ${eu}`);
      },
    });

    await conversar(chefe, bot);

    expect(ordem).toEqual(["inicio 1", "fim 1", "inicio 2", "fim 2"]);
  });

  test("o bot delegado não recebe escolher_arte nem mostrar_artes: a variação só é escolhida num turno com o usuário", async () => {
    const { id } = await botComPost();
    const chefe = new MockLanguageModelV4({
      doStream: [turno([{ type: "tool-call", toolCallId: "c1", toolName: "delegar_bot", input: JSON.stringify({ botId: id, pedido: "Gere as artes." }) }], "tool-calls"), texto("Pronto.")],
    });
    const bot = new MockLanguageModelV4({ doStream: texto("Artes geradas, esperando a escolha.") });

    await conversar(chefe, bot);
    const ferramentas = (m: MockLanguageModelV4) => (m.doStreamCalls[0]?.tools ?? []).map((t) => t.name);

    expect(ferramentas(bot)).toContain("gerar_3_artes");
    expect(ferramentas(bot)).not.toContain("escolher_arte");
    expect(ferramentas(bot)).not.toContain("mostrar_artes");
    expect(ferramentas(chefe)).toEqual(expect.arrayContaining(["mostrar_artes", "escolher_arte"]));
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
        const [t] = await tarefasDaConversa(conversaAtual);
        gravadaNoMeio = t && (await pegarTarefa(t.id));
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
