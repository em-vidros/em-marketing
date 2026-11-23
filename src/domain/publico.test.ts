import { describe, expect, test } from "bun:test";
import { abrirConversa, postDaConversa } from "../agent/post";
import { toolsDePost } from "../agent/tools/post";
import { montarBrief, publicoDoBrief, publicoPadrao } from "./publico";

const montarBriefDaTool = (conversaId: string, entrada: unknown) =>
  (toolsDePost(conversaId).montar_brief as unknown as { execute: (e: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(entrada, { toolCallId: "t", messages: [] });

describe("o público do brief", () => {
  test("o brief guarda o público que o pedido disse", () => {
    expect(montarBrief({ pilar: "AUTORIDADE", tema: "box", publico: "consumidor" }).publico).toBe("consumidor");
  });

  test("sem público no pedido, sai o padrão do pilar, que é o vidraceiro", () => {
    for (const pilar of ["PROVA", "AUTORIDADE", "GENTE", "MARCA"] as const) {
      expect(montarBrief({ pilar, tema: "x" }).publico).toBe(publicoPadrao(pilar));
      expect(publicoPadrao(pilar)).toBe("vidraceiro");
    }
  });

  test("brief gravado antes do campo vale como vidraceiro", () => {
    expect(publicoDoBrief({ pilar: "PROVA" })).toBe("vidraceiro");
  });

  test("montar_brief grava o público e ele volta do banco com o post", async () => {
    await abrirConversa("t-publico", "post");
    const r = await montarBriefDaTool("t-publico", { pilar: "AUTORIDADE", publico: "arquiteto", tema: "espessura do guarda-corpo", precisa_foto_real: false });
    expect(r).toMatchObject({ ok: true, brief: { publico: "arquiteto" } });
    expect((await postDaConversa("t-publico"))?.brief.publico).toBe("arquiteto");
  });

  test("montar_brief sem público grava vidraceiro", async () => {
    await abrirConversa("t-publico-padrao", "post");
    await montarBriefDaTool("t-publico-padrao", { pilar: "PROVA", tema: "box", precisa_foto_real: false });
    expect((await postDaConversa("t-publico-padrao"))?.brief.publico).toBe("vidraceiro");
  });
});
