import { describe, expect, test } from "bun:test";
import { q } from "../v2/banco";
import { criarTabelas, pastaDa, primeira, type TipoImagem } from ".";

/**
 * criarTabelas roda em todo boot, inclusive em dois boots ao mesmo tempo na Vercel. O banco de teste
 * já passou por ela no preload (test/setup.ts); aqui ela roda de novo sobre dados que existem.
 */

const novoPost = async () => (await primeira(q<{ id: number }>`INSERT INTO posts (brief) VALUES ('{"tema":"existente"}') RETURNING id`))!.id;

// Pega um DDL que recria, apaga ou falha numa tabela que já existe, no boot seguinte.
test("rodar de novo, e duas vezes ao mesmo tempo, não muda os dados nem falha", async () => {
  const id = await novoPost();
  const antes = await q`SELECT count(*)::int AS n FROM posts`;

  await Promise.all([criarTabelas(), criarTabelas()]);

  expect(await q`SELECT count(*)::int AS n FROM posts`).toEqual(antes);
  expect(await q`SELECT brief FROM posts WHERE id = ${id}`).toEqual([{ brief: '{"tema":"existente"}' }]);
});

// Pega a CHECK ausente: linha sem fonte ou com as duas passaria e o tick não saberia o que publicar.
test("queue e publicacoes recusam linha sem fonte ou com post e arte ao mesmo tempo", async () => {
  const post = await novoPost();
  const naFila = (postId: number | null, arteId: string | null) =>
    q`INSERT INTO queue (post_id, arte_id, media_type, publish_at, jpeg_path) VALUES (${postId}, ${arteId}, 'IMAGE', '2031-02-01 12:00:00', '/a/n.jpg')`;
  const publicada = (postId: number | null, arteId: string | null) =>
    q`INSERT INTO publicacoes (post_id, arte_id, media_type, ig_media_id) VALUES (${postId}, ${arteId}, 'IMAGE', ${crypto.randomUUID()})`;
  await expect(naFila(null, null)).rejects.toThrow();
  await expect(naFila(post, "a1b2")).rejects.toThrow();
  await expect(publicada(null, null)).rejects.toThrow();
  await expect(publicada(post, "a1b2")).rejects.toThrow();
});

describe("publicacoes, a chave que liga a peça ao Instagram", () => {
  const ig = (sufixo: string) => `ig-db-test-${sufixo}`;

  // Pega published_at fora do formato de texto que o calendário compara e converte (utcDe, isoDoUtc).
  test("guarda o id da mídia e o tipo, com a data em texto UTC", async () => {
    const post = await novoPost();
    await q`INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (${post}, 'IMAGE', ${ig("abc")})`;
    const row = (await primeira(q<{ post_id: number; published_at: string }>`SELECT * FROM publicacoes WHERE ig_media_id = ${ig("abc")}`))!;
    expect(row.post_id).toBe(post);
    expect(row.published_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("um post pode ter feed e story, por isso não é coluna em posts", async () => {
    const post = await novoPost();
    await q`INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (${post}, 'IMAGE', ${ig("feed")})`;
    await q`INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (${post}, 'STORIES', ${ig("story")})`;
    expect(await q`SELECT count(*)::int AS n FROM publicacoes WHERE post_id = ${post}`).toEqual([{ n: 2 }]);
  });

  test("o mesmo ig_media_id não entra duas vezes", async () => {
    const post = await novoPost();
    await q`INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (${post}, 'IMAGE', ${ig("unico")})`;
    await expect(q`INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (${post}, 'IMAGE', ${ig("unico")})`).rejects.toThrow();
  });

  test("media_type fora do domínio é rejeitado pelo banco", async () => {
    const post = await novoPost();
    await expect(q`INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (${post}, 'REEL', ${ig("reel")})`).rejects.toThrow();
  });
});

// Pega a imagem na pasta errada: a escolhida trocada que ficava em Selecionadas, ou a rodada anterior que sumia das Descartadas.
describe("pastaDa, a pasta de cada imagem na Biblioteca", () => {
  const arts = JSON.stringify([1, 2, 3].map((v) => ({ variant: v, path: `r2-v${v}.jpg` })));
  const imagem = (path: string, tipo: TipoImagem = "variacao") => ({ path, tipo });

  test("com escolha: a escolhida e o story dela são Selecionadas, o resto é Descartada", () => {
    const post = { arts, chosen: 2, story_path: "story-v2.jpg" };
    expect(pastaDa(imagem("r2-v2.jpg"), post)).toBe("selecionada");
    expect(pastaDa(imagem("story-v2.jpg", "story"), post)).toBe("selecionada");
    expect(pastaDa(imagem("r2-v1.jpg"), post)).toBe("descartada");
    expect(pastaDa(imagem("r1-v2.jpg"), post)).toBe("descartada");
    expect(pastaDa(imagem("story-v1.jpg", "story"), post)).toBe("descartada");
  });

  test("sem escolha: as opções atuais ficam em aberto e as rodadas anteriores são Descartadas", () => {
    const post = { arts, chosen: null, story_path: null };
    expect(pastaDa(imagem("r2-v3.jpg"), post)).toBe("aberta");
    expect(pastaDa(imagem("r1-v3.jpg"), post)).toBe("descartada");
  });
});
