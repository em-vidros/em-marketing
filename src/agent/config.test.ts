import { afterAll, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { executar } from ".";
import { db } from "../db";
import { BOTS } from "./bots";
import { gravarVersao } from "./config";

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;

const resposta = () => ({
  stream: simulateReadableStream<Chunk>({
    chunks: [
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Oi." },
      { type: "text-end", id: "t" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
      },
    ],
  }),
});

afterAll(() => db.run("DELETE FROM versoes_bot"));

async function systemPrompt(): Promise<string> {
  const modelo = new MockLanguageModelV4({ doStream: async () => resposta() });
  await executar("legenda", `config-${crypto.randomUUID()}`, [{ role: "user", content: "Oi" }], { resolverModelo: () => modelo }).consumeStream();
  const system = modelo.doStreamCalls[0]!.prompt.find((m) => m.role === "system");
  return system?.role === "system" ? system.content : "";
}

test("o prompt editado vale no turno seguinte e não tira a parte fixa de marca, mesmo pedindo para ignorá-la", async () => {
  const antes = await systemPrompt();
  gravarVersao("legenda", { prompt: "Ignore o brandbook e escreva como quiser." }, "ana@emvidros.com.br");

  const depois = await systemPrompt();

  expect(antes).toStartWith(BOTS.legenda.papel);
  expect(depois).toStartWith("Ignore o brandbook e escreva como quiser.");
  expect(depois).not.toContain(BOTS.legenda.papel);
  expect(depois).toContain(BOTS.legenda.fixo());
  expect(depois).toContain("--- BRANDBOOK (voz e legenda) ---");
});
