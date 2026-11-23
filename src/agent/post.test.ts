import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import sharp from "sharp";
import { deriveStory, type ArtVariant, type Brief } from "../domain/art/pipeline";
import { q } from "../v2/banco";
import {
  abrirConversa,
  criarPost,
  exigir,
  gravarPost,
  midiaParaPublicar,
  postDaConversa,
  transicionar,
  type Arte,
  type FotoReal,
  type EtapaPost,
  type Evento,
  type Formato,
} from "./post";

const brief: Brief = { pilar: "AUTORIDADE", tema: "temperado x comum", precisaFotoReal: false };
const arte = (variant: number): ArtVariant => ({
  variant,
  ancora: { origem: "biblioteca", id: `ref-${variant}`, arquivo: `ref-${variant}.png`, leitura: "leitura" },
  path: `v${variant}.jpg`,
  problemas: [],
});
const foto: FotoReal = { variant: 1, foto: true, path: "foto.jpg", problemas: [] };
const headline = { headline: "O temperado quebra em grãos.", apoio: "" };

/** Aplica os eventos em ordem e falha o teste na primeira recusa. */
function rodar(inicio: EtapaPost, ...eventos: Evento[]): EtapaPost {
  return eventos.reduce((p, e) => {
    const r = transicionar(p, e);
    if (!r.ok) throw new Error(`${e.tipo} recusado: ${r.motivo}`);
    return r.post;
  }, inicio);
}

const novo = (formato: Formato, b: Brief = brief): EtapaPost => ({ etapa: "formato", postId: 1, brief: b, formato });
const comArtes = (formato: Formato) => rodar(novo(formato), { tipo: "headline", headline }, { tipo: "artes", artes: [arte(1), arte(2), arte(3)] });

describe("ordem do fluxo", () => {
  test("invariante 1: sem formato não há headline", () => {
    const r = exigir({ etapa: "brief", postId: 1, brief }, "headline");
    expect(r.ok).toBe(false);
  });

  test("invariante 2: o headline vem antes das artes", () => {
    const r = exigir(novo("feed"), "artes");
    expect(r).toMatchObject({ ok: false, motivo: expect.stringContaining("Invariante 2") });
  });

  test("sem post na conversa nada roda", () => {
    expect(exigir(null, "formato").ok).toBe(false);
  });

  test("novo headline descarta as artes geradas com o anterior", () => {
    const p = rodar(comArtes("feed"), { tipo: "headline", headline: { headline: "Outro.", apoio: "" } });
    expect(p.etapa).toBe("headline");
  });

  test("depois da legenda, o usuário ainda troca de arte entre as 3 e a legenda fica", () => {
    const p = rodar(comArtes("ambos"), { tipo: "escolha", variante: 1 }, { tipo: "story", path: "s.jpg" }, { tipo: "legenda", legenda: "L." }, { tipo: "escolha", variante: 2 });
    expect(p).toMatchObject({ etapa: "legenda", legenda: "L.", storyPath: null, peca: { arte: arte(2) }, opcoes: [arte(1), arte(2), arte(3)] });
  });

  test("escolher variação inexistente é recusado", () => {
    expect(transicionar(comArtes("feed"), { tipo: "escolha", variante: 4 }).ok).toBe(false);
  });
});

describe("invariante 3: stories não têm legenda", () => {
  test("legenda é recusada no stories", () => {
    const p = rodar(comArtes("stories"), { tipo: "escolha", variante: 2 });
    expect(exigir(p, "legenda")).toMatchObject({ ok: false, motivo: expect.stringContaining("Invariante 3") });
  });
});

describe("invariante 4: foto real (§8.2)", () => {
  const real = novo("ambos", { ...brief, pilar: "PROVA", precisaFotoReal: true });

  test("geração é recusada mesmo com headline", () => {
    const p = rodar(real, { tipo: "headline", headline });
    expect(exigir(p, "artes")).toMatchObject({ ok: false, motivo: expect.stringContaining("Invariante 4") });
  });

  test("usar_foto leva à escolhida sem headline, e o 9:16 sai da foto, não de derivar_story", () => {
    const p = rodar(real, { tipo: "foto", arte: foto, storyPath: "story.jpg" });
    expect(p).toMatchObject({ etapa: "escolhida", peca: { origem: "foto" }, storyPath: "story.jpg" });
    expect(exigir(p, "story").ok).toBe(false);
  });
});

describe("formato ambos", () => {
  test("derivar_story só no ambos, e pode vir depois da legenda", () => {
    const feed = rodar(comArtes("feed"), { tipo: "escolha", variante: 1 });
    expect(exigir(feed, "story").ok).toBe(false);

    const ambos = rodar(comArtes("ambos"), { tipo: "escolha", variante: 1 }, { tipo: "legenda", legenda: "Legenda." });
    expect(rodar(ambos, { tipo: "story", path: "s.jpg" })).toMatchObject({ etapa: "legenda", storyPath: "s.jpg" });
  });
});

describe("ajuste da arte escolhida", () => {
  const escolhida = () => rodar(comArtes("ambos"), { tipo: "escolha", variante: 2 }, { tipo: "story", path: "s.jpg" });
  const problema = { regra: "Texto da arte", severidade: "aviso" as const, detalhe: "x" };

  test("o ajuste troca só a arte escolhida, guarda a de antes e tira a story que era dela; voltar traz as duas de volta", () => {
    const ajustada = rodar(escolhida(), { tipo: "ajuste", path: "v2-ajuste.jpg", problemas: [problema] });
    expect(ajustada).toMatchObject({ peca: { arte: { path: "v2-ajuste.jpg", problemas: [problema] } }, storyPath: null });
    expect("opcoes" in ajustada && ajustada.opcoes.map((a) => a.path)).toEqual(["v1.jpg", "v2-ajuste.jpg", "v3.jpg"]);

    const duas = rodar(ajustada, { tipo: "ajuste", path: "v2-ajuste-2.jpg", problemas: [] });
    const voltou = rodar(duas, { tipo: "voltar" });
    expect(voltou).toMatchObject({ peca: { arte: { path: "v2-ajuste.jpg" } }, storyPath: null });
    expect(rodar(voltou, { tipo: "voltar" })).toEqual(escolhida());
  });

  test("sem ajuste não há para onde voltar, e foto real não é ajustada", () => {
    expect(exigir(escolhida(), "voltar")).toMatchObject({ ok: false, motivo: expect.stringContaining("não tem ajuste") });
    const comFoto = rodar(novo("feed", { ...brief, precisaFotoReal: true }), { tipo: "foto", arte: foto, storyPath: null });
    expect(exigir(comFoto, "ajuste")).toMatchObject({ ok: false, motivo: expect.stringContaining("foto real") });
    expect(exigir(comArtes("feed"), "ajuste").ok).toBe(false);
  });
});

describe("publicação", () => {
  const pronto = rodar(
    comArtes("ambos"),
    { tipo: "escolha", variante: 3 },
    { tipo: "story", path: "s.jpg" },
    { tipo: "legenda", legenda: "Legenda." },
  );

  // Pega a volta de uma etapa obrigatória depois da escolha e um post sem peça passando.
  test("publica post com a peça escolhida, mesmo sem legenda; sem peça escolhida, não", () => {
    const semEscolha = comArtes("feed");
    const escolhida = rodar(comArtes("feed"), { tipo: "escolha", variante: 1 });
    expect(midiaParaPublicar(semEscolha, "IMAGE").ok).toBe(false);
    expect(midiaParaPublicar(escolhida, "IMAGE")).toEqual({ ok: true, post: { postId: 1, path: "v1.jpg", legenda: undefined } });
  });

  test("feed leva a arte escolhida e a legenda; stories leva o 9:16 sem legenda", () => {
    expect(midiaParaPublicar(pronto, "IMAGE")).toEqual({ ok: true, post: { postId: 1, path: "v3.jpg", legenda: "Legenda." } });
    expect(midiaParaPublicar(pronto, "STORIES")).toEqual({ ok: true, post: { postId: 1, path: "s.jpg", legenda: undefined } });
  });

  test("tipo de mídia fora do formato é recusado", () => {
    const soStories = rodar(comArtes("stories"), { tipo: "escolha", variante: 1 });
    expect(midiaParaPublicar(soStories, "IMAGE").ok).toBe(false);
  });
});

describe("persistência por conversa", () => {
  test("cada etapa gravada volta igual do banco", async () => {
    await abrirConversa("t-persist", "post");
    const inicio = await criarPost("t-persist", brief, "ambos");
    const eventos: Evento[] = [
      { tipo: "headline", headline },
      { tipo: "artes", artes: [arte(1), arte(2), arte(3)] },
      { tipo: "escolha", variante: 2 },
      { tipo: "story", path: "s.jpg" },
      { tipo: "legenda", legenda: "Legenda." },
      { tipo: "ajuste", path: "v2-ajuste.jpg", problemas: [] },
      { tipo: "voltar" },
      { tipo: "escolha", variante: 3 },
    ];
    let p = inicio;
    expect(await postDaConversa("t-persist")).toEqual(p);
    for (const e of eventos) {
      p = rodar(p, e);
      await gravarPost(p);
      expect(await postDaConversa("t-persist")).toEqual(p);
    }
  });

  test("um post gravado antes das referências no chat volta sem âncora, para a linha de referências usadas não aparecer, a foto real continua foto e a story da arte de uma referência pula o gate de paleta", async () => {
    await abrirConversa("t-antigo", "post");
    const { postId } = await criarPost("t-antigo", brief, "feed");
    const antigas = [
      { variant: 1, style: "teal-chamada", path: "v1.jpg", problemas: [] },
      { variant: 2, style: "foto-real", path: "f.jpg", problemas: [] },
      { variant: 3, referencia: "id-sem-imagem", path: "v3.jpg", problemas: [] },
    ];
    await q`UPDATE posts SET headline = ${JSON.stringify(headline)}, arts = ${JSON.stringify(antigas)}, chosen = 2 WHERE id = ${postId}`;
    const post = await postDaConversa("t-antigo");
    expect(post).toMatchObject({
      etapa: "escolhida",
      peca: { origem: "foto", arte: { variant: 2, foto: true } },
      opcoes: [{ variant: 1, path: "v1.jpg" }, { variant: 2, foto: true }, { variant: 3, path: "v3.jpg" }],
    });
    const opcoes = post?.etapa === "escolhida" ? post.opcoes : [];
    expect(opcoes.map((a) => "ancora" in a)).toEqual([false, false, false]);

    const vermelha = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#D02020" } }).jpeg().toBuffer();
    const paletaNaStory = async (chosen: Arte) => {
      if ("foto" in chosen) throw new Error("a story deriva só de arte gerada");
      const story = await deriveStory({ postId, brief, headline: headline.headline, chosen }, { gerar: async () => vermelha, lerTexto: async () => [headline.headline] });
      rmSync(story.path, { force: true });
      return story.problemas.some((p) => p.regra === "§4.1 paleta");
    };
    expect([await paletaNaStory(opcoes[0]!), await paletaNaStory(opcoes[2]!)]).toEqual([true, false]);
  });

  test("conversas diferentes têm posts diferentes", async () => {
    await abrirConversa("t-a", "post");
    await abrirConversa("t-b", "post");
    await criarPost("t-a", brief, null);
    expect(await postDaConversa("t-b")).toBeNull();
  });
});
