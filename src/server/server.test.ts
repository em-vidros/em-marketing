import { afterAll, describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { abrirConversaDoUsuario } from "../agent/conversas";
import { db, type Agendamento, type Agora, type Historico, type Peca } from "../db";
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

function semearPost(headline: string, status = "chosen"): number {
  const r = db
    .query(
      `INSERT INTO posts (brief, pilar, formato, headline, legenda, arts, chosen, status) VALUES (?, 'PROVA', 'feed', ?, 'Legenda.', ?, 2, ?) RETURNING id`,
    )
    .get(JSON.stringify({ tema: "box de banheiro" }), headline, ARTES, status) as { id: number };
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
