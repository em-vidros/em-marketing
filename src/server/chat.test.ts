import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, isToolUIPart, simulateReadableStream, type LanguageModel, type UIMessage } from "ai";
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
    expect(parteSalva(id)).toMatchObject({ state: "output-error", errorText: expect.stringContaining("nada foi publicado") });
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

/** Um Gemini falso que responde o que o caso pedir. retry-after-ms: 0 faz as novas tentativas do SDK saírem na hora. */
let resposta = { status: 200, corpo: {} as unknown };
const gemini = Bun.serve({
  port: 0,
  fetch: () => Response.json(resposta.corpo, { status: resposta.status, headers: { "retry-after-ms": "0" } }),
});
afterAll(() => gemini.stop(true));

const erroDoGoogle = (code: number, status: string, message: string, details: unknown[] = []) => ({ error: { code, message, status, details } });

describe("erro do provedor", () => {
  const casos: { nome: string; status?: number; corpo?: unknown; modelo?: () => LanguageModel; espera: string; original: string }[] = [
    {
      nome: "cota esgotada",
      status: 429,
      corpo: erroDoGoogle(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota, please check your plan and billing details."),
      espera: "limite de uso",
      original: "You exceeded your current quota",
    },
    {
      nome: "chave inválida",
      status: 400,
      corpo: erroDoGoogle(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", [
        { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" },
      ]),
      espera: "chave do modelo",
      original: "API key not valid",
    },
    {
      nome: "modelo sobrecarregado",
      status: 503,
      corpo: erroDoGoogle(503, "UNAVAILABLE", "The model is overloaded. Please try again later."),
      espera: "sobrecarregado",
      original: "The model is overloaded",
    },
    {
      // O que o @ai-sdk/google lança com a porta fechada, sem as novas tentativas com espera de 2 s e 4 s.
      nome: "sem rede",
      modelo: () =>
        new MockLanguageModelV4({
          doStream: async () => {
            throw new APICallError({ message: "Cannot connect to API: ECONNREFUSED", url: "http://127.0.0.1:9", requestBodyValues: {}, isRetryable: false });
          },
        }),
      espera: "falar com o modelo",
      original: "Cannot connect to API",
    },
    {
      nome: "sem chave",
      modelo: () => {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        return createGoogleGenerativeAI({ apiKey: undefined })("gemini-3.6-flash");
      },
      espera: "chave do modelo",
      original: "API key is missing",
    },
    {
      nome: "erro desconhecido",
      modelo: () =>
        new MockLanguageModelV4({
          doStream: async () => {
            throw new Error("Unexpected token in JSON at position 3");
          },
        }),
      espera: "Algo deu errado",
      original: "Unexpected token",
    },
  ];

  test.each(casos)("$nome chega em português e o original fica no log", async ({ status, corpo, modelo, espera, original }) => {
    resposta = { status: status ?? 200, corpo };
    const doGemini = () => createGoogleGenerativeAI({ apiKey: "chave", baseURL: `${gemini.url}v1beta` })("gemini-3.6-flash");
    const log = spyOn(console, "error").mockImplementation(() => {});
    const id = `erro-${crypto.randomUUID()}`;

    const chunks = await postar(rotaDeChat({ resolverModelo: modelo ?? doGemini }), id, {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Oi" }],
    });
    const logado = log.mock.calls.flat().map((a) => (a instanceof Error ? `${a.message} ${String((a as { lastError?: Error }).lastError?.message)}` : String(a)));
    log.mockRestore();

    const erro = chunks.find((c) => c.type === "error");
    expect(erro?.errorText).toContain(espera);
    expect(erro?.errorText).not.toContain(original);
    expect(logado.join("\n")).toContain(original);
  });
});
