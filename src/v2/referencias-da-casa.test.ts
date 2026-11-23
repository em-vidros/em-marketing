import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { estudioDeTeste } from "../../test/estudio";
import { listarReferencias, removerReferencia } from "./referencias";
import { CRIADA_PELA_CASA, semearReferenciasDaCasa } from "./referencias-da-casa";
import { referencias } from "./schema";

const estudio = estudioDeTeste();
const daCasa = () => estudio.banco.select().from(referencias).where(eq(referencias.criadaPor, CRIADA_PELA_CASA));
const postsNaPasta = readdirSync("brand/referencias-posts", { recursive: true }).filter((n) => String(n).endsWith(".jpg")).length;

afterEach(() => estudio.banco.delete(referencias).where(eq(referencias.criadaPor, CRIADA_PELA_CASA)));

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
