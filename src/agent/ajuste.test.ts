import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import sharp from "sharp";
import { gravarArquivo } from "../armazem";
import type { IaDoAjuste } from "../domain/art/ajuste";
import { ajustarArteDoPost, voltarArteDoPost } from "./ajuste";
import { abrirConversa, criarPost, gravarPost, postDaConversa, transicionar, type EtapaPost, type Evento } from "./post";

const brief = { pilar: "AUTORIDADE" as const, tema: "box sob medida", precisaFotoReal: false };

const iaFalsa: IaDoAjuste = {
  lerElementos: async () => ({
    textos: [{ texto: "Box sob medida", x: 120, y: 300, largura: 600, altura: 90, tamanho: 80, fonte: "Poppins", peso: "700", cor: "#2F646A", alinhamento: "esquerda" }],
    logo: null,
  }),
  acharObjeto: async () => null,
  editarArea: async () => sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#2F646A" } }).png().toBuffer(),
  lerTexto: async () => ["Box sob medida em 7 dias"],
};

async function postEscolhido(conversaId: string): Promise<EtapaPost> {
  await abrirConversa(conversaId, "post");
  const jpeg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#F0EFEA" } }).jpeg().toBuffer();
  const path = await gravarArquivo("arts", `teste-ajuste-${conversaId}.jpg`, jpeg, "image/jpeg");
  process.on("exit", () => rmSync(path, { force: true }));
  let p = await criarPost(conversaId, brief, "feed");
  const eventos: Evento[] = [
    { tipo: "headline", headline: { headline: "Box sob medida", apoio: "" } },
    { tipo: "artes", artes: [{ variant: 1, ancora: null, path, problemas: [] }] },
    { tipo: "escolha", variante: 1 },
  ];
  for (const evento of eventos) {
    const r = transicionar(p, evento);
    if (!r.ok) throw new Error(r.motivo);
    p = r.post;
  }
  await gravarPost(p);
  return p;
}

describe("ajuste pelo fluxo do post", () => {
  test("ajustar grava a versão nova como a escolhida, e voltar devolve a original; sem ajuste, voltar é recusado", async () => {
    const original = await postEscolhido("t-ajuste");
    const pathOriginal = "peca" in original ? original.peca.arte.path : "";

    const ajustada = await ajustarArteDoPost(await postDaConversa("t-ajuste"), { tipo: "texto", atual: "Box sob medida", novo: "Box sob medida em 7 dias" }, iaFalsa);
    expect(ajustada).toMatchObject({ ok: true, versoesAnteriores: 1, problemas: [] });
    const depois = await postDaConversa("t-ajuste");
    const pathAjustado = depois && "peca" in depois ? depois.peca.arte.path : "";
    process.on("exit", () => rmSync(pathAjustado, { force: true }));
    expect(pathAjustado).not.toBe(pathOriginal);

    expect(await voltarArteDoPost(await postDaConversa("t-ajuste"))).toMatchObject({ ok: true, versoesAnteriores: 0 });
    expect(await postDaConversa("t-ajuste")).toEqual(original);
    expect(await voltarArteDoPost(await postDaConversa("t-ajuste"))).toMatchObject({ ok: false });
  });
});
