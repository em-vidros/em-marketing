import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, isToolUIPart, simulateReadableStream, type LanguageModel, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AINDA_RESPONDENDO, abrirConversaDoUsuario, apagarMensagem, conversaDoUsuario, mensagensDaConversa } from "../agent/conversas";
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
const AGENDAR = { publish_at: "2099-10-15T18:00:00-03:00", media_type: "IMAGE" };

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

/** POST /api/chat como o useChat manda. */
const pedir = (rota: ReturnType<typeof rotaDeChat>, conversaId: string, ultima: UIMessage, botId = "chefe") =>
  rota(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ id: conversaId, botId, messages: [ultima] }) }), usuario);

/** POST /api/chat e os chunks do stream de resposta. */
async function postar(rota: ReturnType<typeof rotaDeChat>, conversaId: string, ultima: UIMessage) {
  const corpo = await (await pedir(rota, conversaId, ultima)).text();
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

const doUsuario = (id: string, texto: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: texto }] });
const textos = (conversaId: string) => mensagensDaConversa(conversaId).map((m) => [m.role, m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("")]);
const responde = (texto: string) =>
  turnoDoModelo([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: texto }, { type: "text-end", id: "t" }], "stop");

describe("editar e apagar mensagens", () => {
  test("editar a mensagem do usuário descarta o que veio depois e o bot responde ao texto novo", async () => {
    const modelo = new MockLanguageModelV4({ doStream: async () => responde("Ok.") });
    const rota = rotaDeChat({ resolverModelo: () => modelo });
    const id = `editar-${crypto.randomUUID()}`;
    await postar(rota, id, doUsuario("u1", "pedido-original"));
    await postar(rota, id, doUsuario("u2", "pedido-seguinte"));

    await postar(rota, id, doUsuario("u1", "pedido-editado"));

    const visto = JSON.stringify(modelo.doStreamCalls.at(-1)?.prompt);
    expect(visto).toContain("pedido-editado");
    expect(visto).not.toContain("pedido-original");
    expect(visto).not.toContain("pedido-seguinte");
    expect(textos(id)).toEqual([
      ["user", "pedido-editado"],
      ["assistant", "Ok."],
    ]);
  });

  test("a mensagem do bot não se edita, nem como mensagem do usuário nem reescrita pelo cliente", async () => {
    const rota = rotaDeChat({ resolverModelo: () => new MockLanguageModelV4({ doStream: async () => responde("Ok.") }) });
    const id = `editar-bot-${crypto.randomUUID()}`;
    await postar(rota, id, doUsuario("u1", "Oi"));
    const doBot = mensagensDaConversa(id)[1]!;

    const comoUsuario = await pedir(rota, id, doUsuario(doBot.id, "reescrita"));
    await (await pedir(rota, id, { ...doBot, parts: [{ type: "text", text: "reescrita" }] })).text();

    expect([comoUsuario.status, await comoUsuario.json()]).toEqual([400, { erro: "Só dá para editar as suas mensagens." }]);
    expect(textos(id).map(([, t]) => t).join(" ")).not.toContain("reescrita");
  });

  test("a aprovação de uma mensagem apagada é recusada e não agenda nada", async () => {
    const id = conversaComPost();
    const rota = rotaDeChat({ resolverModelo: chefeQueAgenda, segredoAprovacao: "segredo" });
    await postar(rota, id, doUsuario("u1", "Agende para quinta às 18h."));
    const aprovacao = aprovar(id);

    const apagada = apagarMensagem(usuario.id, id, aprovacao.id);
    const res = await pedir(rota, id, aprovacao);

    expect(apagada.ok).toBe(true);
    expect([res.status, await res.json()]).toEqual([409, { erro: "Esta mensagem não está mais na conversa." }]);
    expect(agendados(id)).toBe(0);
    expect(parteSalva(id)).toBeUndefined();
  });

  test("enquanto o bot responde, editar, mandar e apagar mensagem dão 409", async () => {
    const portao = Promise.withResolvers<void>();
    let chamadas = 0;
    const modelo = new MockLanguageModelV4({
      doStream: async () => {
        if (chamadas++ === 1) await portao.promise;
        return responde("Ok.");
      },
    });
    const rota = rotaDeChat({ resolverModelo: () => modelo });
    const id = `ocupada-${crypto.randomUUID()}`;
    await postar(rota, id, doUsuario("u1", "primeira"));
    const emCurso = await pedir(rota, id, doUsuario("u2", "segunda"));

    const edicao = await pedir(rota, id, doUsuario("u1", "editada"));
    const apagar = apagarMensagem(usuario.id, id, "u1");
    portao.resolve();
    await emCurso.text();
    const depois = apagarMensagem(usuario.id, id, "u2");

    expect([edicao.status, await edicao.json()]).toEqual([409, { erro: AINDA_RESPONDENDO }]);
    expect(apagar).toEqual({ ok: false, status: 409, erro: AINDA_RESPONDENDO });
    expect(depois.ok).toBe(true);
    expect(textos(id)).toEqual([
      ["user", "primeira"],
      ["assistant", "Ok."],
    ]);
  });
});

describe("conversa direta com um especialista", () => {
  test("a conversa fica com a Legenda e o modelo dela não recebe as tools de publicar", async () => {
    const modelo = new MockLanguageModelV4({ doStream: async () => responde("Revisei.") });
    const id = `direta-${crypto.randomUUID()}`;

    await (await pedir(rotaDeChat({ resolverModelo: () => modelo }), id, doUsuario("u1", "Revise esta legenda."), "legenda")).text();

    const tools = modelo.doStreamCalls[0]?.tools?.map((t) => t.name);
    expect(conversaDoUsuario(usuario.id, id)?.botId).toBe("legenda");
    expect(tools).toContain("redigir_legenda");
    expect(tools).not.toContain("publicar_agora");
    expect(tools).not.toContain("agendar_publicacao");
    expect(textos(id)).toEqual([
      ["user", "Revise esta legenda."],
      ["assistant", "Revisei."],
    ]);
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
