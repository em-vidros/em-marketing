import { afterAll, expect, test } from "bun:test";
import { rmSync, utimesSync } from "node:fs";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import sharp from "sharp";
import { executar } from ".";
import { urlDaMidia } from "../db";
import { salvarFoto } from "../domain/fotos";
import { rotas } from "../server/rotas";
import { imagensEm } from "../web/tipos";
import { abrirConversa, criarPost } from "./post";

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;

const uso = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const turno = (chunks: Chunk[], unified: "stop" | "tool-calls") => ({
  stream: simulateReadableStream<Chunk>({ chunks: [...chunks, { type: "finish", finishReason: { unified, raw: undefined }, usage: uso }] }),
});

const server = Bun.serve({ port: 0, routes: rotas() });
const criados: string[] = [];
afterAll(() => {
  server.stop(true);
  for (const p of criados) rmSync(p, { force: true });
});

/** O Post chama usar_foto e devolve a saída que o painel da tarefa recebe. */
async function usarFoto(conversaId: string, fotoId: number) {
  const post = new MockLanguageModelV4({
    doStream: [
      turno([{ type: "tool-call", toolCallId: "u1", toolName: "usar_foto", input: JSON.stringify({ foto_id: fotoId }) }], "tool-calls"),
      turno([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Pronto." }, { type: "text-end", id: "t" }], "stop"),
    ],
  });
  const result = executar("post", conversaId, [{ role: "user", content: "Use a foto." }], { resolverModelo: () => post });
  for await (const part of result.stream) if (part.type === "tool-result" && part.toolName === "usar_foto") return part.output;
  throw new Error("usar_foto não devolveu resultado");
}

test("a foto que usar_foto prepara aparece no painel por uma URL /media que abre", async () => {
  const foto = await salvarFoto(await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#2F646A" } }).jpeg().toBuffer());
  criados.push(foto.path);
  const conversaId = `midia-${crypto.randomUUID()}`;
  abrirConversa(conversaId, "post");
  const { postId } = criarPost(conversaId, { pilar: "PROVA", tema: "box temperado", precisaFotoReal: true }, "feed");
  criados.push(`data/arts/post${postId}-feed-foto${foto.id}.jpg`);

  const primeira = imagensEm(await usarFoto(conversaId, foto.id));

  expect(primeira).toHaveLength(1);
  const res = await fetch(new URL(primeira[0]!, server.url));
  expect([res.status, res.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
  expect((await sharp(await res.bytes()).metadata()).width).toBe(1080);
});

test("uma arte refeita no mesmo caminho ganha outra URL /media, e a URL só muda quando o arquivo muda", async () => {
  const path = `data/arts/teste-refeita-${crypto.randomUUID()}.jpg`;
  criados.push(path);
  await Bun.write(path, "primeira");
  utimesSync(path, 1_700_000_000, 1_700_000_000);
  const antes = urlDaMidia(path);

  await Bun.write(path, "refeita");
  utimesSync(path, 1_700_000_100, 1_700_000_100);
  const depois = urlDaMidia(path);

  expect(depois).not.toBe(antes);
  expect(urlDaMidia(path)).toBe(depois);
  expect(await (await fetch(new URL(depois, server.url))).text()).toBe("refeita");
});
