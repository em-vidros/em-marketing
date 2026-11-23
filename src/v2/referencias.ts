import { and, desc, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import type { Pilar, ReferenciaParaGerar } from "../domain/art/pipeline";
import type { Arquivos } from "./arquivos";
import { q, type Banco } from "./banco";
import { referencias, type Referencia } from "./schema";

/** Lê as referências de uma geração de post. A tool gerar_3_artes recebe isto de fora, e os testes trocam. */
export type CarregarReferencias = (o: { pilar: Pilar; marcadas?: readonly string[] }) => Promise<ReferenciaParaGerar[]>;

/** Quantas gerações de post a rotação olha para não repetir referência. */
const GERACOES_QUE_A_ROTACAO_OLHA = 5;

/** O que importa de posts.arts para a rotação. Linhas de antes das referências não têm `referencia`. */
const UsadasNaGeracao = z.array(z.object({ referencia: z.string().nullish() }));

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

/** As referências de uma geração de post, na ordem da escolha, com a imagem em JPEG de até 1024 px. */
export async function referenciasParaGerar(
  { banco, arquivos }: { banco: Banco; arquivos: Arquivos },
  o: { pilar: Pilar; marcadas?: readonly string[]; n?: number },
): Promise<ReferenciaParaGerar[]> {
  const ativas = await listarReferencias(banco);
  const recentes = await referenciasDasUltimasGeracoes();
  const escolhidas = escolherReferencias({ ativas, recentes, marcadas: o.marcadas, pilar: o.pilar, n: o.n ?? 3 });

  const carregadas = await Promise.all(
    escolhidas
      .flatMap((id) => ativas.filter((r) => r.id === id))
      .map(async (r) => {
        const bytes = await arquivos.ler(r.arquivo);
        return bytes ? [{ id: r.id, leitura: r.leitura, imagem: await comoJpeg(bytes) }] : [];
      }),
  );

  return carregadas.flat();
}

async function referenciasDasUltimasGeracoes(): Promise<string[][]> {
  const linhas = await q<{ arts: string }>`SELECT arts FROM posts WHERE arts IS NOT NULL ORDER BY id DESC LIMIT ${GERACOES_QUE_A_ROTACAO_OLHA}`;
  return linhas.map((l) => {
    const lidas = UsadasNaGeracao.safeParse(JSON.parse(l.arts));
    return lidas.success ? lidas.data.flatMap((a) => a.referencia ?? []) : [];
  });
}

const comoJpeg = (bytes: Uint8Array) => sharp(bytes).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();

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
