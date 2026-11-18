import { beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { abrirBanco, q } from "../v2/banco";
import { rotaMcp } from "./servidor";

const doHub = generateKeyPairSync("ed25519");
const deOutro = generateKeyPairSync("ed25519");
process.env.HUB_CHAVE_PUBLICA = doHub.publicKey.export({ type: "spki", format: "der" }).toString("base64");

/** Como tokenParaApp no em-hub (apps/hub/src/servidor/tokenDoApp.ts). */
function token({ app = "em-marketing", exp = Math.floor(Date.now() / 1000) + 300, chave = doHub.privateKey as KeyObject } = {}) {
  const corpo = Buffer.from(JSON.stringify({ app, pessoa: "p-ana", cargo: "Marketing", admin: false, dados: null, exp })).toString("base64url");
  return `${corpo}.${sign(null, Buffer.from(corpo), chave).toString("base64url")}`;
}

let proximoId = 1;
const pedir = (method: string, params: Record<string, unknown> = {}, comToken = token()) =>
  rotaMcp(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${comToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: proximoId++, method, params }),
    }),
  );

async function chamar(name: string, args: Record<string, unknown>) {
  const corpo = (await (await pedir("tools/call", { name, arguments: args })).json()) as { result: { structuredContent: Record<string, unknown>; isError?: boolean } };
  expect(corpo.result.isError).toBeUndefined();
  return corpo.result.structuredContent;
}

beforeAll(async () => {
  try {
    await q`SELECT 1`;
  } catch {
    await abrirBanco({ dir: null });
  }
  // O preload pode já ter criado as tabelas antigas; aqui só garante as colunas que o MCP lê.
  await q`CREATE TABLE IF NOT EXISTS posts (id integer PRIMARY KEY, brief text, pilar text, formato text, headline text, legenda text, status text DEFAULT 'draft', created_at text)`;
  await q`CREATE TABLE IF NOT EXISTS queue (id integer PRIMARY KEY, post_id integer, arte_id text, media_type text NOT NULL, publish_at text NOT NULL, status text DEFAULT 'pending', error text, jpeg_path text NOT NULL, legenda text)`;
  await q`CREATE TABLE IF NOT EXISTS publicacoes (id integer PRIMARY KEY, post_id integer, arte_id text, media_type text NOT NULL, ig_media_id text NOT NULL, permalink text, published_at text)`;
  await q`CREATE TABLE IF NOT EXISTS pautas (id integer PRIMARY KEY, dia text NOT NULL, hora text, titulo text NOT NULL, pilar text, nota text NOT NULL DEFAULT '', conversa_id text, criada_por text NOT NULL, criada_em double precision NOT NULL, atualizada_em double precision NOT NULL, apagada_em double precision)`;

  const brief = JSON.stringify({ tema: "box para banheiro pequeno" });
  const headline = JSON.stringify({ headline: "Box sob medida", apoio: "Pronto em 7 dias" });
  await q`INSERT INTO posts (id, brief, pilar, formato, headline, legenda, status, created_at) VALUES
    (9001, ${brief}, 'PROVA', 'feed', ${headline}, 'Legenda do box', 'scheduled', '2031-11-10 15:00:00'),
    (9002, NULL, 'GENTE', 'feed', 'Guarda-corpo na obra', NULL, 'draft', '2031-11-01 02:00:00'),
    (9003, NULL, 'PROVA', 'stories', 'Espelho', NULL, 'draft', '2031-11-20 12:00:00')`;
  const [arte] = await q<{ id: string }>`
    INSERT INTO artes (pedido, formato, cena, prompt_da_cena, referencias, camadas, criada_por, criada_em)
    VALUES ('Post de Black Friday', 'feed', 'vidro', 'flat glass', '{}', ${JSON.stringify([{ id: "t", tipo: "texto", texto: "Black Friday EM" }])}::jsonb, 'u-ana', '2031-11-12T13:00:00Z')
    RETURNING id::text AS id`;
  await q`INSERT INTO queue (id, post_id, arte_id, media_type, publish_at, status, error, jpeg_path, legenda) VALUES
    (9001, 9001, NULL, 'IMAGE', '2031-11-19 21:00:00', 'pending', NULL, 'a.jpg', 'Legenda do box'),
    (9002, 9001, NULL, 'STORIES', '2031-11-18 21:00:00', 'done', NULL, 'b.jpg', NULL),
    (9003, NULL, ${arte!.id}, 'IMAGE', '2031-11-21 12:00:00', 'failed', 'Token do Instagram expirou', 'c.jpg', 'Black')`;
  await q`INSERT INTO publicacoes (id, post_id, arte_id, media_type, ig_media_id, permalink, published_at) VALUES
    (9001, 9001, NULL, 'STORIES', 'ig1', 'https://instagram.com/p/1', '2031-11-18 21:00:01')`;
  await q`INSERT INTO pautas (id, dia, hora, titulo, pilar, nota, criada_por, criada_em, atualizada_em, apagada_em) VALUES
    (9001, '2031-11-25', '18:00', 'Bastidores da fábrica', 'GENTE', '', 'u-ana', 0, 0, NULL),
    (9002, '2031-11-26', NULL, 'Pauta apagada', 'MARCA', '', 'u-ana', 0, 0, 1)`;
});

describe("MCP do em-marketing", () => {
  test("initialize responde na versão pedida e notificação volta 202", async () => {
    const corpo = (await (await pedir("initialize", { protocolVersion: "2025-03-26" })).json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(corpo.result.protocolVersion).toBe("2025-03-26");
    expect(corpo.result.serverInfo.name).toBe("em-marketing");

    const notificacao = await rotaMcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      }),
    );
    expect(notificacao.status).toBe(202);
  });

  test("tools/list traz as ferramentas só de leitura", async () => {
    const corpo = (await (await pedir("tools/list")).json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(corpo.result.tools.map((t) => t.name).sort()).toEqual(["listar_agenda", "listar_artes", "listar_pautas", "listar_pecas", "listar_publicacoes", "resumo_do_mes"]);
    expect(corpo.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  test("listar_agenda mostra o que não saiu, na hora de São Paulo", async () => {
    const agenda = await chamar("listar_agenda", { de: "2031-11-18", ate: "2031-11-24" });
    expect(agenda).toEqual({
      total: 2,
      itens: [
        { id: 9001, quando: "2031-11-19 18:00", onde: "feed", status: "agendado", erro: null, origem: "peça 9001", titulo: "Box sob medida", pilar: "PROVA", legenda: "Legenda do box" },
        {
          id: 9003,
          quando: "2031-11-21 09:00",
          onde: "feed",
          status: "falhou",
          erro: "Token do Instagram expirou",
          origem: "arte do estúdio",
          titulo: "Post de Black Friday",
          pilar: null,
          legenda: "Black",
        },
      ],
    });
  });

  test("resumo_do_mes conta pelo mês de São Paulo", async () => {
    // A peça 9002 foi criada às 02:00 UTC de 1º de novembro, que em São Paulo ainda é 31 de outubro.
    expect(await chamar("resumo_do_mes", { mes: "2031-11" })).toEqual({
      mes: "2031-11",
      pecas_criadas: 2,
      pecas_por_pilar: [{ pilar: "PROVA", quantidade: 2 }],
      artes_criadas: 1,
      publicadas: 1,
      agendadas: 1,
      com_falha: 1,
      pautas: 1,
    });
  });

  test("peças, publicações, pautas e artes saem legíveis", async () => {
    const pecas = await chamar("listar_pecas", { de: "2031-11-10", ate: "2031-11-10" });
    expect(pecas.itens).toMatchObject([{ id: 9001, titulo: "Box sob medida", apoio: "Pronto em 7 dias", tema: "box para banheiro pequeno", status: "agendada", criada_em: "2031-11-10 12:00" }]);
    const publicacoes = await chamar("listar_publicacoes", { de: "2031-11-18", ate: "2031-11-18" });
    expect(publicacoes.itens).toMatchObject([{ onde: "stories", link: "https://instagram.com/p/1", publicada_em: "2031-11-18 18:00" }]);
    const pautas = await chamar("listar_pautas", { de: "2031-11-01", ate: "2031-11-30" });
    expect(pautas.itens).toEqual([{ id: 9001, dia: "2031-11-25", hora: "18:00", titulo: "Bastidores da fábrica", pilar: "GENTE", nota: null }]);
    const artes = await chamar("listar_artes", { de: "2031-11-12", ate: "2031-11-12" });
    expect(artes.itens).toMatchObject([{ pedido: "Post de Black Friday", formato: "feed", textos: ["Black Friday EM"], criada_em: "2031-11-12 10:00" }]);
  });

  test("dia mal escrito volta como recusa para o modelo corrigir", async () => {
    const corpo = (await (await pedir("tools/call", { name: "listar_pautas", arguments: { de: "25/11" } })).json()) as { result: { isError: boolean } };
    expect(corpo.result.isError).toBe(true);
  });

  test.each([
    ["de outro App", token({ app: "outro-app" })],
    ["vencido", token({ exp: Math.floor(Date.now() / 1000) - 1 })],
    ["assinado por outra chave", token({ chave: deOutro.privateKey })],
    ["vazio", ""],
  ])("token %s volta 401", async (_, invalido) => {
    const resposta = await pedir("tools/list", {}, invalido);
    expect(resposta.status).toBe(401);
  });

  test("GET volta 405", async () => {
    expect((await rotaMcp(new Request("http://localhost/api/mcp"))).status).toBe(405);
  });
});
