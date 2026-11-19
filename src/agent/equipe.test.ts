import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { executar } from ".";
import { listarBots, situacaoDoBot, versoesDoBot } from "./config";
import { apagarBot, criarBot, NovoBot } from "./equipe";
import { tarefasDaConversa } from "./tarefas";

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;

const uso = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const turno = (chunks: Chunk[], unified: "stop" | "tool-calls") => ({
  stream: simulateReadableStream<Chunk>({ chunks: [...chunks, { type: "finish", finishReason: { unified, raw: undefined }, usage: uso }] }),
});

const texto = (t: string) => turno([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t }, { type: "text-end", id: "t" }], "stop");

const chamada = (toolCallId: string, toolName: string, input: object): Chunk => ({ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) });

/** O Chefe faz estas chamadas num passo e responde no seguinte. */
const chefeQueChama = (...chamadas: Chunk[]) => new MockLanguageModelV4({ doStream: [turno(chamadas, "tool-calls"), texto("Pronto.")] });

const ANA = "ana@emvidros.com.br";

async function conversar(chefe: MockLanguageModelV4, outro = new MockLanguageModelV4({ doStream: texto("Feito.") })) {
  const conversaId = `equipe-${crypto.randomUUID()}`;
  const result = await executar("chefe", conversaId, [{ role: "user", content: "Cuida da equipe." }], {
    resolverModelo: (bot) => (bot.id === "chefe" ? chefe : outro),
    autor: ANA,
  });
  await result.consumeStream();
  return conversaId;
}

/** O resultado de cada chamada como o modelo do Chefe recebeu, no segundo passo. */
function resultados(chefe: MockLanguageModelV4) {
  return Object.fromEntries(
    (chefe.doStreamCalls[1]?.prompt ?? [])
      .flatMap((m) => (m.role === "tool" ? m.content : []))
      .flatMap((c) => (c.type === "tool-result" ? [[c.toolCallId, c.output] as const] : [])),
  );
}

const RH = {
  nome: "Férias",
  descricao: "Tira dúvidas sobre férias e banco de horas pela CLT.",
  setor: "RH",
  forma: "nuvem",
  cor: "#30A46C",
  prompt: "Você responde dúvidas de férias da equipe da EM Vidros.",
  modelo: "openai:gpt-6-luna",
} as const;

const criarRh = async () => criarBot(await NovoBot.parseAsync(RH), ANA);

describe("o Chefe cuida dos bots da equipe", () => {
  test("cria pelo mesmo schema da rota: o bot de RH nasce sem brandbook, assinado por quem está na conversa, e entrada inválida não cria nada", async () => {
    const chefe = chefeQueChama(chamada("ok", "criar_bot", RH), chamada("ruim", "criar_bot", { ...RH, nome: "Cor errada", cor: "verde" }));

    await conversar(chefe);
    const criados = (await listarBots()).filter((b) => b.nome === "Férias" || b.nome === "Cor errada");
    const visto = resultados(chefe);

    expect(criados).toEqual([expect.objectContaining({ setor: "RH", marca: false, regras: "", criado: expect.objectContaining({ por: ANA, forma: "nuvem" }) })]);
    expect(visto.ok).toEqual({ type: "json", value: { ok: true, bot: expect.objectContaining({ id: criados[0]!.id, link: `/bots/${criados[0]!.id}` }) } });
    expect(visto.ruim).toMatchObject({ type: "error-text", value: expect.stringContaining("A cor precisa ser hexadecimal") });
  });

  test("edita só os campos mandados e grava a versão no nome de quem está na conversa; apaga o criado e recusa apagar um fixo", async () => {
    const rh = await criarRh();
    const chefe = chefeQueChama(
      chamada("editar", "editar_bot", { botId: rh.id, campos: { descricao: "Férias, banco de horas e 13º." } }),
      chamada("fixo", "remover_bot", { botId: "post" }),
      chamada("criado", "remover_bot", { botId: rh.id }),
    );

    await conversar(chefe);
    const [versao] = await versoesDoBot(rh.id);
    const visto = resultados(chefe);

    expect(versao).toMatchObject({ descricao: "Férias, banco de horas e 13º.", prompt: RH.prompt, autor: ANA });
    expect(visto.fixo).toEqual({ type: "json", value: { ok: false, motivo: "Os bots que vêm com o sistema não podem ser apagados." } });
    expect([await situacaoDoBot("post"), await situacaoDoBot(rh.id)]).toEqual(["ativo", "apagado"]);
  });

  test("delegar_bot roda o bot criado numa tarefa, e o Chefe vê os bots ativos nas instruções", async () => {
    const rh = await criarRh();
    const pedido = "Quantos dias de férias tem quem trabalhou 12 meses sem faltas?";
    const chefe = chefeQueChama(chamada("d", "delegar_bot", { botId: rh.id, pedido }));
    const doRh = new MockLanguageModelV4({ doStream: texto("30 dias corridos, pelo art. 130 da CLT.") });

    const conversaId = await conversar(chefe, doRh);
    const [tarefa] = await tarefasDaConversa(conversaId);
    const system = (m: MockLanguageModelV4) => m.doStreamCalls[0]?.prompt.find((p) => p.role === "system")?.content;

    expect(system(chefe)).toContain(`- ${rh.id}: Férias, setor RH. ${RH.descricao}`);
    expect(tarefa).toMatchObject({ botId: rh.id, pedido, status: "concluida", resumo: "30 dias corridos, pelo art. 130 da CLT." });
    expect(system(doRh)).toStartWith(`${RH.prompt}\n\nVocê é Férias, do setor RH da EM Vidros.`);
  });

  test("delegar_bot recusa um bot apagado, um id que não existe e um especialista, sem abrir tarefa", async () => {
    const rh = await criarRh();
    await apagarBot(rh.id);
    const chefe = chefeQueChama(
      chamada("apagado", "delegar_bot", { botId: rh.id, pedido: "Oi" }),
      chamada("inexistente", "delegar_bot", { botId: "b-naoexiste", pedido: "Oi" }),
      chamada("fixo", "delegar_bot", { botId: "legenda", pedido: "Oi" }),
    );

    const conversaId = await conversar(chefe);
    const visto = resultados(chefe);

    expect(await tarefasDaConversa(conversaId)).toEqual([]);
    expect(visto.apagado).toMatchObject({ type: "error-text", value: expect.stringContaining(`Não há bot ativo com o id ${rh.id}`) });
    expect(visto.inexistente).toMatchObject({ type: "error-text", value: expect.stringContaining("Não há bot ativo com o id b-naoexiste") });
    expect(visto.fixo).toMatchObject({ type: "error-text", value: expect.stringContaining("use a tool delegar_legenda") });
  });
});
