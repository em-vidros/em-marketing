import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, isToolUIPart, simulateReadableStream, type LanguageModel, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AINDA_RESPONDENDO, abrirConversaDoUsuario, apagarMensagem, conversaDoUsuario, mensagensDaConversa, pararTurno } from "../agent/conversas";
import type { BotId } from "../agent/bots";
import { criarPost, gravarPost, transicionar, type EtapaPost, type Evento } from "../agent/post";
import { primeira } from "../db";
import { q } from "../v2/banco";
import { rmSync } from "node:fs";
import sharp from "sharp";
import { postDaConversa } from "../agent/post";
import type { CarregarReferencias } from "../v2/referencias";
import { rotaDeChat } from "./chat";

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;

const uso = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const turnoDoModelo = (chunks: Chunk[], unified: "stop" | "tool-calls") => ({
  stream: simulateReadableStream<Chunk>({ chunks: [...chunks, { type: "finish", finishReason: { unified, raw: undefined }, usage: uso }] }),
});

const usuario = { id: "usuario-do-chat", email: "ana@emvidros.com.br", nome: "Ana", admin: false };
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

const PRONTO_PARA_AGENDAR: Evento[] = [
  { tipo: "headline", headline: { headline: "O temperado quebra em grãos.", apoio: "" } },
  { tipo: "artes", artes: [{ variant: 1, ancora: null, path: "v1.jpg", problemas: [] }] },
  { tipo: "escolha", variante: 1 },
  { tipo: "legenda", legenda: "Legenda." },
];

/** Uma conversa com um post. Por padrão, com arte escolhida e legenda, pronto para agendar. */
async function conversaComPost(botId: BotId = "chefe", eventos = PRONTO_PARA_AGENDAR): Promise<string> {
  const id = `chat-${crypto.randomUUID()}`;
  await abrirConversaDoUsuario(usuario.id, id, botId, "Post de teste");
  const post = eventos.reduce<EtapaPost>((p, e) => {
    const r = transicionar(p, e);
    if (!r.ok) throw new Error(r.motivo);
    return r.post;
  }, await criarPost(id, { pilar: "AUTORIDADE", tema: "temperado", precisaFotoReal: false }, "feed"));
  await gravarPost(post);
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
async function aprovar(conversaId: string): Promise<UIMessage> {
  const m = (await mensagensDaConversa(conversaId)).findLast((x) => x.role === "assistant")!;
  return {
    ...m,
    parts: m.parts.map((p) =>
      isToolUIPart(p) && p.state === "approval-requested" ? { ...p, state: "approval-responded", approval: { ...p.approval, approved: true } } : p,
    ) as UIMessage["parts"],
  };
}

const parteSalva = async (conversaId: string) =>
  (await mensagensDaConversa(conversaId))
    .flatMap((m) => m.parts)
    .find((p) => isToolUIPart(p) && p.toolCallId === "agendar-1");

const agendados = async (conversaId: string) =>
  (await primeira(q<{ n: number }>`SELECT count(*)::int AS n FROM queue q JOIN conversas c ON c.post_id = q.post_id WHERE c.id = ${conversaId}`))!.n;

describe("aprovação de tool", () => {
  test("aprovação recusada pelo servidor fica salva como não executada, com erro em português no stream", async () => {
    const id = await conversaComPost();
    const pergunta: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Agende para quinta às 18h." }] };
    await postar(rotaDeChat({ resolverModelo: chefeQueAgenda, segredoAprovacao: "segredo-de-ontem" }), id, pergunta);

    const chunks = await postar(rotaDeChat({ resolverModelo: chefeQueAgenda, segredoAprovacao: "segredo-de-hoje" }), id, await aprovar(id));

    expect(await agendados(id)).toBe(0);
    expect(await parteSalva(id)).toMatchObject({ state: "output-error", errorText: expect.stringContaining("nada foi publicado") });
    expect(chunks).toContainEqual(expect.objectContaining({ type: "tool-output-error", toolCallId: "agendar-1" }));
  });

  test("a mesma aprovação mandada de novo não executa a tool outra vez", async () => {
    const id = await conversaComPost();
    const rota = rotaDeChat({ resolverModelo: chefeQueAgenda, segredoAprovacao: "segredo" });
    await postar(rota, id, { id: "u1", role: "user", parts: [{ type: "text", text: "Agende para quinta às 18h." }] });
    const aprovacao = await aprovar(id);
    await postar(rota, id, aprovacao);

    const reenvio = await postar(rota, id, aprovacao);

    expect(await agendados(id)).toBe(1);
    expect(await parteSalva(id)).toMatchObject({ state: "output-available", output: { ok: true } });
    expect(reenvio).not.toContainEqual(expect.objectContaining({ type: "tool-output-available", toolCallId: "agendar-1" }));
  });
});

const doUsuario = (id: string, texto: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: texto }] });
const textos = async (conversaId: string) => (await mensagensDaConversa(conversaId)).map((m) => [m.role, m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("")]);
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
    expect(await textos(id)).toEqual([
      ["user", "pedido-editado"],
      ["assistant", "Ok."],
    ]);
  });

  test("a mensagem do bot não se edita, nem como mensagem do usuário nem reescrita pelo cliente", async () => {
    const rota = rotaDeChat({ resolverModelo: () => new MockLanguageModelV4({ doStream: async () => responde("Ok.") }) });
    const id = `editar-bot-${crypto.randomUUID()}`;
    await postar(rota, id, doUsuario("u1", "Oi"));
    const doBot = (await mensagensDaConversa(id))[1]!;

    const comoUsuario = await pedir(rota, id, doUsuario(doBot.id, "reescrita"));
    await (await pedir(rota, id, { ...doBot, parts: [{ type: "text", text: "reescrita" }] })).text();

    expect([comoUsuario.status, await comoUsuario.json()]).toEqual([400, { erro: "Só dá para editar as suas mensagens." }]);
    expect((await textos(id)).map(([, t]) => t).join(" ")).not.toContain("reescrita");
  });

  test("a aprovação de uma mensagem apagada é recusada e não agenda nada", async () => {
    const id = await conversaComPost();
    const rota = rotaDeChat({ resolverModelo: chefeQueAgenda, segredoAprovacao: "segredo" });
    await postar(rota, id, doUsuario("u1", "Agende para quinta às 18h."));
    const aprovacao = await aprovar(id);

    const apagada = await apagarMensagem(usuario, id, aprovacao.id);
    const res = await pedir(rota, id, aprovacao);

    expect(apagada.ok).toBe(true);
    expect([res.status, await res.json()]).toEqual([409, { erro: "Esta mensagem não está mais na conversa." }]);
    expect(await agendados(id)).toBe(0);
    expect(await parteSalva(id)).toBeUndefined();
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
    const apagar = await apagarMensagem(usuario, id, "u1");
    portao.resolve();
    await emCurso.text();
    const depois = await apagarMensagem(usuario, id, "u2");

    expect([edicao.status, await edicao.json()]).toEqual([409, { erro: AINDA_RESPONDENDO }]);
    expect(apagar).toEqual({ ok: false, status: 409, erro: AINDA_RESPONDENDO });
    expect(depois.ok).toBe(true);
    expect(await textos(id)).toEqual([
      ["user", "primeira"],
      ["assistant", "Ok."],
    ]);
  });
});

describe("parar", () => {
  test("Parar com uma tool rodando corta o turno, grava a resposta pela metade e a mensagem seguinte é respondida", async () => {
    let chamadas = 0;
    const modelo = new MockLanguageModelV4({
      doStream: async () =>
        chamadas++ > 0
          ? responde("Ok.")
          : turnoDoModelo(
              [
                { type: "text-start", id: "t" },
                { type: "text-delta", id: "t", delta: "Vou gerar as artes." },
                { type: "text-end", id: "t" },
                { type: "tool-call", toolCallId: "artes-1", toolName: "gerar_3_artes", input: "{}" },
              ],
              "tool-calls",
            ),
    });
    // As artes não saem nunca: só o sinal de parar encerra o turno.
    const gerando = Promise.withResolvers<void>();
    const carregarReferencias = () => {
      gerando.resolve();
      return new Promise<never>(() => {});
    };
    const rota = rotaDeChat({ resolverModelo: () => modelo, carregarReferencias });
    const id = await conversaComPost("post", PRONTO_PARA_AGENDAR.slice(0, 1));
    const emCurso = await pedir(rota, id, doUsuario("u1", "Gere as artes."), "post");
    await gerando.promise;

    await emCurso.body!.cancel();
    await pararTurno(usuario, id);
    const seguinte = await pedir(rota, id, doUsuario("u2", "Outra coisa."), "post");
    await seguinte.text();

    expect(seguinte.status).toBe(200);
    expect(await textos(id)).toEqual([
      ["user", "Gere as artes."],
      ["assistant", "Vou gerar as artes."],
      ["user", "Outra coisa."],
      ["assistant", "Ok."],
    ]);
    expect((await mensagensDaConversa(id))[1]?.parts.find(isToolUIPart)).toMatchObject({ state: "output-error", errorText: "Parado pelo usuário antes de terminar." });
  });
});

describe("referências do pedido", () => {
  const chamar = (toolName: string, input: object = {}) =>
    turnoDoModelo([{ type: "tool-call", toolCallId: `${toolName}-${crypto.randomUUID()}`, toolName, input: JSON.stringify(input) }], "tool-calls");

  /**
   * O modelo de imagem responde pela rede falsa: a geração roda inteira sem chamar a OpenAI. O cliente da OpenAI recusa
   * chave vazia antes de chamar o fetch, então a chave é falsa; qualquer outra chamada à OpenAI falha o teste.
   */
  async function semOpenAI() {
    const cena = (await sharp({ create: { width: 1088, height: 1360, channels: 3, background: "#2F646A" } }).png().toBuffer()).toString("base64");
    const original = globalThis.fetch;
    const chave = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-teste-nunca-chega-na-openai";
    const rede = spyOn(globalThis, "fetch").mockImplementation((async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(entrada instanceof Request ? entrada.url : entrada);
      if (url.hostname !== "api.openai.com") return original(entrada, init);
      if (url.pathname.startsWith("/v1/images/")) return Response.json({ data: [{ b64_json: cena }] });
      throw new Error(`O teste tentou chamar a OpenAI de verdade: ${url.pathname}`);
    }) as typeof fetch);
    return {
      restaurar() {
        rede.mockRestore();
        if (chave === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = chave;
      },
    };
  }

  test("a escolha do pedido chega à geração delegada pelo Chefe na ordem da pessoa, sobrevive a uma pergunta e não vale para a geração seguinte", async () => {
    const roteiro = [
      () => responde("Feed ou stories?"),
      () => chamar("delegar_post", { pedido: "Gere as 3 artes no feed." }),
      () => chamar("gerar_3_artes"),
      () => responde("Gerei as 3."),
      () => chamar("mostrar_artes"),
      () => responde("Qual você quer?"),
      () => chamar("delegar_post", { pedido: "Gere de novo." }),
      () => chamar("gerar_3_artes"),
      () => responde("Gerei de novo."),
      () => responde("Pronto."),
    ];
    const modelo = new MockLanguageModelV4({ doStream: async () => roteiro.shift()!() });
    const jpeg = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#F0EFEA" } }).jpeg().toBuffer());
    const pedidas: unknown[] = [];
    const carregarReferencias: CarregarReferencias = async ({ escolha }) => {
      pedidas.push(escolha);
      return [
        ...(escolha?.marcadas ?? []).map((id) => ({ origem: "biblioteca" as const, id, arquivo: `${id}.png`, leitura: `leitura ${id}`, imagem: jpeg })),
        ...(escolha?.coladas ?? []).map((arquivo) => ({ origem: "pedido" as const, arquivo, imagem: jpeg })),
      ];
    };
    const rota = rotaDeChat({ resolverModelo: () => modelo, carregarReferencias });
    const id = await conversaComPost("chefe", PRONTO_PARA_AGENDAR.slice(0, 1));
    const [a, b, colada] = [crypto.randomUUID(), crypto.randomUUID(), `${crypto.randomUUID()}.png`];
    const rede = await semOpenAI();
    const geradas: string[] = [];
    const guardar = (p: EtapaPost | null) => (p?.etapa === "artes" && geradas.push(...p.artes.map((x) => x.path)), p);

    try {
      await postar(rota, id, {
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: "Post do Dia do Vidraceiro." },
          { type: "data-referencias", data: { marcadas: [a, b], coladas: [colada] } },
        ],
      });
      await postar(rota, id, doUsuario("u2", "Feed."));
      const primeira = guardar(await postDaConversa(id));
      await postar(rota, id, doUsuario("u3", "Gera de novo."));
      const segunda = guardar(await postDaConversa(id));

      const ancoras = (p: EtapaPost | null) => (p?.etapa === "artes" ? p.artes.map((x) => ("foto" in x ? null : x.ancora)) : null);
      expect(pedidas).toEqual([{ marcadas: [a, b], coladas: [colada] }, undefined]);
      expect(ancoras(primeira)).toEqual([
        { origem: "biblioteca", id: a, arquivo: `${a}.png`, leitura: `leitura ${a}` },
        { origem: "biblioteca", id: b, arquivo: `${b}.png`, leitura: `leitura ${b}` },
        { origem: "pedido", arquivo: colada },
      ]);
      expect(ancoras(segunda)).toEqual([null, null, null]);
      const mostradas = (await mensagensDaConversa(id)).flatMap((m) => m.parts).find((p) => p.type === "tool-mostrar_artes");
      expect(mostradas).toMatchObject({ output: { artes: ancoras(primeira)!.map((ancora) => ({ ancora })) } });
    } finally {
      rede.restaurar();
      for (const path of geradas) rmSync(path, { force: true });
    }
  });

  test("uma escolha com formato errado é recusada antes do turno", async () => {
    const rota = rotaDeChat({ resolverModelo: () => new MockLanguageModelV4({ doStream: async () => responde("Ok.") }) });
    const res = await pedir(rota, `escolha-${crypto.randomUUID()}`, {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Oi" }, { type: "data-referencias", data: { marcadas: [], coladas: ["../../etc/passwd"] } }],
    });
    expect(res.status).toBe(400);
  });
});

describe("conversa direta com um especialista", () => {
  test("a conversa fica com a Legenda e o modelo dela não recebe as tools de publicar", async () => {
    const modelo = new MockLanguageModelV4({ doStream: async () => responde("Revisei.") });
    const id = `direta-${crypto.randomUUID()}`;

    await (await pedir(rotaDeChat({ resolverModelo: () => modelo }), id, doUsuario("u1", "Revise esta legenda."), "legenda")).text();

    const tools = modelo.doStreamCalls[0]?.tools?.map((t) => t.name);
    expect((await conversaDoUsuario(usuario.id, id))?.botId).toBe("legenda");
    expect(tools).toContain("redigir_legenda");
    expect(tools).not.toContain("publicar_agora");
    expect(tools).not.toContain("agendar_publicacao");
    expect(await textos(id)).toEqual([
      ["user", "Revise esta legenda."],
      ["assistant", "Revisei."],
    ]);
  });
});

/** Uma OpenAI falsa que responde o que o caso pedir. retry-after-ms: 0 faz as novas tentativas do SDK saírem na hora. */
let resposta = { status: 200, corpo: {} as unknown };
const servidor = Bun.serve({
  port: 0,
  fetch: () => Response.json(resposta.corpo, { status: resposta.status, headers: { "retry-after-ms": "0" } }),
});
const chaveDaOpenAI = process.env.OPENAI_API_KEY;
afterAll(() => {
  servidor.stop(true);
  if (chaveDaOpenAI !== undefined) process.env.OPENAI_API_KEY = chaveDaOpenAI;
});

const erroDaOpenAI = (type: string, code: string | null, message: string) => ({ error: { message, type, param: null, code } });

describe("erro do provedor", () => {
  const casos: { nome: string; status?: number; corpo?: unknown; modelo?: () => LanguageModel; espera: string; original: string }[] = [
    {
      nome: "cota esgotada",
      status: 429,
      corpo: erroDaOpenAI("insufficient_quota", "insufficient_quota", "You exceeded your current quota, please check your plan and billing details."),
      espera: "limite de uso",
      original: "You exceeded your current quota",
    },
    {
      nome: "chave inválida",
      status: 401,
      corpo: erroDaOpenAI("invalid_request_error", "invalid_api_key", "Incorrect API key provided: chave."),
      espera: "chave do modelo",
      original: "Incorrect API key provided",
    },
    {
      nome: "modelo sobrecarregado",
      status: 503,
      corpo: erroDaOpenAI("server_error", null, "The model is overloaded. Please try again later."),
      espera: "sobrecarregado",
      original: "The model is overloaded",
    },
    {
      // O que o @ai-sdk/openai lança com a porta fechada, sem as novas tentativas com espera de 2 s e 4 s.
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
        delete process.env.OPENAI_API_KEY;
        return createOpenAI({ apiKey: undefined })("gpt-6-luna");
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
    const daOpenAI = () => createOpenAI({ apiKey: "chave", baseURL: `${servidor.url}v1` })("gpt-6-luna");
    const log = spyOn(console, "error").mockImplementation(() => {});
    const id = `erro-${crypto.randomUUID()}`;

    const chunks = await postar(rotaDeChat({ resolverModelo: modelo ?? daOpenAI }), id, {
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
