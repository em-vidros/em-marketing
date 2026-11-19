import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { criarApi } from "./api";
import { arquivosNoDisco } from "./arquivos";
import { banco } from "./banco";
import { AJUSTES_NEUTROS, FORMATOS, type Formato } from "./camadas";
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
    expect(arte.ajustes).toEqual(AJUSTES_NEUTROS);
    const ajustes = { ...AJUSTES_NEUTROS, brilho: 1.2, desfoque: 4 };
    const trocada = await pedir(`/api/artes/${arte.id}`, { method: "PUT", ...json({ camadas, ajustes }) });
    expect(await trocada.json()).toMatchObject({ camadas: [{ texto: "Box que dura", cor: "#63B5AF" }, {}, {}], ajustes });

    const png = await pedir(`/api/artes/${arte.id}/png`);
    expect(png.headers.get("content-type")).toBe("image/png");
    const { width, height } = await sharp(Buffer.from(await png.arrayBuffer())).metadata();
    expect({ width, height }).toEqual({ width: 1080, height: 1920 });
  });

  test("um SVG enviado vira PNG, entra como camada e aparece no render no lugar certo", async () => {
    const arte = await (await pedir("/api/artes", { method: "POST", ...json({ pedido: "Post de teste", formato: "feed" }) })).json();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#FF0000"/></svg>';
    const form = new FormData();
    form.set("arquivo", new File([svg], "selo.svg", { type: "image/svg+xml" }));
    const enviada = await pedir(`/api/artes/${arte.id}/imagens`, { method: "POST", body: form });
    expect(enviada.status).toBe(201);
    const { chave, proporcao } = await enviada.json();
    expect(chave).toMatch(/\.png$/);
    expect(proporcao).toBeCloseTo(0.5);

    const camadas = [{ id: "selo", tipo: "imagem", chave, proporcao, x: 100, y: 100, largura: 400 }];
    expect((await pedir(`/api/artes/${arte.id}`, { method: "PUT", ...json({ camadas, ajustes: AJUSTES_NEUTROS }) })).status).toBe(200);
    const png = Buffer.from(await (await pedir(`/api/artes/${arte.id}/png`)).arrayBuffer());
    const { data } = await sharp(png).extract({ left: 300, top: 200, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 0, 0]);
  });

  test("texto dentro do SVG sai com a fonte da marca, mesmo sem fontes no servidor", async () => {
    const arte = await (await pedir("/api/artes", { method: "POST", ...json({ pedido: "Post de teste", formato: "feed" }) })).json();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#000"/><text x="20" y="150" font-size="140" fill="#fff">EM</text></svg>';
    const form = new FormData();
    form.set("arquivo", new File([svg], "texto.svg", { type: "image/svg+xml" }));
    const { chave } = await (await pedir(`/api/artes/${arte.id}/imagens`, { method: "POST", body: form })).json();
    const png = Buffer.from(await (await pedir(`/api/arquivos/${chave}`)).arrayBuffer());
    const px = await sharp(png).greyscale().raw().toBuffer();
    expect(px.filter((v) => v > 200).length).toBeGreaterThan(1000);
  });

  test("o PNG gira a camada em torno do centro, aplica a opacidade e trata a cena com os ajustes", async () => {
    const arte = await (await pedir("/api/artes", { method: "POST", ...json({ pedido: "Post de teste", formato: "feed" }) })).json();
    const faixa = { id: "faixa", tipo: "forma", cor: "#FF0000", x: 100, y: 500, largura: 400, altura: 40, raio: 0, rotacao: 90 };
    const veu = { id: "veu", tipo: "forma", cor: "#000000", x: 700, y: 100, largura: 200, altura: 200, raio: 0, opacidade: 0.5 };
    const ajustes = { ...AJUSTES_NEUTROS, brilho: 0.5 };
    expect((await pedir(`/api/artes/${arte.id}`, { method: "PUT", ...json({ camadas: [faixa, veu], ajustes }) })).status).toBe(200);

    const png = Buffer.from(await (await pedir(`/api/artes/${arte.id}/png`)).arrayBuffer());
    const cor = async (left: number, top: number) => [...(await sharp(png).extract({ left, top, width: 1, height: 1 }).raw().toBuffer()).subarray(0, 3)];
    // Em pé, a faixa ocupa x 280..320 e y 320..720; deitada ocuparia y 500..540.
    expect(await cor(300, 340)).toEqual([255, 0, 0]);
    expect(await cor(150, 520)).not.toEqual([255, 0, 0]);
    // A cena #E4E1D8 com brilho 0.5, e meio preto por cima dela.
    const cena = await cor(50, 1000);
    expect(cena.map((v, i) => Math.abs(v - [114, 113, 108][i]!) <= 2)).toEqual([true, true, true]);
    const sobVeu = await cor(800, 200);
    expect(sobVeu.map((v, i) => Math.abs(v - cena[i]! / 2) <= 2)).toEqual([true, true, true]);
  });

  test("recusa arquivo de camada que não é imagem", async () => {
    const arte = await (await pedir("/api/artes", { method: "POST", ...json({ pedido: "Post de teste", formato: "feed" }) })).json();
    const form = new FormData();
    form.set("arquivo", new File(["oi"], "nota.txt", { type: "text/plain" }));
    expect((await pedir(`/api/artes/${arte.id}/imagens`, { method: "POST", body: form })).status).toBe(400);
  });

  test("a fonte do texto pode ser qualquer família do catálogo, no peso que ela tem; a da marca grava sem rede", async () => {
    const catalogo = [
      { family: "Montserrat", weights: [400, 800], styles: ["normal", "italic"], subsets: ["latin", "latin-ext"], category: "sans-serif", type: "google" },
      { family: "Noto Sans JP", weights: [400], styles: ["normal"], subsets: ["japanese"], category: "sans-serif", type: "google" },
    ];
    const pedidos: string[] = [];
    const rede = spyOn(globalThis, "fetch").mockImplementation((async (url: string) => (pedidos.push(String(url)), Response.json(catalogo))) as typeof fetch);

    const arte = await (await pedir("/api/artes", { method: "POST", ...json({ pedido: "Post de teste", formato: "feed" }) })).json();
    const comTitulo = (titulo: object) => arte.camadas.map((c: { id: string }) => (c.id === "titulo" ? { ...c, ...titulo } : c));
    const gravar = (titulo: object) => pedir(`/api/artes/${arte.id}`, { method: "PUT", ...json({ camadas: comTitulo(titulo), ajustes: AJUSTES_NEUTROS }) });

    try {
      expect((await gravar({})).status).toBe(200);
      expect(pedidos).toEqual([]);

      const semPeso = await gravar({ fonte: "Montserrat", peso: 300 });
      expect(await semPeso.json()).toEqual({ erro: "A fonte Montserrat não tem o peso 300." });

      const semLatin = await gravar({ fonte: "Noto Sans JP", peso: 400 });
      expect(await semLatin.json()).toEqual({ erro: "A fonte Noto Sans JP não está no catálogo." });

      const gravada = await gravar({ fonte: "Montserrat", peso: 800 });
      expect(gravada.status).toBe(200);
      expect((await gravada.json()).camadas[0]).toMatchObject({ fonte: "Montserrat", peso: 800 });
    } finally {
      rede.mockRestore();
    }
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
