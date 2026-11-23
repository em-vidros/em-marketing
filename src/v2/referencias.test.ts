import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { estudioDeTeste } from "../../test/estudio";
import type { Pilar } from "../domain/art/pipeline";
import { q } from "./banco";
import { CRIADA_PELA_CASA, escolherReferencias, referenciasParaGerar } from "./referencias";
import { referencias } from "./schema";

const ref = (id: string, dia: number, pilares: Pilar[] = [], criadaPor = "u-ana") => ({ id, pilares, criadaPor, criadaEm: new Date(Date.UTC(2026, 10, dia)) });
const daCasa = (id: string, dia: number) => ref(id, dia, ["PROVA"], CRIADA_PELA_CASA);
const naOrdem = () => 0;

describe("escolha de referências", () => {
  test("as marcadas vêm primeiro, na ordem da pessoa, sem repetir e sem as removidas; a mais nova não fura a fila", () => {
    const ativas = [ref("a", 1), ref("b", 2), ref("nova", 3)];
    expect(escolherReferencias({ ativas, marcadas: ["b", "removida", "b", "a"], recentes: [], sortear: naOrdem })).toEqual(["b", "a", "nova"]);
  });

  test("sem marcadas, a referência mais nova entra primeiro mesmo que a última geração tenha usado", () => {
    const ativas = [ref("a", 1), ref("nova", 3), ref("b", 2)];
    expect(escolherReferencias({ ativas, recentes: [["nova"]], sortear: naOrdem })[0]).toBe("nova");
  });

  test("a mais nova é a que a equipe subiu, mesmo com referências da casa de data mais nova", () => {
    const ativas = [daCasa("casa", 20), ref("velha", 1), ref("nova", 2)];
    expect(escolherReferencias({ ativas, recentes: [], pilar: "PROVA", sortear: naOrdem })[0]).toBe("nova");
  });

  test("sem referência da equipe, ninguém tem lugar fixo: a primeira muda com o sorteio", () => {
    const ativas = [daCasa("casa-1", 1), daCasa("casa-mais-nova", 3), daCasa("casa-2", 2)];
    let ordem = 0;
    const deTrasPraFrente = () => -ordem++;
    const primeira = (sortear: () => number) => escolherReferencias({ ativas, recentes: [], pilar: "PROVA", sortear })[0];
    expect([primeira(naOrdem), primeira(deTrasPraFrente)]).toEqual(["casa-1", "casa-2"]);
  });

  test("entre as livres, as do pilar do post e as sem pilar vêm antes das outras", () => {
    const ativas = [ref("nova", 9), ref("marca", 1, ["MARCA"]), ref("sem-pilar", 5), ref("gente-1", 2, ["GENTE"]), ref("usada", 3, ["GENTE"]), ref("gente-2", 4, ["GENTE", "PROVA"])];
    expect(escolherReferencias({ ativas, recentes: [["usada"]], pilar: "GENTE", sortear: naOrdem })).toEqual(["nova", "sem-pilar", "gente-1", "gente-2", "marca", "usada"]);
  });

  test("sem livres suficientes, completa com as usadas há mais tempo, sem repetir nenhuma", () => {
    const ativas = [ref("a", 1), ref("b", 2), ref("c", 3), ref("nova", 4)];
    const recentes = [["a"], ["b", "nova"], ["c"]];
    expect(escolherReferencias({ ativas, recentes, sortear: naOrdem })).toEqual(["nova", "c", "b", "a"]);
  });
});

test("a referência subida chega à geração em JPEG de até 1024 px, a mais nova primeiro e a usada na última geração por último", async () => {
  const estudio = estudioDeTeste();
  await estudio.banco.delete(referencias);

  const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#2F646A" } }).png().toBuffer();
  const subir = async (leitura: string, dia: number) => {
    const arquivo = await estudio.arquivos.salvar(png, "png");
    const [criada] = await estudio.banco.insert(referencias).values({ arquivo, leitura, criadaPor: "u-ana", criadaEm: new Date(Date.UTC(2026, 10, dia)) }).returning();
    return criada!.id;
  };
  const [usada, velha, nova] = [await subir("usada", 1), await subir("velha", 2), await subir("nova", 3)];

  const [post] = await q<{ id: number }>`INSERT INTO posts (arts) VALUES (${JSON.stringify([{ variant: 1, referencia: usada, path: "v1.jpg", problemas: [] }])}) RETURNING id`;

  try {
    const carregadas = await referenciasParaGerar(estudio, { pilar: "PROVA" });
    expect(carregadas.map((r) => [r.id, r.leitura])).toEqual([
      [nova, "nova"],
      [velha, "velha"],
      [usada, "usada"],
    ]);
    expect(await sharp(carregadas[0]!.imagem).metadata()).toMatchObject({ format: "jpeg", width: 1024, height: 512 });
  } finally {
    await q`DELETE FROM posts WHERE id = ${post!.id}`;
  }
});
