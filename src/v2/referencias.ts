import { and, desc, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import type { Ancora, Pilar, ReferenciaParaGerar } from "../domain/art/pipeline";
import { TIPO_DA_EXTENSAO, type Arquivos, type Extensao } from "./arquivos";
import type { Ia } from "./ia";
import { q, type Banco } from "./banco";
import { referencias, type Referencia } from "./schema";

/** O que a pessoa escolheu no composer para o próximo pedido: ids de referências da Biblioteca e chaves de imagens coladas. */
export interface EscolhaDoPedido {
  marcadas: readonly string[];
  coladas: readonly string[];
}

/**
 * Lê as âncoras de uma geração de post: a escolha da pessoa primeiro, depois a rotação, até `n` (3 por padrão).
 * A tool gerar_3_artes recebe isto de fora, e os testes trocam.
 */
export type CarregarReferencias = (o: { pilar: Pilar; escolha?: EscolhaDoPedido; n?: number }) => Promise<ReferenciaParaGerar[]>;

/** O criada_por das referências que vieram dos posts reais da @emvidros, e não de alguém da equipe. */
export const CRIADA_PELA_CASA = "casa";

/** Quantas gerações de post a rotação olha para não repetir referência. */
const GERACOES_QUE_A_ROTACAO_OLHA = 5;

/** O que importa de posts.arts para a rotação: o id da referência que ancorou cada arte, em `ancora` ou, nas linhas antigas, em `referencia`. */
const UsadasNaGeracao = z.array(z.object({ ancora: z.object({ id: z.string().optional() }).nullish(), referencia: z.string().nullish() }));

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

/**
 * Guarda na Biblioteca uma imagem que já está nos arquivos, como a colada num pedido do chat, com o mesmo arquivo.
 * Guardar de novo devolve a mesma referência, e uma que foi removida volta sem a IA ler a imagem outra vez.
 * Null quando o arquivo não existe.
 */
export async function guardarNaBiblioteca(
  { banco, arquivos, ia }: { banco: Banco; arquivos: Arquivos; ia: Pick<Ia, "lerReferencia"> },
  arquivo: string,
  quem: string,
): Promise<Referencia | null> {
  const [existente] = await banco.select().from(referencias).where(eq(referencias.arquivo, arquivo)).orderBy(desc(referencias.criadaEm)).limit(1);
  if (existente) return existente.removidaEm ? restaurarReferencia(banco, existente.id) : existente;
  const bytes = await arquivos.ler(arquivo);
  if (!bytes) return null;
  const { leitura, pilares } = await ia.lerReferencia(bytes, TIPO_DA_EXTENSAO[arquivo.split(".").pop() as Extensao]);
  return criarReferencia(banco, { arquivo, leitura, pilares, criadaPor: quem });
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

type Ativa = Pick<Referencia, "id" | "pilares" | "criadaEm" | "criadaPor">;

/**
 * As âncoras de uma geração de post, na ordem de uso, com a imagem em JPEG de até 1024 px: as referências que a pessoa
 * marcou, as imagens que ela colou no pedido e, depois, a rotação da Biblioteca.
 * Uma imagem sem arquivo ou que não abre fica de fora, e a próxima da fila entra no lugar dela.
 */
export async function referenciasParaGerar(
  { banco, arquivos }: { banco: Banco; arquivos: Arquivos },
  o: { pilar: Pilar; escolha?: EscolhaDoPedido; n?: number },
): Promise<ReferenciaParaGerar[]> {
  const n = o.n ?? 3;
  const marcadas = o.escolha?.marcadas ?? [];
  const ativas = await listarReferencias(banco);
  const fila = escolherReferencias({ ativas, recentes: await referenciasDasUltimasGeracoes(), marcadas, pilar: o.pilar });
  const daBiblioteca = (r: Referencia): Ancora => ({ origem: "biblioteca", id: r.id, arquivo: r.arquivo, leitura: r.leitura });
  const escolhidas = fila.filter((r) => marcadas.includes(r.id)).length;
  const candidatas: Ancora[] = [
    ...fila.slice(0, escolhidas).map(daBiblioteca),
    ...(o.escolha?.coladas ?? []).map((arquivo): Ancora => ({ origem: "pedido", arquivo })),
    ...fila.slice(escolhidas).map(daBiblioteca),
  ];

  const carregadas: ReferenciaParaGerar[] = [];
  for (const ancora of candidatas) {
    if (carregadas.length === n) break;
    try {
      const bytes = await arquivos.ler(ancora.arquivo);
      if (!bytes) throw new Error(`arquivo ${ancora.arquivo} não existe`);
      carregadas.push({ ...ancora, imagem: await comoJpeg(bytes) });
    } catch (erro) {
      console.error(`referenciasParaGerar: ${ancora.origem === "biblioteca" ? `a referência ${ancora.id}` : `a imagem ${ancora.arquivo}`} ficou de fora`, erro);
    }
  }
  return carregadas;
}

async function referenciasDasUltimasGeracoes(): Promise<string[][]> {
  const linhas = await q<{ arts: string }>`SELECT arts FROM posts WHERE arts IS NOT NULL ORDER BY id DESC LIMIT ${GERACOES_QUE_A_ROTACAO_OLHA}`;
  return linhas.map((l) => {
    const lidas = UsadasNaGeracao.safeParse(JSON.parse(l.arts));
    return lidas.success ? lidas.data.flatMap((a) => a.ancora?.id ?? a.referencia ?? []) : [];
  });
}

/** O JPEG não tem transparência: sem o fundo off-white da marca, a área transparente de um PNG sairia preta. */
const comoJpeg = (bytes: Uint8Array) => sharp(bytes).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#F0EFEA" }).jpeg({ quality: 85 }).toBuffer();

/**
 * Põe as referências na ordem de uso de uma geração nova: as marcadas pela pessoa; sem marcadas, a mais nova que a
 * equipe subiu; depois as livres do pilar, as outras livres e, por fim, as usadas há mais tempo.
 * Livre é a que nenhuma das gerações em `recentes` usou. `recentes` vem da geração mais nova para a mais velha.
 * Referência sem pilar serve a todos. As da casa nunca ocupam o lugar da mais nova: sem nada da equipe, só há rotação.
 */
export function escolherReferencias<R extends Ativa>(o: {
  ativas: readonly R[];
  marcadas?: readonly string[];
  recentes: readonly (readonly string[])[];
  pilar?: Pilar;
  sortear?: () => number;
}): R[] {
  const { ativas, recentes, pilar, sortear = Math.random } = o;
  const porId = new Map(ativas.map((r) => [r.id, r]));
  const marcadas = (o.marcadas ?? []).flatMap((id) => porId.get(id) ?? []);
  const maisNovaDaEquipe = ativas
    .filter((r) => r.criadaPor !== CRIADA_PELA_CASA)
    .toSorted((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())
    .slice(0, 1);
  const fixas = marcadas.length > 0 ? marcadas : maisNovaDaEquipe;

  const ultimoUso = new Map<string, number>();
  recentes.forEach((usadas, idade) => usadas.forEach((id) => ultimoUso.has(id) || ultimoUso.set(id, idade)));
  const usadasDaMaisVelha = [...ultimoUso].sort(([, a], [, b]) => b - a).flatMap(([id]) => porId.get(id) ?? []);

  const livres = ativas.filter((r) => !ultimoUso.has(r.id));
  const ehDoPilar = (r: R) => pilar !== undefined && (r.pilares.length === 0 || r.pilares.includes(pilar));
  const livresDoPilar = embaralhar(livres.filter(ehDoPilar), sortear);
  const outrasLivres = embaralhar(livres.filter((r) => !ehDoPilar(r)), sortear);

  return [...new Set([...fixas, ...livresDoPilar, ...outrasLivres, ...usadasDaMaisVelha])];
}

function embaralhar<R>(referencias: readonly R[], sortear: () => number): R[] {
  return referencias
    .map((r) => ({ r, ordem: sortear() }))
    .sort((a, b) => a.ordem - b.ordem)
    .map(({ r }) => r);
}
