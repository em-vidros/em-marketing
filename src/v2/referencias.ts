import { and, desc, eq, isNull } from "drizzle-orm";
import type { Pilar } from "../domain/art/pipeline";
import type { Banco } from "./banco";
import { referencias, type Referencia } from "./schema";

export const listarReferencias = (banco: Banco) =>
  banco.select().from(referencias).where(isNull(referencias.removidaEm)).orderBy(desc(referencias.criadaEm));

export async function criarReferencia(banco: Banco, nova: { arquivo: string; leitura: string; pilares: Pilar[]; criadaPor: string }): Promise<Referencia> {
  const [criada] = await banco.insert(referencias).values(nova).returning();
  return criada!;
}

export async function editarLeitura(banco: Banco, id: string, leitura: string, quem: string): Promise<Referencia | null> {
  const [editada] = await banco
    .update(referencias)
    .set({ leitura, leituraEditadaPor: quem })
    .where(and(eq(referencias.id, id), isNull(referencias.removidaEm)))
    .returning();
  return editada ?? null;
}

/** Remover só marca a data, para o desfazer trazer de volta. Remover de novo não muda a data. */
export async function removerReferencia(banco: Banco, id: string): Promise<boolean> {
  const [existe] = await banco.select({ removidaEm: referencias.removidaEm }).from(referencias).where(eq(referencias.id, id));
  if (!existe) return false;
  if (!existe.removidaEm) await banco.update(referencias).set({ removidaEm: new Date() }).where(eq(referencias.id, id));
  return true;
}

export async function restaurarReferencia(banco: Banco, id: string): Promise<Referencia | null> {
  const [restaurada] = await banco.update(referencias).set({ removidaEm: null }).where(eq(referencias.id, id)).returning();
  return restaurada ?? null;
}

type Ativa = { id: string; pilares: readonly Pilar[]; criadaEm: Date };

/** As leituras de até `n` referências, para o gerador do Chefe seguir os princípios delas. */
export async function leiturasParaInspirar(banco: Banco, n = 3): Promise<string[]> {
  const ativas = await listarReferencias(banco);
  const escolhidas = escolherReferencias({ ativas, recentes: [], n });
  return ativas.filter((r) => escolhidas.includes(r.id)).map((r) => r.leitura);
}

/**
 * Escolhe `n` referências para uma geração nova, nesta ordem: as marcadas pela pessoa; sem marcadas, a mais nova;
 * depois as livres do pilar, as outras livres e, por fim, as usadas há mais tempo.
 * Livre é a que nenhuma das gerações em `recentes` usou. `recentes` vem da geração mais nova para a mais velha.
 */
export function escolherReferencias(o: {
  ativas: readonly Ativa[];
  marcadas?: readonly string[];
  recentes: readonly (readonly string[])[];
  pilar?: Pilar;
  n: number;
  sortear?: () => number;
}): string[] {
  const { ativas, recentes, pilar, n, sortear = Math.random } = o;
  const idsAtivos = new Set(ativas.map((r) => r.id));
  const marcadas = (o.marcadas ?? []).filter((id) => idsAtivos.has(id));
  const maisNova = ativas
    .toSorted((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())
    .slice(0, 1)
    .map((r) => r.id);
  const fixas = marcadas.length > 0 ? marcadas : maisNova;

  const ultimoUso = new Map<string, number>();
  recentes.forEach((usadas, idade) => usadas.forEach((id) => ultimoUso.has(id) || ultimoUso.set(id, idade)));
  const usadasDaMaisVelha = [...ultimoUso]
    .filter(([id]) => idsAtivos.has(id))
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id);

  const livres = ativas.filter((r) => !ultimoUso.has(r.id));
  const ehDoPilar = (r: Ativa) => pilar !== undefined && r.pilares.includes(pilar);
  const livresDoPilar = embaralhar(livres.filter(ehDoPilar), sortear);
  const outrasLivres = embaralhar(livres.filter((r) => !ehDoPilar(r)), sortear);

  return [...new Set([...fixas, ...livresDoPilar, ...outrasLivres, ...usadasDaMaisVelha])].slice(0, n);
}

function embaralhar(referencias: readonly Ativa[], sortear: () => number): string[] {
  return referencias
    .map((r) => ({ id: r.id, ordem: sortear() }))
    .sort((a, b) => a.ordem - b.ordem)
    .map(({ id }) => id);
}
