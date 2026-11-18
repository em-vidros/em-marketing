import { describe, expect, test } from "bun:test";
import type { Brief } from "../domain/art/pipeline";
import {
  abrirConversa,
  criarPost,
  exigir,
  gravarPost,
  midiaParaPublicar,
  postDaConversa,
  transicionar,
  type Arte,
  type EtapaPost,
  type Evento,
  type Formato,
} from "./post";

const brief: Brief = { pilar: "AUTORIDADE", tema: "temperado x comum", precisaFotoReal: false };
const arte = (variant: number, style = "tecnico-poppins"): Arte => ({ variant, style, path: `v${variant}.jpg`, problemas: [] });
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
    const p = rodar(real, { tipo: "foto", arte: arte(1, "foto-real"), storyPath: "story.jpg" });
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
    ];
    let p = inicio;
    expect(await postDaConversa("t-persist")).toEqual(p);
    for (const e of eventos) {
      p = rodar(p, e);
      await gravarPost(p);
      expect(await postDaConversa("t-persist")).toEqual(p);
    }
  });

  test("conversas diferentes têm posts diferentes", async () => {
    await abrirConversa("t-a", "post");
    await abrirConversa("t-b", "post");
    await criarPost("t-a", brief, null);
    expect(await postDaConversa("t-b")).toBeNull();
  });
});
