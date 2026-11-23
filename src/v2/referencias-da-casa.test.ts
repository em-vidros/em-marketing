import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { estudioDeTeste } from "../../test/estudio";
import { CRIADA_PELA_CASA, criarReferencia, listarReferencias, removerReferencia } from "./referencias";
import { semearReferenciasDaCasa } from "./referencias-da-casa";
import { referencias } from "./schema";

const estudio = estudioDeTeste();
const daCasa = () => estudio.banco.select().from(referencias).where(eq(referencias.criadaPor, CRIADA_PELA_CASA));
const postsNaPasta = readdirSync("brand/referencias-posts", { recursive: true }).filter((n) => String(n).endsWith(".jpg")).length;

afterEach(() => estudio.banco.delete(referencias).where(inArray(referencias.criadaPor, [CRIADA_PELA_CASA, "u-ana"])));

test("os posts da casa entram na Biblioteca uma vez só, mesmo com dois boots ao mesmo tempo, e a removida não volta", async () => {
  await Promise.all([semearReferenciasDaCasa(estudio), semearReferenciasDaCasa(estudio)]);
  const semeadas = await daCasa();
  expect(semeadas).toHaveLength(postsNaPasta);
  expect((await listarReferencias(estudio.banco)).filter((r) => r.criadaPor === CRIADA_PELA_CASA)).toHaveLength(postsNaPasta);
  expect(await estudio.arquivos.ler(semeadas[0]!.arquivo)).not.toBeNull();

  await removerReferencia(estudio.banco, semeadas[0]!.id);
  await semearReferenciasDaCasa(estudio);
  expect(await daCasa()).toHaveLength(postsNaPasta);
  expect((await listarReferencias(estudio.banco)).filter((r) => r.criadaPor === CRIADA_PELA_CASA)).toHaveLength(postsNaPasta - 1);
});

test("os posts da casa entram com datas antigas e distintas, abaixo do que a equipe já tinha subido", async () => {
  const daEquipe = await criarReferencia(estudio.banco, { arquivo: "x.jpg", leitura: "da equipe", pilares: [], criadaPor: "u-ana" });
  await semearReferenciasDaCasa(estudio);

  const semeadas = await daCasa();
  expect(new Set(semeadas.map((r) => r.criadaEm.getTime())).size).toBe(postsNaPasta);
  expect((await listarReferencias(estudio.banco))[0]!.id).toBe(daEquipe.id);
});
