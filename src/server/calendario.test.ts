import { afterAll, describe, expect, test } from "bun:test";
import type { ConversaDaPauta, ItemAgendado, ItemCalendario, ItemPauta } from "../agent/calendario";
import { conversaDoUsuario } from "../agent/conversas";
import type { PostPronto, Reagendado } from "../agent/fila";
import { abrirConversa, criarPost, gravarPost, transicionar, type EtapaPost, type Evento } from "../agent/post";
import { toolsDePost } from "../agent/tools/post";
import { db } from "../db";
import { rotas } from "./rotas";

const server = Bun.serve({ port: 0, routes: rotas() });
afterAll(() => server.stop(true));

const url = (caminho: string) => new URL(caminho, server.url);

async function sessao(email: string) {
  const corpo = { method: "POST", headers: { "content-type": "application/json", origin: process.env.BETTER_AUTH_URL! } };
  const login = await fetch(url("/api/auth/sign-in/email"), { ...corpo, body: JSON.stringify({ email, password: "senha-longa-123" }) });
  const res = login.ok ? login : await fetch(url("/api/auth/sign-up/email"), { ...corpo, body: JSON.stringify({ email, password: "senha-longa-123", name: email }) });
  expect(res.status).toBe(200);
  const { id } = db.query("SELECT id FROM user WHERE email = ?").get(email) as { id: string };
  return { id, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}

const pedir = (caminho: string, cookie: string, method = "GET", corpo?: unknown) =>
  fetch(url(caminho), { method, headers: { cookie, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

const calendario = (cookie: string, de: string, ate: string) => json<ItemCalendario[]>(pedir(`/api/calendario?de=${de}&ate=${ate}`, cookie));

const arte = { variant: 1, style: "tecnico-poppins", path: "/tmp/em-marketing-cal-v1.jpg", interactionId: "i1", problemas: [] };

/** Um post de feed numa conversa, levado pelos eventos dados. Sem eventos até o registro, não está pronto. */
function postNaEtapa(...eventos: Evento[]): { conversaId: string; postId: number } {
  const conversaId = `cal-${crypto.randomUUID()}`;
  abrirConversa(conversaId, "chefe");
  const post = eventos.reduce<EtapaPost>((p, e) => {
    const r = transicionar(p, e);
    if (!r.ok) throw new Error(r.motivo);
    return r.post;
  }, criarPost(conversaId, { pilar: "PROVA", tema: "box", precisaFotoReal: false }, "feed"));
  gravarPost(post);
  return { conversaId, postId: post.postId };
}

const ATE_ESCOLHER: Evento[] = [
  { tipo: "headline", headline: { headline: "Box entregue no Calhau.", apoio: "" } },
  { tipo: "artes", artes: [arte] },
  { tipo: "escolha", variante: 1 },
];
const PRONTO: Evento[] = [...ATE_ESCOLHER, { tipo: "legenda", legenda: "Legenda." }, { tipo: "registro", linearId: "EMV-9" }];

const AMANHA = Math.floor((Date.now() + 86_400_000) / 60_000) * 60_000;

describe("GET /api/calendario", () => {
  test("traz cada tipo com os dias de São Paulo: 23:30 do último dia entra, 00:30 do dia seguinte não", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const { postId } = postNaEtapa(...PRONTO);
    const fila = (publishAt: string, status = "pending") =>
      (db.query("INSERT INTO queue (post_id, media_type, publish_at, status) VALUES (?, 'IMAGE', ?, ?) RETURNING id").get(postId, publishAt, status) as { id: number }).id;
    const publicada = (publishedAt: string, ig: string) =>
      (db.query("INSERT INTO publicacoes (post_id, media_type, ig_media_id, permalink, published_at) VALUES (?, 'STORIES', ?, 'https://instagram.com/p/c', ?) RETURNING id").get(postId, ig, publishedAt) as { id: number }).id;
    const primeiroMinuto = fila("2031-05-01 03:00:00");
    fila("2031-05-01 02:59:00");
    const ultimoDia = fila("2031-06-01 02:30:00", "failed");
    fila("2031-06-01 03:30:00");
    fila("2031-05-10 15:00:00", "cancelled");
    fila("2031-05-10 16:00:00", "done");
    const publicacao = publicada("2031-06-01 02:30:00", `ig-${postId}-a`);
    publicada("2031-06-01 03:30:00", `ig-${postId}-b`);
    const pauta = await json<ItemPauta>(pedir("/api/pautas", ana.cookie, "POST", { dia: "2031-05-31", hora: "23:30", titulo: "Bastidor da fábrica" }));
    await pedir("/api/pautas", ana.cookie, "POST", { dia: "2031-06-01", titulo: "Fora da janela" });

    const itens = await calendario(ana.cookie, "2031-05-01", "2031-05-31");

    const doPost = { postId, headline: "Box entregue no Calhau.", pilar: "PROVA" as const, capa: expect.stringMatching(/^\/media\/[0-9a-f]{32}$/) };
    expect(itens).toEqual([
      { tipo: "data", dia: "2031-05-01", nome: "Início do Mês do Vidraceiro" },
      { tipo: "data", dia: "2031-05-18", nome: "Dia do Vidraceiro" },
      { tipo: "pauta", id: pauta.id, dia: "2031-05-31", hora: "23:30", titulo: "Bastidor da fábrica", pilar: null, nota: "", conversaId: null },
      { tipo: "agendado", filaId: primeiroMinuto, publicaEm: Date.parse("2031-05-01T00:00:00-03:00"), midia: "IMAGE", status: "pending", erro: null, ...doPost },
      { tipo: "agendado", filaId: ultimoDia, publicaEm: Date.parse("2031-05-31T23:30:00-03:00"), midia: "IMAGE", status: "failed", erro: null, ...doPost },
      { tipo: "publicado", publicacaoId: publicacao, publicadoEm: Date.parse("2031-05-31T23:30:00-03:00"), midia: "STORIES", link: "https://instagram.com/p/c", ...doPost },
    ]);
    expect((await pedir("/api/calendario?de=2031-05-01&ate=2031-07-02", ana.cookie)).status).toBe(400);
    expect(await json<{ erro: string }>(pedir("/api/calendario?de=2031-02-30&ate=2031-03-01", ana.cookie))).toEqual({ erro: "de não é uma data válida (AAAA-MM-DD)." });
  });
});

describe("pautas", () => {
  test("criar, mudar, apagar e restaurar; o calendário segue cada passo", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const naJanela = async () => (await calendario(ana.cookie, "2032-03-01", "2032-03-31")).filter((i) => i.tipo === "pauta");
    const criada = await pedir("/api/pautas", ana.cookie, "POST", { dia: "2032-03-10", hora: "09:00", titulo: "Norma do guarda-corpo", pilar: "AUTORIDADE" });
    const { id } = (await criada.json()) as ItemPauta;

    const mudada = await json<ItemPauta>(pedir(`/api/pautas/${id}`, ana.cookie, "PATCH", { dia: "2032-03-12", hora: null, nota: "NBR 14718" }));
    const horaRuim = await pedir(`/api/pautas/${id}`, ana.cookie, "PATCH", { hora: "25:00" });
    const apagar = await pedir(`/api/pautas/${id}`, ana.cookie, "DELETE");
    const depoisDeApagar = [await naJanela(), (await pedir(`/api/pautas/${id}`, ana.cookie, "PATCH", { titulo: "x" })).status];
    const restaurada = await json<ItemPauta>(pedir(`/api/pautas/${id}/restaurar`, ana.cookie, "POST"));

    expect(criada.status).toBe(201);
    expect(mudada).toEqual({ tipo: "pauta", id, dia: "2032-03-12", hora: null, titulo: "Norma do guarda-corpo", pilar: "AUTORIDADE", nota: "NBR 14718", conversaId: null });
    expect([horaRuim.status, await horaRuim.json()]).toEqual([400, { erro: "Hora inválida. Use HH:MM, de 00:00 a 23:59." }]);
    expect(apagar.status).toBe(204);
    expect(depoisDeApagar).toEqual([[], 404]);
    expect(restaurada).toEqual(mudada);
    expect(await naJanela()).toEqual([mudada]);
  });

  test("Criar com o Chefe devolve a mesma conversa ao repetir, e só o dono a vê ligada", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const bia = await sessao("bia@emvidros.com.br");
    const { id } = await json<ItemPauta>(
      pedir("/api/pautas", ana.cookie, "POST", { dia: "2032-04-15", hora: "18:00", titulo: "Obra entregue em Teresina", pilar: "PROVA", nota: "Foto do Jonas." }),
    );

    const primeira = await json<ConversaDaPauta>(pedir(`/api/pautas/${id}/conversa`, ana.cookie, "POST"));
    const segunda = await json<ConversaDaPauta>(pedir(`/api/pautas/${id}/conversa`, ana.cookie, "POST"));
    const pautaPara = async (cookie: string) => (await calendario(cookie, "2032-04-15", "2032-04-15")).find((i) => i.tipo === "pauta" && i.id === id);

    expect(segunda).toEqual(primeira);
    expect(primeira).toEqual({
      conversaId: expect.any(String),
      vazia: true,
      pedido:
        'Vamos criar o post da pauta "Obra entregue em Teresina", marcada no calendário para quinta-feira, 15 de abril de 2032, às 18:00.\nPilar: PROVA.\nNota da pauta: Foto do Jonas.\nMonte o brief comigo e me mostre antes de gerar.',
    });
    expect(conversaDoUsuario(ana.id, primeira.conversaId)).toMatchObject({ botId: "chefe", titulo: "Obra entregue em Teresina" });
    expect(await pautaPara(ana.cookie)).toMatchObject({ conversaId: primeira.conversaId });
    expect(await pautaPara(bia.cookie)).toMatchObject({ conversaId: null });
  });
});

describe("fila pelo calendário", () => {
  test("agendar passa pela mesma validação do agendar_publicacao: post sem registro, horário passado e duplicado são recusados", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const naoPronto = postNaEtapa(...ATE_ESCOLHER);
    const pronto = postNaEtapa(...PRONTO);
    const daTool = (await toolsDePost(naoPronto.conversaId).agendar_publicacao.execute!(
      { publish_at: new Date(AMANHA).toISOString(), media_type: "IMAGE" },
      { toolCallId: "t1", messages: [], context: {} },
    )) as { ok: false; motivo: string };
    const prontos = () => json<PostPronto[]>(pedir("/api/posts/prontos", ana.cookie));
    const antes = await prontos();

    const recusado = await pedir("/api/fila", ana.cookie, "POST", { postId: naoPronto.postId, midia: "IMAGE", publicaEm: AMANHA });
    const passado = await pedir("/api/fila", ana.cookie, "POST", { postId: pronto.postId, midia: "IMAGE", publicaEm: Date.now() - 60_000 });
    const soFeed = await pedir("/api/fila", ana.cookie, "POST", { postId: pronto.postId, midia: "STORIES", publicaEm: AMANHA });
    const agendado = await pedir("/api/fila", ana.cookie, "POST", { postId: pronto.postId, midia: "IMAGE", publicaEm: AMANHA });
    const duplicado = await pedir("/api/fila", ana.cookie, "POST", { postId: pronto.postId, midia: "IMAGE", publicaEm: AMANHA + 3_600_000 });

    expect(daTool.ok).toBe(false);
    expect([recusado.status, await recusado.json()]).toEqual([409, { erro: daTool.motivo }]);
    expect([passado.status, await passado.json()]).toEqual([400, { erro: "Esse horário já passou. Escolha um horário no futuro." }]);
    expect([soFeed.status, await soFeed.json()]).toEqual([409, { erro: "Este post é só feed; não há peça 9:16." }]);
    expect(antes.find((p) => p.postId === pronto.postId)).toMatchObject({ midias: ["IMAGE"], headline: "Box entregue no Calhau.", pilar: "PROVA" });
    expect(antes.map((p) => p.postId)).not.toContain(naoPronto.postId);
    expect(agendado.status).toBe(201);
    expect(await agendado.json()).toMatchObject({ tipo: "agendado", postId: pronto.postId, publicaEm: AMANHA, midia: "IMAGE", status: "pending" });
    expect([duplicado.status, await duplicado.json()]).toEqual([409, { erro: `O post ${pronto.postId} já tem feed agendado ou publicado.` }]);
    expect((await prontos()).map((p) => p.postId)).not.toContain(pronto.postId);
  });

  test("mudar o horário só vale para pendente e para o futuro, e devolve o anterior para desfazer", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const { postId } = postNaEtapa(...PRONTO);
    const item = await json<ItemAgendado>(pedir("/api/fila", ana.cookie, "POST", { postId, midia: "IMAGE", publicaEm: AMANHA }));
    const caminho = `/api/fila/${item.filaId}`;

    const mudou = await json<Reagendado>(pedir(caminho, ana.cookie, "PATCH", { publicaEm: AMANHA + 900_000 }));
    const passado = await pedir(caminho, ana.cookie, "PATCH", { publicaEm: Date.now() - 1000 });
    const desfeito = await json<Reagendado>(pedir(caminho, ana.cookie, "PATCH", { publicaEm: mudou.anterior }));
    db.query("UPDATE queue SET status = 'publishing' WHERE id = ?").run(item.filaId);
    const publicando = await pedir(caminho, ana.cookie, "PATCH", { publicaEm: AMANHA });

    expect([mudou.item.publicaEm, mudou.anterior]).toEqual([AMANHA + 900_000, AMANHA]);
    expect([passado.status, await passado.json()]).toEqual([400, { erro: "Esse horário já passou. Escolha um horário no futuro." }]);
    expect([desfeito.item.publicaEm, desfeito.anterior]).toEqual([AMANHA, AMANHA + 900_000]);
    expect([publicando.status, await publicando.json()]).toEqual([409, { erro: "Só dá para mudar o horário de um agendamento pendente. Este está sendo publicado agora." }]);
    expect((await pedir("/api/fila/999999", ana.cookie, "PATCH", { publicaEm: AMANHA })).status).toBe(404);
  });

  test("cancelar tira do calendário e restaurar põe de volta enquanto o horário não passou", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const { postId } = postNaEtapa(...PRONTO);
    const item = await json<ItemAgendado>(pedir("/api/fila", ana.cookie, "POST", { postId, midia: "IMAGE", publicaEm: AMANHA }));
    const caminho = `/api/fila/${item.filaId}`;
    const diaDoItem = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(AMANHA);
    const naFila = async () => (await calendario(ana.cookie, diaDoItem, diaDoItem)).filter((i) => i.tipo === "agendado" && i.filaId === item.filaId);

    const cancelar = [await pedir(caminho, ana.cookie, "DELETE"), await pedir(caminho, ana.cookie, "DELETE")];
    const depoisDeCancelar = await naFila();
    const restaurado = await json<ItemAgendado>(pedir(`${caminho}/restaurar`, ana.cookie, "POST"));
    const depoisDeRestaurar = await naFila();
    await pedir(caminho, ana.cookie, "DELETE");
    db.query("UPDATE queue SET publish_at = '2020-01-01 12:00:00' WHERE id = ?").run(item.filaId);
    const tarde = await pedir(`${caminho}/restaurar`, ana.cookie, "POST");

    expect(cancelar.map((r) => r.status)).toEqual([204, 204]);
    expect(depoisDeCancelar).toEqual([]);
    expect(restaurado).toEqual(item);
    expect(depoisDeRestaurar).toEqual([item]);
    expect([tarde.status, await tarde.json()]).toEqual([400, { erro: "O horário deste agendamento já passou. Agende de novo com um horário no futuro." }]);
  });

  test("dispensar uma falha tira do calendário e desfazer devolve a falha, sem reagendar", async () => {
    const ana = await sessao("ana@emvidros.com.br");
    const { postId } = postNaEtapa(...PRONTO);
    const item = await json<ItemAgendado>(pedir("/api/fila", ana.cookie, "POST", { postId, midia: "IMAGE", publicaEm: AMANHA }));
    db.query("UPDATE queue SET status = 'failed', error = 'Token expirado' WHERE id = ?").run(item.filaId);
    const caminho = `/api/fila/${item.filaId}`;
    const diaDoItem = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(AMANHA);
    const naFila = async () => (await calendario(ana.cookie, diaDoItem, diaDoItem)).filter((i) => i.tipo === "agendado" && i.filaId === item.filaId);

    const dispensar = await pedir(caminho, ana.cookie, "DELETE");
    const depoisDeDispensar = await naFila();
    const desfeito = await json<ItemAgendado>(pedir(`${caminho}/restaurar`, ana.cookie, "POST"));

    expect(dispensar.status).toBe(204);
    expect(depoisDeDispensar).toEqual([]);
    expect(desfeito).toMatchObject({ filaId: item.filaId, status: "failed", erro: "Token expirado" });
    expect(await naFila()).toEqual([desfeito]);
  });
});

test("as rotas novas pedem sessão", async () => {
  const rotasNovas: [string, string][] = [
    ["GET", "/api/calendario?de=2031-05-01&ate=2031-05-31"],
    ["POST", "/api/pautas"],
    ["PATCH", "/api/pautas/1"],
    ["DELETE", "/api/pautas/1"],
    ["POST", "/api/pautas/1/restaurar"],
    ["POST", "/api/pautas/1/conversa"],
    ["GET", "/api/posts/prontos"],
    ["POST", "/api/fila"],
    ["PATCH", "/api/fila/1"],
    ["DELETE", "/api/fila/1"],
    ["POST", "/api/fila/1/restaurar"],
  ];

  const status = await Promise.all(rotasNovas.map(([method, caminho]) => fetch(url(caminho), { method }).then((r) => r.status)));

  expect(status).toEqual(rotasNovas.map(() => 401));
});
