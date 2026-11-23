import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Arquivos } from "./arquivos";
import type { Banco } from "./banco";
import { camadasIniciais, type Ajustes, type Camada, type Formato } from "./camadas";
import type { Ia } from "./ia";
import { escolherReferencias, listarReferencias } from "./referencias";
import { areasDosElementos, camadasDosElementos, remendar } from "./separar";
import { artes, type Arte } from "./schema";

export interface Estudio {
  banco: Banco;
  ia: Ia;
  arquivos: Arquivos;
}

/** Quantas referências entram em cada arte, e quantas artes recentes a escolha evita repetir. */
const REFERENCIAS_POR_ARTE = 3;
const ARTES_QUE_A_ROTACAO_OLHA = 5;

export const listarArtes = (banco: Banco) => banco.select().from(artes).orderBy(desc(artes.criadaEm)).limit(50);

/**
 * O pedido da arte que nasce de uma imagem de post (arteDaImagem). É a chave que reabre a mesma arte,
 * então o texto não pode mudar: as artes já abertas no editor guardam este formato.
 */
const PEDIDO_DE_IMAGEM = /^Post [0-9]+, (variação [0-9]+|story): /;

/**
 * Uma arte aberta de uma imagem de post tem o texto e o logo desenhados na cena. Enquanto ninguém mexeu nela,
 * o editor pede para separar esses elementos em camadas. Separada ou editada, `atualizadaEm` muda e ela sai daqui.
 */
export const separavel = (arte: Pick<Arte, "pedido" | "camadas" | "criadaEm" | "atualizadaEm">) =>
  PEDIDO_DE_IMAGEM.test(arte.pedido) && arte.camadas.length === 0 && arte.atualizadaEm.getTime() === arte.criadaEm.getTime();

export const pedidoDaImagem = (i: { postId: number; variante: number | null; path: string }) =>
  i.variante === null ? `Post ${i.postId}, story: ${i.path}` : `Post ${i.postId}, variação ${i.variante}: ${i.path}`;

/** As artes criadas direto no estúdio, sem as que nasceram de uma imagem de post: essas a Biblioteca já mostra pela imagem. */
export const artesDoEstudio = (banco: Banco) =>
  banco
    .select()
    .from(artes)
    .where(sql`${artes.pedido} !~ '^Post [0-9]+, (variação [0-9]+|story): '`)
    .orderBy(desc(artes.criadaEm));

/** O que o calendário e a fila mostram de uma arte. */
export interface ResumoDaArte {
  id: string;
  /** A primeira camada de texto, que é o título impresso na arte; sem texto, o pedido. */
  titulo: string;
  /** O PNG da arte como está agora, com a versão na query como em apiArtes.png. */
  capa: string;
  formato: Formato;
}

export function resumoDaArte(arte: Arte): ResumoDaArte {
  const texto = arte.camadas.find((c): c is Extract<Camada, { tipo: "texto" }> => c.tipo === "texto");
  return { id: arte.id, titulo: texto?.texto ?? arte.pedido, capa: `/api/artes/${arte.id}/png?v=${arte.atualizadaEm.getTime()}`, formato: arte.formato };
}

export async function resumosDasArtes(banco: Banco, ids: readonly string[]): Promise<Map<string, ResumoDaArte>> {
  if (ids.length === 0) return new Map();
  const achadas = await banco.select().from(artes).where(inArray(artes.id, [...ids]));
  return new Map(achadas.map((a) => [a.id, resumoDaArte(a)]));
}

export async function pegarArte(banco: Banco, id: string): Promise<Arte | null> {
  const [arte] = await banco.select().from(artes).where(eq(artes.id, id));
  return arte ?? null;
}

/** Escolhe as referências, pede o plano, gera a cena e grava a arte com as camadas de partida. */
export async function criarArte({ banco, ia, arquivos }: Estudio, pedido: { texto: string; formato: Formato; criadaPor: string }): Promise<Arte> {
  const ativas = await listarReferencias(banco);
  const recentes = await banco.select({ referencias: artes.referencias }).from(artes).orderBy(desc(artes.criadaEm)).limit(ARTES_QUE_A_ROTACAO_OLHA);
  const escolhidas = escolherReferencias({ ativas, recentes: recentes.map((a) => a.referencias) }).slice(0, REFERENCIAS_POR_ARTE);
  const leituras = escolhidas.map((id) => ativas.find((r) => r.id === id)!.leitura);
  const plano = await ia.planejarArte(pedido.texto, pedido.formato, leituras);
  const cena = await arquivos.salvar(await ia.gerarCena(plano.cena, pedido.formato), "jpg");
  const [arte] = await banco
    .insert(artes)
    .values({
      pedido: pedido.texto,
      formato: pedido.formato,
      cena,
      promptDaCena: plano.cena,
      referencias: escolhidas,
      camadas: camadasIniciais(pedido.formato, plano),
      criadaPor: pedido.criadaPor,
    })
    .returning();
  return arte!;
}

/**
 * Uma imagem pronta, como a arte de um post, vira arte do editor: a imagem é a cena e as camadas começam vazias.
 * O pedido identifica a origem, então abrir a mesma imagem de novo devolve a arte que já existe, com as edições.
 */
export async function arteDaImagem(
  { banco, arquivos }: Pick<Estudio, "banco" | "arquivos">,
  origem: { pedido: string; promptDaCena: string; formato: Formato; criadaPor: string; bytes: () => Promise<Uint8Array> },
): Promise<Arte> {
  const [existente] = await banco.select().from(artes).where(eq(artes.pedido, origem.pedido)).limit(1);
  if (existente) return existente;
  const cena = await arquivos.salvar(await origem.bytes(), "jpg");
  const { pedido, promptDaCena, formato, criadaPor } = origem;
  const [arte] = await banco.insert(artes).values({ pedido, formato, cena, promptDaCena, referencias: [], camadas: [], criadaPor }).returning();
  return arte!;
}

export type Edicao = { camadas: Camada[]; ajustes: Ajustes };

/** A arte ainda está na versão `base`. O banco guarda microssegundos e a Date do JS só milissegundos, por isso trunca. */
const naVersao = (base: Date) => sql`date_trunc('milliseconds', ${artes.atualizadaEm}) = ${base.toISOString()}::timestamptz`;

/**
 * Grava a edição. Com `base`, a versão que a pessoa estava editando, só grava se ninguém gravou
 * outra depois dela: duas pessoas na mesma arte não apagam o trabalho uma da outra em silêncio.
 */
export async function gravarEdicao(banco: Banco, id: string, edicao: Edicao, base?: Date): Promise<{ arte: Arte } | { conflito: Arte } | null> {
  const [arte] = await banco
    .update(artes)
    .set({ ...edicao, atualizadaEm: new Date() })
    .where(and(eq(artes.id, id), base && naVersao(base)))
    .returning();
  if (arte) return { arte };
  const atual = await pegarArte(banco, id);
  return atual ? { conflito: atual } : null;
}

/**
 * Tira o texto e o logo de dentro da cena e devolve cada um como camada. Lê os elementos, apaga as áreas deles
 * com o modelo de imagem e grava a cena limpa. Se a leitura não acha nada, só marca a arte como separada.
 */
export async function separarElementos({ banco, ia, arquivos }: Estudio, id: string): Promise<Arte | null> {
  const atual = await pegarArte(banco, id);
  if (!atual) return null;
  if (!separavel(atual)) return atual;
  const original = await arquivos.ler(atual.cena);
  if (!original) throw new Error("A imagem desta arte sumiu do armazenamento.");
  const elementos = await ia.lerElementos(original, atual.formato);
  const areas = areasDosElementos(elementos, atual.formato);
  const cena = areas.length ? await arquivos.salvar(await remendar(original, await ia.apagarAreas(original, atual.formato, areas), areas, atual.formato), "jpg") : atual.cena;
  const camadas = camadasDosElementos(elementos, atual.formato);
  const [arte] = await banco
    .update(artes)
    .set({ cena, camadas, atualizadaEm: new Date() })
    .where(and(eq(artes.id, id), naVersao(atual.atualizadaEm)))
    .returning();
  return arte ?? (await pegarArte(banco, id));
}

/** O botão "Nova cena": gera outra cena com o mesmo prompt e mantém as camadas. */
export async function novaCena({ banco, ia, arquivos }: Estudio, id: string): Promise<Arte | null> {
  const atual = await pegarArte(banco, id);
  if (!atual) return null;
  const cena = await arquivos.salvar(await ia.gerarCena(atual.promptDaCena, atual.formato), "jpg");
  const [arte] = await banco.update(artes).set({ cena, atualizadaEm: new Date() }).where(eq(artes.id, id)).returning();
  return arte!;
}
