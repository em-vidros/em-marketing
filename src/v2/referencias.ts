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

/** As leituras de até `n` referências sorteadas, para o gerador do Chefe seguir os princípios delas. */
export async function leiturasParaInspirar(banco: Banco, n = 3): Promise<string[]> {
  const ativas = await listarReferencias(banco);
  return escolherReferencias(
    ativas.map((r) => r.id),
    [],
    n,
  ).map((id) => ativas.find((r) => r.id === id)!.leitura);
}

/**
 * Escolhe `n` referências para uma arte nova, fugindo das que as últimas artes usaram.
 * `recentes` vem da arte mais nova para a mais velha. Sem referências livres suficientes,
 * completa com as usadas há mais tempo.
 */
export function escolherReferencias(ativas: string[], recentes: string[][], n: number, sortear: () => number = Math.random): string[] {
  const ultimoUso = new Map<string, number>();
  recentes.forEach((usadas, idade) => usadas.forEach((id) => ultimoUso.has(id) || ultimoUso.set(id, idade)));
  const livres = ativas.filter((id) => !ultimoUso.has(id));
  const embaralhadas = livres
    .map((id) => ({ id, ordem: sortear() }))
    .sort((a, b) => a.ordem - b.ordem)
    .map(({ id }) => id);
  const usadasDaMaisVelha = ativas.filter((id) => ultimoUso.has(id)).sort((a, b) => ultimoUso.get(b)! - ultimoUso.get(a)!);
  return [...embaralhadas, ...usadasDaMaisVelha].slice(0, n);
}
