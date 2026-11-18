import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { criarApi } from "./api";
import { arquivosNoDisco } from "./arquivos";
import { banco } from "./banco";
import { FORMATOS, type Formato } from "./camadas";
import type { Ia } from "./ia";
import { escolherReferencias } from "./referencias";
import { artes, referencias } from "./schema";

const ana = { id: "u-ana", email: "ana@emvidros.com.br", nome: "Ana", admin: false };

const cenaFalsa = (formato: Formato) =>
  sharp({ create: { width: FORMATOS[formato].largura, height: FORMATOS[formato].altura, channels: 3, background: "#E4E1D8" } }).jpeg().toBuffer();

let leiturasRecebidas: string[][] = [];
const iaFalsa: Ia = {
  lerReferencia: async () => "Par de fontes bold e fina, ilustração chapada, foco no canto esquerdo.",
  planejarArte: async (_pedido, _formato, leituras) => {
    leiturasRecebidas.push(leituras);
    return { cena: "flat matte glass texture", titulo: "Vidro temperado aguenta o dia a dia", apoio: "Box sob medida em 7 dias", display: false, fundoEscuro: false };
  },
  gerarCena: async (_prompt, formato) => cenaFalsa(formato),
};

let api: ReturnType<typeof criarApi>;

beforeEach(async () => {
  leiturasRecebidas = [];
  // O banco é o do preload, de todos os arquivos de teste; cada caso começa sem referências nem artes.
  await banco().delete(referencias);
  await banco().delete(artes);
  const arquivos = arquivosNoDisco(mkdtempSync(join(tmpdir(), "em-v2-")));
  api = criarApi({ banco: banco(), ia: iaFalsa, arquivos }, async (req) => (req.headers.get("x-teste") === "ana" ? ana : null));
});

const pedir = (caminho: string, init: RequestInit = {}) =>
  api.request(`http://localhost${caminho}`, { ...init, headers: { "x-teste": "ana", ...(init.headers as Record<string, string>) } });

const json = (corpo: unknown) => ({ body: JSON.stringify(corpo), headers: { "content-type": "application/json" } });

async function enviarReferencia() {
  const form = new FormData();
  form.set("arquivo", new File([await cenaFalsa("feed")], "ref.jpg", { type: "image/jpeg" }));
  return pedir("/api/referencias", { method: "POST", body: form });
}

describe("biblioteca de referências", () => {
  test("enviar, corrigir a leitura, remover e desfazer", async () => {
    const enviada = await enviarReferencia();
    expect(enviada.status).toBe(201);
    const ref = await enviada.json();
    expect(ref.leitura).toContain("Par de fontes");

    const editada = await pedir(`/api/referencias/${ref.id}`, { method: "PATCH", ...json({ leitura: "Só a fonte bold." }) });
    expect(await editada.json()).toMatchObject({ leitura: "Só a fonte bold.", leituraEditadaPor: "u-ana" });

    expect((await pedir(`/api/referencias/${ref.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await (await pedir("/api/referencias")).json()).toEqual([]);

    expect((await pedir(`/api/referencias/${ref.id}/restaurar`, { method: "POST" })).status).toBe(200);
    expect((await (await pedir("/api/referencias")).json()).map((r: { id: string }) => r.id)).toEqual([ref.id]);

    const imagem = await pedir(`/api/arquivos/${ref.arquivo}`);
    expect(imagem.headers.get("content-type")).toBe("image/jpeg");
  });

  test("recusa arquivo que não é imagem", async () => {
    const form = new FormData();
    form.set("arquivo", new File(["oi"], "nota.txt", { type: "text/plain" }));
    const r = await pedir("/api/referencias", { method: "POST", body: form });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: "A referência precisa ser PNG, JPEG ou WebP." });
  });
});

describe("artes", () => {
  test("cria com as leituras da biblioteca, edita as camadas e renderiza o PNG no tamanho do formato", async () => {
    await enviarReferencia();
    const criada = await pedir("/api/artes", { method: "POST", ...json({ pedido: "Post sobre box de banheiro", formato: "story" }) });
    expect(criada.status).toBe(201);
    const arte = await criada.json();
    expect(leiturasRecebidas).toEqual([["Par de fontes bold e fina, ilustração chapada, foco no canto esquerdo."]]);
    expect(arte.camadas.map((c: { id: string }) => c.id)).toEqual(["titulo", "apoio", "logo"]);

    const camadas = arte.camadas.map((c: { id: string }) => (c.id === "titulo" ? { ...c, texto: "Box que dura", cor: "#63B5AF" } : c));
    const trocada = await pedir(`/api/artes/${arte.id}/camadas`, { method: "PUT", ...json({ camadas }) });
    expect((await trocada.json()).camadas[0]).toMatchObject({ texto: "Box que dura", cor: "#63B5AF" });

    const png = await pedir(`/api/artes/${arte.id}/png`);
    expect(png.headers.get("content-type")).toBe("image/png");
    const { width, height } = await sharp(Buffer.from(await png.arrayBuffer())).metadata();
    expect({ width, height }).toEqual({ width: 1080, height: 1920 });
  });

  test("recusa camada com peso que a fonte não tem", async () => {
    const arte = await (await pedir("/api/artes", { method: "POST", ...json({ pedido: "Post de teste", formato: "feed" }) })).json();
    const camadas = arte.camadas.map((c: { id: string }) => (c.id === "titulo" ? { ...c, fonte: "Playfair Display", peso: 900 } : c));
    const r = await pedir(`/api/artes/${arte.id}/camadas`, { method: "PUT", ...json({ camadas }) });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: "Essa fonte não tem esse peso." });
  });
});

describe("acesso", () => {
  test("sem sessão dá 401 e id que não é uuid dá 404", async () => {
    expect((await api.request("http://localhost/api/artes")).status).toBe(401);
    expect((await pedir("/api/artes/123/png")).status).toBe(404);
  });
});

test("a escolha de referências foge das que as últimas artes usaram", () => {
  const recentes = [["a"], ["b", "c"]];
  expect(escolherReferencias(["a", "b", "c", "d", "e"], recentes, 2).sort()).toEqual(["d", "e"]);
  expect(escolherReferencias(["a", "b", "c", "d"], recentes, 3)).toEqual(["d", "b", "c"]);
});
