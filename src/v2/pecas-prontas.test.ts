import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isToolUIPart, simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import sharp from "sharp";
import { abrirConversaDoUsuario, mensagensDaConversa } from "../agent/conversas";
import { primeira } from "../db";
import { rotaDeChat } from "../server/chat";
import { criarApi } from "./api";
import { arquivosNoDisco } from "./arquivos";
import { banco, q } from "./banco";
import type { Ia } from "./ia";
import { editarLegendaDaPeca, legendaDaPeca, receberPecaPronta } from "./pecas-prontas";
import { referenciasParaGerar } from "./referencias";
import { pecasProntas, referencias } from "./schema";

const ana = { id: "u-ana-pecas", email: "ana@emvidros.com.br", nome: "Ana", admin: false };

const LEITURA = { texto: "Café da manhã\ncom vidraceiros\n28 de novembro, 7h", tema: "convite para o café da manhã com vidraceiros", pilar: "GENTE" as const };

let pecasLidas = 0;
const iaFalsa = {
  lerReferencia: async () => ({ leitura: "Fonte bold, fundo verde chapado.", pilares: ["MARCA" as const] }),
  lerPecaPronta: async () => (pecasLidas++, LEITURA),
} as unknown as Ia;

const imagem = (largura: number, altura: number) =>
  sharp({ create: { width: largura, height: altura, channels: 4, background: "#2F646A" } })
    .png()
    .toBuffer();

let api: ReturnType<typeof criarApi>;
let arquivos: ReturnType<typeof arquivosNoDisco>;

beforeEach(async () => {
  pecasLidas = 0;
  await banco().delete(pecasProntas);
  await banco().delete(referencias);
  arquivos = arquivosNoDisco(mkdtempSync(join(tmpdir(), "em-pecas-")));
  api = criarApi({ banco: banco(), ia: iaFalsa, arquivos }, async () => ana);
});

const pedir = (caminho: string, init: RequestInit = {}) => api.request(`http://localhost${caminho}`, init);

async function subir(caminho: string, bytes: Uint8Array) {
  const form = new FormData();
  form.set("arquivo", new File([new Uint8Array(bytes)], "peca.png", { type: "image/png" }));
  return pedir(caminho, { method: "POST", body: form });
}

describe("catálogo da peça pronta", () => {
  test("a peça subida chega com a leitura da IA, o formato pela proporção e o JPEG que sai no Instagram", async () => {
    const r = await subir("/api/pecas-prontas", await imagem(1080, 1350));

    expect(r.status).toBe(201);
    const peca = await r.json();
    expect(peca).toMatchObject({ ...LEITURA, formato: "feed", legenda: null, criadaPor: ana.id });
    expect(peca.arquivo).toEndWith(".jpg");
    expect(pecasLidas).toBe(1);
    expect((await (await pedir("/api/pecas-prontas")).json()).map((p: { id: string }) => p.id)).toEqual([peca.id]);
  });

  test("a story vira story, e uma proporção que o Instagram recusa volta com o motivo sem gastar leitura", async () => {
    const story = await subir("/api/pecas-prontas", await imagem(1080, 1920));
    const larga = await subir("/api/pecas-prontas", await imagem(1200, 500));

    expect((await story.json()).formato).toBe("story");
    expect(larga.status).toBe(400);
    expect((await larga.json()).erro).toContain("1200×500");
    expect(pecasLidas).toBe(1);
  });

  test("remover tira da lista e restaurar traz de volta", async () => {
    const { id } = await (await subir("/api/pecas-prontas", await imagem(1080, 1080))).json();

    expect((await pedir(`/api/pecas-prontas/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await (await pedir("/api/pecas-prontas")).json()).toEqual([]);
    expect((await pedir(`/api/pecas-prontas/${id}/restaurar`, { method: "POST" })).status).toBe(200);
    expect((await (await pedir("/api/pecas-prontas")).json()).map((p: { id: string }) => p.id)).toEqual([id]);
  });

  // Pega a peça que some da Biblioteca e ainda sai no Instagram na hora marcada.
  test("a peça agendada não sai da Biblioteca até o agendamento ser cancelado", async () => {
    const { agendarPecaPronta } = await import("../agent/fila");
    const { id } = await (await subir("/api/pecas-prontas", await imagem(1080, 1350))).json();
    expect(await agendarPecaPronta(banco(), id, "IMAGE", Date.now() + 86_400_000)).toMatchObject({ ok: true });

    const recusada = await pedir(`/api/pecas-prontas/${id}`, { method: "DELETE" });
    expect(recusada.status).toBe(409);
    expect((await recusada.json()).erro).toContain("Cancele o agendamento");

    await q`UPDATE queue SET status = 'cancelled' WHERE peca_id = ${id}`;
    expect((await pedir(`/api/pecas-prontas/${id}`, { method: "DELETE" })).status).toBe(204);
  });
});

describe("peça pronta e referência não se misturam", () => {
  test("a peça pronta fica fora das referências da Biblioteca, do seletor do chat e da geração", async () => {
    const peca = await (await subir("/api/pecas-prontas", await imagem(1080, 1350))).json();
    const referencia = await (await subir("/api/referencias", await imagem(1080, 1350))).json();

    const daBiblioteca = (await (await pedir("/api/referencias")).json()) as { id: string; arquivo: string }[];
    const naGeracao = await referenciasParaGerar({ banco: banco(), arquivos }, { pilar: "GENTE", n: 10 });

    expect(daBiblioteca.map((r) => r.id)).toEqual([referencia.id]);
    expect(daBiblioteca.map((r) => r.arquivo)).not.toContain(peca.arquivo);
    expect(naGeracao.map((r) => r.arquivo)).toEqual([referencia.arquivo]);
    expect((await (await pedir("/api/pecas-prontas")).json()).map((p: { id: string }) => p.id)).toEqual([peca.id]);
  });
});

/** O corpo que a API de Responses da OpenAI devolve, com a legenda no texto. */
const respostaDaOpenAI = (texto: string) =>
  Response.json({
    id: `resp_${crypto.randomUUID()}`,
    object: "response",
    status: "completed",
    model: "gpt-6-luna",
    output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: texto, annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
  });

const LEGENDA = "Café com quem faz o vidro chegar.\n\nDia 28, às 7h, na fábrica.\nVem conhecer a equipe.\n\nConfirme pelo direct.\n\n#EMVidros #Vidraceiro";

describe("legenda da peça pronta", () => {
  const chave = process.env.OPENAI_API_KEY;
  let pedidos: { url: string; corpo: { instructions?: string; input?: unknown } }[] = [];

  beforeEach(() => {
    process.env.OPENAI_API_KEY ||= "sk-teste-falsa";
    pedidos = [];
    // Só a chamada de legenda responde; o feed do Instagram dos exemplos falha e fica de fora.
    spyOn(globalThis, "fetch").mockImplementation((async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada instanceof Request ? entrada.url : entrada);
      if (!url.endsWith("/responses")) return new Response("{}", { status: 404 });
      pedidos.push({ url, corpo: JSON.parse(String(init?.body)) });
      return respostaDaOpenAI(LEGENDA);
    }) as typeof fetch);
  });

  afterEach(() => {
    (globalThis.fetch as unknown as { mockRestore(): void }).mockRestore();
    if (chave === undefined) delete process.env.OPENAI_API_KEY;
  });

  test("sai do gerador de legenda dos posts, com o brandbook, o tema, o pilar e o texto pintado", async () => {
    const r = await receberPecaPronta({ banco: banco(), ia: iaFalsa }, { bytes: await imagem(1080, 1350), criadaPor: ana.id });
    if (!r.ok) throw new Error(r.motivo);

    const escrita = await legendaDaPeca(banco(), r.peca.id);

    expect(escrita).toMatchObject({ ok: true, peca: { legenda: LEGENDA } });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.corpo.instructions).toContain("O brandbook abaixo é normativo");
    expect(String(pedidos[0]!.corpo.input)).toContain(LEITURA.tema);
    expect(String(pedidos[0]!.corpo.input)).toContain("Pilar: GENTE");
    expect(String(pedidos[0]!.corpo.input)).toContain("Café da manhã / com vidraceiros");
  });

  test("a peça que já tem legenda fica com ela, e a story não leva legenda", async () => {
    const feed = await receberPecaPronta({ banco: banco(), ia: iaFalsa }, { bytes: await imagem(1080, 1350), criadaPor: ana.id });
    const story = await receberPecaPronta({ banco: banco(), ia: iaFalsa }, { bytes: await imagem(1080, 1920), criadaPor: ana.id });
    if (!feed.ok || !story.ok) throw new Error("as peças não subiram");
    await editarLegendaDaPeca(banco(), feed.peca.id, "Legenda revisada.");

    expect(await legendaDaPeca(banco(), feed.peca.id)).toMatchObject({ ok: true, peca: { legenda: "Legenda revisada." } });
    expect(await legendaDaPeca(banco(), story.peca.id)).toMatchObject({ ok: false });
    expect(pedidos).toHaveLength(0);
  });
});

type Chunk = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer C> ? C : never;
const uso = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const turno = (chunks: Chunk[], unified: "stop" | "tool-calls") => ({
  stream: simulateReadableStream<Chunk>({ chunks: [...chunks, { type: "finish", finishReason: { unified, raw: undefined }, usage: uso }] }),
});
const chamada = (id: string, toolName: string, input: unknown) => turno([{ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) }], "tool-calls");
const texto = (t: string) => turno([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: t }, { type: "text-end", id: "t" }], "stop");

describe("o Chefe agenda a peça pronta", () => {
  test("acha a peça pela leitura, pede aprovação e só agenda depois, com a legenda revisada no cartão", async () => {
    const r = await receberPecaPronta({ banco: banco(), ia: iaFalsa }, { bytes: await imagem(1080, 1350), criadaPor: ana.id });
    if (!r.ok) throw new Error(r.motivo);
    const peca = r.peca;
    await editarLegendaDaPeca(banco(), peca.id, "Legenda escrita pelo gerador.");
    const agendar = { publish_at: "2099-11-27T09:00:00-03:00", media_type: "IMAGE", peca_pronta_id: peca.id };
    const passos = [chamada("listar-1", "listar_pecas_prontas", {}), chamada("agendar-1", "agendar_publicacao", agendar), texto("Agendado.")];
    const chefe = new MockLanguageModelV4({ doStream: async () => passos.shift() ?? texto("Ok.") });
    const rota = rotaDeChat({ resolverModelo: () => chefe, segredoAprovacao: "segredo" });
    const conversaId = `peca-${crypto.randomUUID()}`;
    await abrirConversaDoUsuario(ana.id, conversaId, "chefe", "Peça pronta");
    const postar = async (ultima: UIMessage) =>
      (await rota(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ id: conversaId, botId: "chefe", messages: [ultima] }) }), ana)).text();
    const naFila = () => q<{ legenda: string | null; jpeg_path: string }>`SELECT legenda, jpeg_path FROM queue WHERE peca_id = ${peca.id}`;

    await postar({ id: "u1", role: "user", parts: [{ type: "text", text: "Agenda aquela peça do café da manhã para sexta às 9h." }] });

    expect(JSON.stringify(chefe.doStreamCalls[1]?.prompt)).toContain(LEITURA.tema);
    expect(await naFila()).toEqual([]);
    const pedido = (await mensagensDaConversa(conversaId)).flatMap((m) => m.parts).find((p) => isToolUIPart(p) && p.toolCallId === "agendar-1");
    expect(pedido).toMatchObject({ state: "approval-requested" });

    await editarLegendaDaPeca(banco(), peca.id, "Legenda que a pessoa revisou no cartão.");
    const ultima = (await mensagensDaConversa(conversaId)).findLast((m) => m.role === "assistant")!;
    await postar({
      ...ultima,
      parts: ultima.parts.map((p) =>
        isToolUIPart(p) && p.state === "approval-requested" ? { ...p, state: "approval-responded", approval: { ...p.approval, approved: true } } : p,
      ) as UIMessage["parts"],
    });

    expect(await naFila()).toEqual([{ legenda: "Legenda que a pessoa revisou no cartão.", jpeg_path: peca.arquivo }]);
    expect(await primeira(q<{ status: string }>`SELECT status FROM queue WHERE peca_id = ${peca.id}`)).toEqual({ status: "pending" });
  });

  test("a fila recusa a peça na mídia errada e a removida", async () => {
    const { agendarPecaPronta } = await import("../agent/fila");
    const r = await receberPecaPronta({ banco: banco(), ia: iaFalsa }, { bytes: await imagem(1080, 1920), criadaPor: ana.id });
    if (!r.ok) throw new Error(r.motivo);
    const amanha = Date.now() + 86_400_000;

    expect(await agendarPecaPronta(banco(), r.peca.id, "IMAGE", amanha)).toMatchObject({ ok: false, status: 409, motivo: expect.stringContaining("stories") });
    await banco().delete(pecasProntas);
    expect(await agendarPecaPronta(banco(), r.peca.id, "STORIES", amanha)).toMatchObject({ ok: false, status: 404 });
  });
});
