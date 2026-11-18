import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import sharp from "sharp";
import { q } from "../../v2/banco";
import { buscarFotos, contarFotos, pegarFoto, prepararFoto, resumir, salvarFoto } from "./index";

// O banco de teste vem do preload (test/setup.ts). Os arquivos, não: salvarFoto e
// prepararFoto escrevem em data/, que é o mesmo diretório de execução.
const criados: string[] = [];
afterAll(() => {
  for (const p of criados) rmSync(p, { force: true });
});

const fixture = (w: number, h: number, hex = "#8A8A8A") =>
  sharp({ create: { width: w, height: h, channels: 3, background: hex } }).jpeg().toBuffer();

async function semear(campos: Partial<Record<"descricao" | "produto" | "unidade" | "contexto" | "tags", string>>) {
  const { id, path } = await salvarFoto(await fixture(800, 600));
  criados.push(path);
  await q`UPDATE fotos SET descricao = ${campos.descricao ?? null}, produto = ${campos.produto ?? null}, unidade = ${campos.unidade ?? null},
    contexto = ${campos.contexto ?? null}, tags = ${campos.tags ?? null} WHERE id = ${id}`;
  return id;
}

describe("salvarFoto", () => {
  test("grava o arquivo e as dimensões reais", async () => {
    const { id, path, largura, altura } = await salvarFoto(await fixture(1600, 1200));
    criados.push(path);
    expect(existsSync(path)).toBe(true);
    expect([largura, altura]).toEqual([1600, 1200]);
    expect((await pegarFoto(id))?.largura).toBe(1600);
  });

  test("normaliza para JPEG sem metadado — o EXIF de celular carrega GPS", async () => {
    const comExif = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#414141" } })
      .withExif({ IFD0: { Copyright: "teste", Software: "camera" } })
      .jpeg()
      .toBuffer();
    const { path } = await salvarFoto(comExif);
    criados.push(path);
    const meta = await sharp(path).metadata();
    expect(meta.exif).toBeUndefined();
  });
});

describe("buscarFotos", () => {
  test("sem termo devolve as mais recentes", async () => {
    const antes = await contarFotos();
    await semear({ descricao: "prateleira cheia" });
    expect(await contarFotos()).toBe(antes + 1);
    expect((await buscarFotos()).length).toBeGreaterThan(0);
  });

  test("pontua por quantas palavras casam, não por casamento exato", async () => {
    const box = await semear({ produto: "box", unidade: "Imperatriz", tags: "temperado, banheiro" });
    await semear({ produto: "guarda-corpo", unidade: "Teresina", tags: "sacada, laminado" });
    const r = await buscarFotos("box temperado Imperatriz");
    expect(r[0]?.id).toBe(box);
  });

  test("foto sem nenhuma palavra em comum não entra no resultado", async () => {
    const r = await buscarFotos("fachada ACM");
    expect(r.every((f) => `${f.produto} ${f.tags}`.includes("fachada") || `${f.produto} ${f.tags}`.includes("ACM"))).toBe(true);
  });

  test("termo só de palavras curtas não devolve o banco inteiro", async () => {
    expect(await buscarFotos("de o um")).toEqual([]);
  });

  test("busca é insensível a maiúscula", async () => {
    expect((await buscarFotos("IMPERATRIZ")).length).toBeGreaterThan(0);
  });
});

describe("prepararFoto", () => {
  test("recorta para a dimensão exata do feed", async () => {
    const id = await semear({ descricao: "obra entregue" });
    const path = await prepararFoto({ fotoId: id, postId: 99, formato: "feed" });
    criados.push(path);
    const meta = await sharp(path).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
  });

  test("recorta para a dimensão exata do story", async () => {
    const id = await semear({ descricao: "fachada" });
    const path = await prepararFoto({ fotoId: id, postId: 99, formato: "stories" });
    criados.push(path);
    const meta = await sharp(path).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
  });

  test("conta o uso — é o começo da memória de desempenho", async () => {
    const id = await semear({ descricao: "equipe" });
    expect((await pegarFoto(id))?.usos).toBe(0);
    criados.push(await prepararFoto({ fotoId: id, postId: 1, formato: "feed" }));
    criados.push(await prepararFoto({ fotoId: id, postId: 2, formato: "feed" }));
    expect((await pegarFoto(id))?.usos).toBe(2);
  });

  test("foto inexistente lança em vez de gerar arte vazia", async () => {
    await expect(prepararFoto({ fotoId: 99999, postId: 1, formato: "feed" })).rejects.toThrow("não existe");
  });
});

test("resumir mostra o que o cérebro precisa para escolher", async () => {
  const id = await semear({ descricao: "box em temperado 8 mm", produto: "box", unidade: "Raposa", contexto: "loja" });
  const txt = resumir((await pegarFoto(id))!);
  expect(txt).toContain(`#${id}`);
  expect(txt).toContain("box em temperado 8 mm");
  expect(txt).toContain("Raposa");
});
