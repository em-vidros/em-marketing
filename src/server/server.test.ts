import { afterAll, describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { ConfigBot, DetalheBot, VersaoBot } from "../agent/config";
import type { UIMessage } from "ai";
import { abrirConversaDoUsuario, gravarMensagens, mensagensDaConversa, type Conversa } from "../agent/conversas";
import type { Modelo } from "../agent/models";
import { tarefasDaConversa, type TrabalhoDoBot } from "../agent/tarefas";
import { db, newMediaId, type Agendamento, type Agora, type Historico, type Peca } from "../db";
import { rotas } from "./rotas";

/** Modelo que falha o teste se for chamado: nenhuma destas rotas deve chegar ao bot. */
const semModelo = new MockLanguageModelV4({
  doStream: async () => {
    throw new Error("o modelo não deveria rodar");
  },
});

const server = Bun.serve({ port: 0, routes: rotas({ resolverModelo: () => semModelo }) });
afterAll(() => server.stop(true));

const ORIGEM = process.env.BETTER_AUTH_URL!;
const url = (caminho: string) => new URL(caminho, server.url);

async function cadastrar(email: string) {
  return fetch(url("/api/auth/sign-up/email"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGEM },
    body: JSON.stringify({ email, password: "senha-longa-123", name: email.split("@")[0] }),
  });
}

async function entrar(email: string): Promise<string> {
  const res = await cadastrar(email);
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const pedidoDeChat = (id: string) =>
  JSON.stringify({ id, botId: "chefe", trigger: "submit-message", messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Oi" }] }] });

describe("servidor", () => {
  test("cadastro com e-mail fora de ALLOWED_EMAILS é recusado e não cria usuário", async () => {
    const res = await cadastrar("intruso@gmail.com");

    expect(res.status).toBe(403);
    expect(db.query("SELECT 1 FROM user WHERE email = ?").get("intruso@gmail.com")).toBeNull();
  });

  test("POST /api/chat sem sessão devolve 401", async () => {
    const res = await fetch(url("/api/chat"), { method: "POST", headers: { "content-type": "application/json" }, body: pedidoDeChat("c-anon") });

    expect(res.status).toBe(401);
  });

  test("um usuário não lê nem continua a conversa de outro", async () => {
    await entrar("ana@emvidros.com.br");
    const deBia = await entrar("bia@emvidros.com.br");
    const ana = db.query("SELECT id FROM user WHERE email = ?").get("ana@emvidros.com.br") as { id: string };
    abrirConversaDoUsuario(ana.id, "conversa-da-ana", "chefe", "Post do Dia do Vidraceiro");

    const leitura = await fetch(url("/api/conversas/conversa-da-ana"), { headers: { cookie: deBia } });
    const chat = await fetch(url("/api/chat"), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deBia },
      body: pedidoDeChat("conversa-da-ana"),
    });

    expect([leitura.status, chat.status]).toEqual([404, 404]);
    const dono = db.query("SELECT user_id, mensagens FROM conversas WHERE id = ?").get("conversa-da-ana");
    expect(dono).toEqual({ user_id: ana.id, mensagens: "[]" });
  });
});

/** Entra com a conta, cadastrando se ainda não existe. Devolve o cookie e o id do usuário. */
async function sessao(email: string) {
  const login = await fetch(url("/api/auth/sign-in/email"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGEM },
    body: JSON.stringify({ email, password: "senha-longa-123" }),
  });
  const res = login.ok ? login : await cadastrar(email);
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { id } = db.query("SELECT id FROM user WHERE email = ?").get(email) as { id: string };
  return { cookie, id };
}

const ARTES = JSON.stringify([
  { variant: 1, style: "a", path: "/tmp/arte-v1.jpg", interactionId: "i1" },
  { variant: 2, style: "b", path: "/tmp/arte-v2.jpg", interactionId: "i2" },
]);

/** headline vai como agent/post.ts grava: o JSON {headline, apoio}. */
function semearPost(headline: string, status = "chosen"): number {
  const r = db
    .query(
      `INSERT INTO posts (brief, pilar, formato, headline, legenda, arts, chosen, status) VALUES (?, 'PROVA', 'feed', ?, 'Legenda.', ?, 2, ?) RETURNING id`,
    )
    .get(JSON.stringify({ tema: "box de banheiro" }), JSON.stringify({ headline, apoio: "" }), ARTES, status) as { id: number };
  return r.id;
}

function semearTarefa(id: string, conversaId: string, status: string, atualizadaEm: number, mensagens: unknown[] = []) {
  db.query(
    `INSERT INTO tarefas (id, conversa_id, bot_id, pedido, status, mensagens, resumo, erro, criada_em, atualizada_em)
     VALUES (?, ?, 'post', 'Gerar as artes', ?, ?, ?, NULL, ?, ?)`,
  ).run(id, conversaId, status, JSON.stringify(mensagens), status === "concluida" ? "Pronto." : null, atualizadaEm - 60_000, atualizadaEm);
}

const semSessao = (caminho: string) => fetch(url(caminho)).then((r) => r.status);
const comCookie = <T>(caminho: string, cookie: string) => fetch(url(caminho), { headers: { cookie } }).then((r) => r.json() as Promise<T>);

describe("leituras de Atividade e Biblioteca", () => {
  test("GET /api/atividade/agora separa em curso, aprovações pendentes e o que terminou hoje", async () => {
    const { cookie, id } = await sessao("ana@emvidros.com.br");
    const postId = semearPost("Box pronto hoje");
    const pedidoDeAprovacao = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "tool-agendar_publicacao", toolCallId: "c1", state: "approval-requested", input: { publish_at: "2026-10-16T18:00:00-03:00", media_type: "IMAGE" } },
        { type: "tool-publicar_agora", toolCallId: "c2", state: "output-denied", input: { media_type: "IMAGE" } },
      ],
    };
    db.query("INSERT INTO conversas (id, bot_id, user_id, titulo, post_id, mensagens) VALUES ('agora-1', 'chefe', ?, 'Box', ?, ?)").run(
      id,
      postId,
      JSON.stringify([pedidoDeAprovacao]),
    );
    const passo = { id: "e1", role: "assistant", parts: [{ type: "tool-gerar_3_artes", toolCallId: "t1", state: "input-available", input: {} }] };
    semearTarefa("agora-trabalhando", "agora-1", "trabalhando", Date.now(), [passo]);
    semearTarefa("agora-hoje", "agora-1", "concluida", Date.now());
    semearTarefa("agora-ontem", "agora-1", "concluida", Date.now() - 2 * 86_400_000);

    const corpo = await comCookie<Agora>("/api/atividade/agora", cookie);

    expect(await semSessao("/api/atividade/agora")).toBe(401);
    expect(corpo.trabalhando.map((t) => [t.id, t.ultima?.id])).toEqual([["agora-trabalhando", "e1"]]);
    expect(corpo.esperando).toEqual([
      {
        conversaId: "agora-1",
        titulo: "Box",
        acao: "agendar_publicacao",
        tipo: "IMAGE",
        publicarEm: "2026-10-16T18:00:00-03:00",
        headline: "Box pronto hoje",
        pilar: "PROVA",
        capa: expect.stringMatching(/^\/media\/[0-9a-f]{32}$/),
      },
    ]);
    expect(corpo.concluidas.map((t) => t.id)).toEqual(["agora-hoje"]);
  });

  test("GET /api/atividade/agendado lista a fila pendente com horário ISO em UTC", async () => {
    const { cookie } = await sessao("ana@emvidros.com.br");
    const postId = semearPost("Espelho bisotado", "scheduled");
    db.query("INSERT INTO queue (post_id, media_type, publish_at, status) VALUES (?, 'IMAGE', '2026-10-16 21:00:00', 'pending')").run(postId);
    db.query("INSERT INTO queue (post_id, media_type, publish_at, status) VALUES (?, 'STORIES', '2026-10-17 21:00:00', 'done')").run(postId);

    const corpo = await comCookie<Agendamento[]>("/api/atividade/agendado", cookie);

    expect(await semSessao("/api/atividade/agendado")).toBe(401);
    expect(corpo.filter((a) => a.postId === postId).map(({ id, capa, ...resto }) => resto)).toEqual([
      { postId, headline: "Espelho bisotado", pilar: "PROVA", tipo: "IMAGE", publicarEm: "2026-10-16T21:00:00Z", status: "pending", erro: null },
    ]);
  });

  test("GET /api/atividade/historico traz tarefas de antes de hoje e as publicações", async () => {
    const { cookie, id } = await sessao("bia@emvidros.com.br");
    const postId = semearPost("Dia do Vidraceiro", "published");
    db.query("INSERT INTO conversas (id, bot_id, user_id, titulo) VALUES ('hist-1', 'chefe', ?, 'Antiga')").run(id);
    semearTarefa("hist-ontem", "hist-1", "concluida", Date.now() - 2 * 86_400_000);
    semearTarefa("hist-hoje", "hist-1", "concluida", Date.now());
    db.query("INSERT INTO publicacoes (post_id, media_type, ig_media_id, permalink) VALUES (?, 'IMAGE', 'ig-hist', 'https://instagram.com/p/x')").run(postId);

    const corpo = await comCookie<Historico>("/api/atividade/historico", cookie);

    expect(await semSessao("/api/atividade/historico")).toBe(401);
    expect(corpo.tarefas.map((t) => t.id)).toEqual(["hist-ontem"]);
    expect(corpo.publicacoes.find((p) => p.postId === postId)).toMatchObject({ headline: "Dia do Vidraceiro", tipo: "IMAGE", permalink: "https://instagram.com/p/x" });
  });

  test("GET /api/pecas põe a arte escolhida primeiro, reaproveita o id de mídia e só liga a conversa do dono", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const bia = await sessao("bia@emvidros.com.br");
    const postId = semearPost("Quem corta o seu vidro");
    db.query("INSERT INTO conversas (id, bot_id, user_id, titulo, post_id) VALUES ('peca-da-ana', 'post', ?, 'Gente', ?)").run(ana.id, postId);

    const daAna = (await comCookie<Peca[]>("/api/pecas", ana.cookie)).find((p) => p.id === postId);
    const daBia = (await comCookie<Peca[]>("/api/pecas", bia.cookie)).find((p) => p.id === postId);
    const caminhos = (artes: string[]) =>
      artes.map((a) => (db.query("SELECT path FROM media WHERE id = ?").get(a.slice("/media/".length)) as { path: string }).path);

    expect(await semSessao("/api/pecas")).toBe(401);
    expect(daAna).toMatchObject({ headline: "Quem corta o seu vidro", tema: "box de banheiro", pilar: "PROVA", status: "chosen", conversaId: "peca-da-ana" });
    expect(caminhos(daAna!.artes)).toEqual(["/tmp/arte-v2.jpg", "/tmp/arte-v1.jpg"]);
    expect(daBia?.artes).toEqual(daAna!.artes);
    expect(daBia?.conversaId).toBeNull();
  });
});

const enviar = (caminho: string, cookie: string, method: string, corpo?: unknown) =>
  fetch(url(caminho), {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

describe("config dos bots", () => {
  afterAll(() => db.run("DELETE FROM versoes_bot"));

  test("a edição vale na leitura seguinte, cada gravação vira versão, e restaurar grava de novo o texto antigo", async () => {
    const { cookie } = await sessao("ana@emvidros.com.br");
    const { cookie: daBia } = await sessao("bia@emvidros.com.br");
    const padrao = await comCookie<DetalheBot>("/api/bots/agenda/config", cookie);

    const primeira = await (await enviar("/api/bots/agenda/config", cookie, "PUT", { nome: "Calendário", prompt: "Você cuida do calendário." })).json() as DetalheBot;
    await enviar("/api/bots/agenda/config", daBia, "PUT", { prompt: "Você cuida da fila." });
    await enviar("/api/bots/agenda/config", daBia, "PUT", { prompt: "Você cuida da fila." });
    const versoes = await comCookie<VersaoBot[]>("/api/bots/agenda/versoes", cookie);
    const restaurada = await (await enviar(`/api/bots/agenda/versoes/${primeira.versaoId}/restaurar`, daBia, "POST")).json() as DetalheBot;
    const lista = await comCookie<ConfigBot[]>("/api/bots", cookie);
    const voltaAoPadrao = await (await enviar("/api/bots/agenda/padrao", cookie, "POST")).json() as DetalheBot;

    expect(padrao).toMatchObject({ nome: "Agenda", versaoId: null, padrao: { nome: true, descricao: true, modelo: true, prompt: true } });
    expect(padrao.fixo).toContain("--- BRANDBOOK");
    expect(primeira).toMatchObject({ nome: "Calendário", prompt: "Você cuida do calendário.", descricao: padrao.descricao, padrao: { nome: false, prompt: false, descricao: true } });
    expect(versoes.map((v) => [v.prompt, v.autor])).toEqual([
      ["Você cuida da fila.", "bia@emvidros.com.br"],
      ["Você cuida do calendário.", "ana@emvidros.com.br"],
    ]);
    expect(restaurada).toMatchObject({ nome: "Calendário", prompt: "Você cuida do calendário." });
    expect(restaurada.versaoId).toBeGreaterThan(versoes[0]!.id);
    expect(lista.find((b) => b.id === "agenda")).toMatchObject({ nome: "Calendário", versaoId: restaurada.versaoId });
    expect(voltaAoPadrao).toMatchObject({ nome: padrao.nome, prompt: padrao.prompt, padrao: { nome: true, descricao: true, modelo: true, prompt: true } });
    expect(voltaAoPadrao.versaoId).toBeGreaterThan(restaurada.versaoId!);
  });

  test("modelo desconhecido ou sem chave no servidor é recusado em português e não grava versão", async () => {
    const { cookie } = await sessao("ana@emvidros.com.br");
    const chave = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const desconhecido = await enviar("/api/bots/fotos/config", cookie, "PUT", { modelo: "openai:gpt-9" });
      const semChave = await enviar("/api/bots/fotos/config", cookie, "PUT", { modelo: "anthropic:claude-opus-5-5" });
      const disponiveis = await comCookie<Modelo[]>("/api/modelos", cookie);

      expect([desconhecido.status, await desconhecido.json()]).toEqual([400, { erro: "Modelo desconhecido: openai:gpt-9." }]);
      expect([semChave.status, await semChave.json()]).toEqual([400, { erro: "O Claude Opus 5.5 não está disponível: falta a chave ANTHROPIC_API_KEY no servidor." }]);
      expect(disponiveis.find((m) => m.id === "anthropic:claude-opus-5-5")?.disponivel).toBe(false);
      expect(await comCookie<VersaoBot[]>("/api/bots/fotos/versoes", cookie)).toEqual([]);
    } finally {
      if (chave !== undefined) process.env.ANTHROPIC_API_KEY = chave;
    }
  });
});

describe("gestão de conversas", () => {
  test("renomear, arquivar, apagar e restaurar valem só para o dono e repetir não muda o resultado", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const bia = await sessao("bia@emvidros.com.br");
    const id = `gestao-${crypto.randomUUID()}`;
    abrirConversaDoUsuario(ana.id, id, "chefe", "Conversa nova");
    const ids = (lista: Conversa[]) => lista.map((c) => c.id).filter((x) => x === id);

    const pelaBia = await Promise.all([
      enviar(`/api/conversas/${id}`, bia.cookie, "PATCH", { titulo: "Invadida" }),
      enviar(`/api/conversas/${id}`, bia.cookie, "DELETE"),
      enviar(`/api/conversas/${id}/restaurar`, bia.cookie, "POST"),
    ]);
    const renomeada = (await (await enviar(`/api/conversas/${id}`, ana.cookie, "PATCH", { titulo: "Dia do Vidraceiro", arquivada: true })).json()) as Conversa;
    const arquivadaDeNovo = (await (await enviar(`/api/conversas/${id}`, ana.cookie, "PATCH", { arquivada: true })).json()) as Conversa;
    const naLista = ids(await comCookie<Conversa[]>("/api/conversas", ana.cookie));
    const nasArquivadas = ids(await comCookie<Conversa[]>("/api/conversas?arquivadas=1", ana.cookie));
    const apagar = [await enviar(`/api/conversas/${id}`, ana.cookie, "DELETE"), await enviar(`/api/conversas/${id}`, ana.cookie, "DELETE")];
    const depoisDeApagar = [
      (await fetch(url(`/api/conversas/${id}`), { headers: { cookie: ana.cookie } })).status,
      (await enviar(`/api/conversas/${id}`, ana.cookie, "PATCH", { arquivada: false })).status,
      ids(await comCookie<Conversa[]>("/api/conversas?arquivadas=1", ana.cookie)),
    ];
    const restaurada = (await (await enviar(`/api/conversas/${id}/restaurar`, ana.cookie, "POST")).json()) as Conversa;
    const desarquivada = (await (await enviar(`/api/conversas/${id}`, ana.cookie, "PATCH", { arquivada: false })).json()) as Conversa;

    expect(pelaBia.map((r) => r.status)).toEqual([404, 404, 404]);
    expect([renomeada.titulo, typeof renomeada.arquivadaEm]).toEqual(["Dia do Vidraceiro", "number"]);
    expect(arquivadaDeNovo.arquivadaEm).toBe(renomeada.arquivadaEm);
    expect([naLista, nasArquivadas]).toEqual([[], [id]]);
    expect(apagar.map((r) => r.status)).toEqual([204, 204]);
    expect(depoisDeApagar).toEqual([404, 404, []]);
    expect(restaurada).toMatchObject({ id, titulo: "Dia do Vidraceiro", arquivadaEm: renomeada.arquivadaEm });
    expect(desarquivada.arquivadaEm).toBeNull();
    expect(ids(await comCookie<Conversa[]>("/api/conversas", ana.cookie))).toEqual([id]);
  });

  test("POST /api/chat numa conversa apagada é recusado e não grava nada", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const id = `apagada-${crypto.randomUUID()}`;
    abrirConversaDoUsuario(ana.id, id, "chefe", "Vai ser apagada");
    await enviar(`/api/conversas/${id}`, ana.cookie, "DELETE");

    const res = await fetch(url("/api/chat"), { method: "POST", headers: { "content-type": "application/json", cookie: ana.cookie }, body: pedidoDeChat(id) });

    expect(res.status).toBe(404);
    expect(db.query("SELECT mensagens FROM conversas WHERE id = ?").get(id)).toEqual({ mensagens: "[]" });
  });

  test("GET /api/bots/:id/tarefas pagina as tarefas do especialista nas conversas vivas do usuário; o Chefe lista conversas", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const bia = await sessao("bia@emvidros.com.br");
    const viva = `bot-viva-${crypto.randomUUID()}`;
    const apagada = `bot-apagada-${crypto.randomUUID()}`;
    abrirConversaDoUsuario(ana.id, viva, "chefe", "Viva");
    abrirConversaDoUsuario(ana.id, apagada, "chefe", "Apagada");
    const base = Date.now() + 10_000_000;
    semearTarefa(`${viva}-1`, viva, "concluida", base + 1);
    semearTarefa(`${viva}-2`, viva, "falhou", base + 2);
    semearTarefa(`${viva}-3`, viva, "concluida", base + 3);
    semearTarefa(`${apagada}-1`, apagada, "concluida", base + 4);
    await enviar(`/api/conversas/${apagada}`, ana.cookie, "DELETE");

    const p1 = await comCookie<TrabalhoDoBot>("/api/bots/post/tarefas?limite=2", ana.cookie);
    const p2 = await comCookie<TrabalhoDoBot>(`/api/bots/post/tarefas?limite=1&offset=${p1.proximo}`, ana.cookie);
    const daBia = await comCookie<TrabalhoDoBot>("/api/bots/post/tarefas", bia.cookie);
    const doChefe = await comCookie<TrabalhoDoBot>("/api/bots/chefe/tarefas?limite=100", ana.cookie);

    if (p1.tipo !== "tarefas" || p2.tipo !== "tarefas" || daBia.tipo !== "tarefas") throw new Error("especialista lista tarefas");
    expect(p1.proximo).toBe(2);
    expect(p1.itens.map((t) => [t.id, t.status, t.conversaId])).toEqual([
      [`${viva}-3`, "concluida", viva],
      [`${viva}-2`, "falhou", viva],
    ]);
    expect(p2.itens.map((t) => t.id)).toEqual([`${viva}-1`]);
    expect(daBia.itens.map((t) => t.conversaId)).not.toContain(viva);
    expect(doChefe.tipo).toBe("conversas");
    expect(doChefe.itens.map((c) => c.id)).toContain(viva);
    expect(doChefe.itens.map((c) => c.id)).not.toContain(apagada);
    expect((await fetch(url("/api/bots/inexistente/tarefas"), { headers: { cookie: ana.cookie } })).status).toBe(404);
  });
});

const msg = (id: string, role: "user" | "assistant"): UIMessage => ({ id, role, parts: [{ type: "text", text: `texto de ${id}` }] });

/** Uma conversa da Ana com estas mensagens já salvas. */
async function conversaComMensagens(ids: string[]) {
  const ana = await sessao("ana@emvidros.com.br");
  const id = `mensagens-${crypto.randomUUID()}`;
  abrirConversaDoUsuario(ana.id, id, "chefe", "Turnos");
  gravarMensagens(id, ids.map((m) => msg(m, m.startsWith("u") ? "user" : "assistant")));
  return { id, cookie: ana.cookie, caminho: (resto: string) => `/api/conversas/${id}/mensagens/${resto}` };
}

const idsDe = (conversaId: string) => mensagensDaConversa(conversaId).map((m) => m.id);

describe("apagar e restaurar mensagens", () => {
  test("apagar a mensagem do usuário tira o turno inteiro e deixa as tarefas; a do bot sai sozinha", async () => {
    const { id, cookie, caminho } = await conversaComMensagens(["u1", "a1", "u2", "a2", "a3", "u3", "a4"]);
    const bia = await sessao("bia@emvidros.com.br");
    semearTarefa(`${id}-t`, id, "concluida", Date.now());

    const pelaBia = await enviar(caminho("u2"), bia.cookie, "DELETE");
    const turno = await enviar(caminho("u2"), cookie, "DELETE");
    const doBot = await enviar(caminho("a4"), cookie, "DELETE");
    const deNovo = await enviar(caminho("a4"), cookie, "DELETE");
    await enviar(`/api/conversas/${id}`, cookie, "DELETE");
    const naApagada = await enviar(caminho("u1"), cookie, "DELETE");

    expect(pelaBia.status).toBe(404);
    expect([turno.status, await turno.json()]).toEqual([200, { removidas: [msg("u2", "user"), msg("a2", "assistant"), msg("a3", "assistant")], depoisDe: "a1", antesDe: "u3" }]);
    expect([doBot.status, await doBot.json()]).toEqual([200, { removidas: [msg("a4", "assistant")], depoisDe: "u3", antesDe: null }]);
    expect([deNovo.status, naApagada.status]).toEqual([404, 404]);
    expect(idsDe(id)).toEqual(["u1", "a1", "u3"]);
    expect(tarefasDaConversa(id).map((t) => t.id)).toEqual([`${id}-t`]);
  });

  test("restaurar põe o turno de volta no lugar, repetir não duplica, e recusa se a conversa mudou depois dele", async () => {
    const { id, cookie, caminho } = await conversaComMensagens(["u1", "a1", "u2", "a2", "u3", "a3"]);
    const meio = await (await enviar(caminho("u2"), cookie, "DELETE")).json();

    const volta = await enviar(caminho("restaurar"), cookie, "POST", meio);
    const deNovo = await enviar(caminho("restaurar"), cookie, "POST", meio);
    const fim = await (await enviar(caminho("u3"), cookie, "DELETE")).json();
    gravarMensagens(id, [...mensagensDaConversa(id), msg("u4", "user")]);
    const tarde = await enviar(caminho("restaurar"), cookie, "POST", fim);

    const ordem = ["u1", "a1", "u2", "a2", "u3", "a3"];
    expect(volta.status).toBe(200);
    expect(((await volta.json()) as { mensagens: UIMessage[] }).mensagens.map((m) => m.id)).toEqual(ordem);
    expect(((await deNovo.json()) as { mensagens: UIMessage[] }).mensagens.map((m) => m.id)).toEqual(ordem);
    expect([tarde.status, await tarde.json()]).toEqual([409, { erro: "A conversa mudou depois dessas mensagens. Não dá para pôr de volta no mesmo lugar." }]);
    expect(idsDe(id)).toEqual(["u1", "a1", "u2", "a2", "u4"]);
  });
});

test("GET /media/:id de um arquivo que sumiu do disco devolve 404, não 500", async () => {
  const id = newMediaId("/tmp/em-marketing-arte-que-nao-existe.jpg");

  const res = await fetch(url(`/media/${id}`));

  expect([res.status, await res.json()]).toEqual([404, { erro: "Não encontrado." }]);
});
