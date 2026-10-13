import { describe, expect, test } from "bun:test";
import { isToolUIPart, simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { abrirConversaDoUsuario, mensagensDaConversa } from "../agent/conversas";
import { criarPost, gravarPost, transicionar, type EtapaPost, type Evento } from "../agent/post";
import { db } from "../db";
import { rotaDeChat } from "./chat";

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;

const uso = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const turnoDoModelo = (chunks: Chunk[], unified: "stop" | "tool-calls") => ({
  stream: simulateReadableStream<Chunk>({ chunks: [...chunks, { type: "finish", finishReason: { unified, raw: undefined }, usage: uso }] }),
});

const usuario = { id: "usuario-do-chat", email: "ana@emvidros.com.br", nome: "Ana" };
const AGENDAR = { publish_at: "2026-10-15T18:00:00-03:00", media_type: "IMAGE" };

/** O Chefe pede para agendar no primeiro passo; depois só responde. */
const chefeQueAgenda = () => {
  let chamadas = 0;
  return new MockLanguageModelV4({
    doStream: async () =>
      chamadas++ === 0
        ? turnoDoModelo([{ type: "tool-call", toolCallId: "agendar-1", toolName: "agendar_publicacao", input: JSON.stringify(AGENDAR) }], "tool-calls")
        : turnoDoModelo([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Agendado." }, { type: "text-end", id: "t" }], "stop"),
  });
};

/** Uma conversa com um post já registrado no Linear, pronto para agendar. */
function conversaComPost(): string {
  const id = `chat-${crypto.randomUUID()}`;
  abrirConversaDoUsuario(usuario.id, id, "chefe", "Post de teste");
  const arte = { variant: 1, style: "tecnico-poppins", path: "v1.jpg", interactionId: "i1", problemas: [] };
  const eventos: Evento[] = [
    { tipo: "headline", headline: { headline: "O temperado quebra em grãos.", apoio: "" } },
    { tipo: "artes", artes: [arte] },
    { tipo: "escolha", variante: 1 },
    { tipo: "legenda", legenda: "Legenda." },
    { tipo: "registro", linearId: "EMV-1" },
  ];
  const post = eventos.reduce<EtapaPost>((p, e) => {
    const r = transicionar(p, e);
    if (!r.ok) throw new Error(r.motivo);
    return r.post;
  }, criarPost(id, { pilar: "AUTORIDADE", tema: "temperado", precisaFotoReal: false }, "feed"));
  gravarPost(post);
  return id;
}

/** POST /api/chat como o useChat manda, e os chunks do stream de resposta. */
async function postar(rota: ReturnType<typeof rotaDeChat>, conversaId: string, ultima: UIMessage) {
  const req = new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({ id: conversaId, botId: "chefe", messages: [ultima] }),
  });
  const corpo = await (await rota(req, usuario)).text();
  return corpo
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)) as { type: string; toolCallId?: string; errorText?: string });
}

/** A última mensagem do assistente com o pedido de aprovação respondido, como o card manda. */
function aprovar(conversaId: string): UIMessage {
  const m = mensagensDaConversa(conversaId).findLast((x) => x.role === "assistant")!;
  return {
    ...m,
    parts: m.parts.map((p) =>
      isToolUIPart(p) && p.state === "approval-requested" ? { ...p, state: "approval-responded", approval: { ...p.approval, approved: true } } : p,
    ) as UIMessage["parts"],
  };
}

const parteSalva = (conversaId: string) =>
  mensagensDaConversa(conversaId)
    .flatMap((m) => m.parts)
    .find((p) => isToolUIPart(p) && p.toolCallId === "agendar-1");

const agendados = (conversaId: string) =>
  (db.query("SELECT COUNT(*) AS n FROM queue q JOIN conversas c ON c.post_id = q.post_id WHERE c.id = ?").get(conversaId) as { n: number }).n;

describe("aprovação de tool", () => {
  test("aprovação recusada pelo servidor fica salva como não executada, com erro em português no stream", async () => {
    const id = conversaComPost();
    const pergunta: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Agende para quinta às 18h." }] };
    await postar(rotaDeChat({ resolverModelo: chefeQueAgenda, segredoAprovacao: "segredo-de-ontem" }), id, pergunta);

    const chunks = await postar(rotaDeChat({ resolverModelo: chefeQueAgenda, segredoAprovacao: "segredo-de-hoje" }), id, aprovar(id));

    expect(agendados(id)).toBe(0);
    expect(parteSalva(id)).toMatchObject({ state: "output-error", errorText: expect.stringContaining("Nada foi publicado") });
    expect(chunks).toContainEqual(expect.objectContaining({ type: "tool-output-error", toolCallId: "agendar-1" }));
  });

  test("a mesma aprovação mandada de novo não executa a tool outra vez", async () => {
    const id = conversaComPost();
    const rota = rotaDeChat({ resolverModelo: chefeQueAgenda, segredoAprovacao: "segredo" });
    await postar(rota, id, { id: "u1", role: "user", parts: [{ type: "text", text: "Agende para quinta às 18h." }] });
    const aprovacao = aprovar(id);
    await postar(rota, id, aprovacao);

    const reenvio = await postar(rota, id, aprovacao);

    expect(agendados(id)).toBe(1);
    expect(parteSalva(id)).toMatchObject({ state: "output-available", output: { ok: true } });
    expect(reenvio).not.toContainEqual(expect.objectContaining({ type: "tool-output-available", toolCallId: "agendar-1" }));
  });
});
