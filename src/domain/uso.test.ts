import { expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { executar } from "../agent";
import { abrirConversa, criarPost } from "../agent/post";
import { q } from "../v2/banco";
import { naConversa, registrarUso, resumoDoUso } from "./uso";

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;

const passo = (entrada: number, cacheRead: number, unified: "stop" | "tool-calls", chunks: Chunk[]) => ({
  stream: simulateReadableStream<Chunk>({
    chunks: [
      ...chunks,
      {
        type: "finish",
        finishReason: { unified, raw: undefined },
        usage: {
          inputTokens: { total: entrada, noCache: entrada - cacheRead, cacheRead, cacheWrite: undefined },
          outputTokens: { total: 100, text: 100, reasoning: undefined },
        },
      },
    ],
  }),
});

async function conversaComPost() {
  const conversaId = `uso-${crypto.randomUUID()}`;
  await abrirConversa(conversaId, "post");
  const { postId } = await criarPost(conversaId, { pilar: "PROVA", tema: "box temperado", precisaFotoReal: false }, "feed");
  return { conversaId, postId };
}

test("cada passo do bot vira uma linha com o custo, na conta da conversa e do post em andamento", async () => {
  const { conversaId, postId } = await conversaComPost();
  const modelo = new MockLanguageModelV4({
    doStream: [
      passo(10_000, 4_000, "tool-calls", [{ type: "tool-call", toolCallId: "l1", toolName: "lembrar", input: JSON.stringify({ nota: "Prefere azul." }) }]),
      passo(12_000, 0, "stop", [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Feito." }, { type: "text-end", id: "t" }]),
    ],
  });
  const r = await executar("post", conversaId, [{ role: "user", content: "Lembre que prefiro azul." }], { resolverModelo: () => modelo });
  await r.consumeStream();
  await Bun.sleep(50);

  const linhas = await q<{ entrada: number; cache_lido: number; custo: number; post_id: number }>`
    SELECT entrada, cache_lido, custo, post_id FROM uso_api WHERE conversa = ${conversaId} ORDER BY id`;
  expect(linhas).toEqual([
    { entrada: 10_000, cache_lido: 4_000, custo: (6_000 * 0.1 + 4_000 * 0.01 + 100 * 0.5) / 1e6, post_id: postId },
    { entrada: 12_000, cache_lido: 0, custo: (12_000 * 0.1 + 100 * 0.5) / 1e6, post_id: postId },
  ]);
  const doPost = (await resumoDoUso()).porPost.find((p) => p.postId === postId);
  expect(doPost?.custo).toBeCloseTo(linhas.reduce((s, l) => s + l.custo, 0), 12);
});

test("o uso gravado lá no fundo de uma tool, depois de esperas, cai na conversa dela", async () => {
  const { conversaId, postId } = await conversaComPost();
  await naConversa(conversaId, async () => {
    await Bun.sleep(5);
    await Promise.resolve().then(() => registrarUso({ origem: "teste", modelo: "gpt-image-2.6-sunburst", entrada: 0, saida: 1_000, imagens: 1 }));
  });
  await registrarUso({ origem: "teste", modelo: "gpt-image-2.6-sunburst", entrada: 0, saida: 1_000, imagens: 1 });

  expect(await q`SELECT post_id, imagens FROM uso_api WHERE conversa = ${conversaId}`).toEqual([{ post_id: postId, imagens: 1 }]);
});
