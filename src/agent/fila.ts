import { gravarArquivo } from "../armazem";
import { colunasDaFonte, emOrdem, fonteDa, isoDoUtc, primeira, utcDe, urlDaMidia, type ColunasDaFonte, type Fonte, type Pilar, type StatusFila, type TipoMidia } from "../db";
import { cancelQueueItem, enqueue, type PecaDaFila } from "../domain/scheduler";
import type { Arquivos } from "../v2/arquivos";
import { pegarArte, type ResumoDaArte } from "../v2/artes";
import { q, transacao, type Banco } from "../v2/banco";
import type { Formato } from "../v2/camadas";
import { renderizarJpeg } from "../v2/render";
import { tituloDoPost, type ItemAgendado } from "./calendario";
import { midiaParaPublicar, postPorId, type EtapaPost } from "./post";

/**
 * As regras da fila de publicação, as mesmas para o agendar_publicacao do Chefe e para a tela de
 * calendário. A tool chega aqui depois da aprovação humana; na tela, a ação da pessoa é a aprovação.
 * Cada linha fixa no agendamento o JPEG e a legenda que vão sair.
 */

/** 400 é um pedido que não vale em estado nenhum, 404 é linha que não existe, 409 é o estado atual que impede. */
export type RecusaDaFila = { ok: false; status: 400 | 404 | 409; motivo: string };

const recusa = (status: RecusaDaFila["status"], motivo: string): RecusaDaFila => ({ ok: false, status, motivo });

const NAO_ENCONTRADO = recusa(404, "Agendamento não encontrado.");
const NO_PASSADO = recusa(400, "Esse horário já passou. Escolha um horário no futuro.");

/** O que agendar uma arte usa: o banco e os arquivos do estúdio. O JPEG que espera a hora de sair vai para o armazém (src/armazem.ts). */
export interface EstudioDaFila {
  banco: Banco;
  arquivos: Arquivos;
}

/** Feed é 4:5 e vai como IMAGE; story é 9:16 e vai como STORIES. */
export const MIDIA_DO_FORMATO: Record<Formato, TipoMidia> = { feed: "IMAGE", story: "STORIES" };

const NOME_DA_MIDIA: Record<TipoMidia, string> = { IMAGE: "feed", STORIES: "stories" };

const NOME_DO_STATUS: Record<StatusFila, string> = {
  pending: "pendente",
  publishing: "sendo publicado agora",
  done: "já publicado",
  failed: "com falha na publicação",
  cancelled: "cancelado",
};

const nomeDa = (f: Fonte) => (f.tipo === "post" ? `O post ${f.postId}` : "Esta arte");

/** Outro agendamento ativo ou uma publicação desta mídia. Falha ou cancelado não conta: agendar de novo é o jeito de tentar outra vez. */
async function recusaSeOcupada(fonte: Fonte, midia: TipoMidia): Promise<RecusaDaFila | null> {
  const [postId, arteId] = colunasDaFonte(fonte);
  const ocupada = await q`SELECT 1 FROM queue WHERE post_id IS NOT DISTINCT FROM ${postId}::int AND arte_id IS NOT DISTINCT FROM ${arteId}::text
      AND media_type = ${midia} AND status IN ('pending', 'publishing')
    UNION ALL SELECT 1 FROM publicacoes WHERE post_id IS NOT DISTINCT FROM ${postId}::int AND arte_id IS NOT DISTINCT FROM ${arteId}::text
      AND media_type = ${midia} LIMIT 1`;
  return ocupada.length ? recusa(409, `${nomeDa(fonte)} já tem ${NOME_DA_MIDIA[midia]} agendado ou publicado.`) : null;
}

/**
 * Confere de novo e grava numa transação só, sob uma trava da fila: dois pedidos ao mesmo tempo,
 * no mesmo servidor ou em dois, não agendam a mesma mídia duas vezes.
 */
function enfileirarSeLivre(peca: PecaDaFila, publicaEm: number): Promise<{ ok: true; filaId: number } | RecusaDaFila> {
  return transacao(async () => {
    await q`SELECT pg_advisory_xact_lock(4208)`;
    const ocupada = await recusaSeOcupada(peca.fonte, peca.midia);
    return ocupada ?? { ok: true, filaId: await enqueue(peca, utcDe(publicaEm)) };
  });
}

/** Legenda só vai no feed. Sem legenda mandada, o feed leva a do post; mandada vazia, sai sem. */
function legendaDa(midia: TipoMidia, mandada: string | undefined, padrao: string | null): string | null {
  if (midia === "STORIES") return null;
  if (mandada === undefined) return padrao;
  return mandada || null;
}

/** Com a peça escolhida, a peça desta mídia e nada ativo nesta mídia. */
async function pecaDoPost(post: EtapaPost | null, midia: TipoMidia, legenda?: string): Promise<{ ok: true; postId: number; peca: PecaDaFila } | RecusaDaFila> {
  const r = midiaParaPublicar(post, midia);
  if (!r.ok) return recusa(409, r.motivo);
  const { postId, path, legenda: doPost } = r.post;
  const fonte: Fonte = { tipo: "post", postId };

  return (await recusaSeOcupada(fonte, midia)) ?? { ok: true, postId, peca: { fonte, midia, jpegPath: path, legenda: legendaDa(midia, legenda, doPost ?? null) } };
}

/** O único caminho de post para a fila. publicaEm em epoch ms. */
export async function agendarPost(
  post: EtapaPost | null,
  midia: TipoMidia,
  publicaEm: number,
  legenda?: string,
  agora = Date.now(),
): Promise<{ ok: true; filaId: number; postId: number } | RecusaDaFila> {
  const pode = await pecaDoPost(post, midia, legenda);
  if (!pode.ok) return pode;
  if (publicaEm <= agora) return NO_PASSADO;

  const r = await enfileirarSeLivre(pode.peca, publicaEm);
  return r.ok ? { ...r, postId: pode.postId } : r;
}

/** POST /api/fila */
export interface PedidoDeAgendamento {
  fonte: Fonte;
  midia: TipoMidia;
  /** epoch ms */
  publicaEm: number;
  legenda?: string;
}

export async function agendar(estudio: EstudioDaFila, { fonte, midia, publicaEm, legenda }: PedidoDeAgendamento): Promise<{ ok: true; filaId: number } | RecusaDaFila> {
  if (fonte.tipo === "arte") return agendarArte(estudio, fonte.arteId, midia, publicaEm, legenda);
  const post = await postPorId(fonte.postId);
  return post ? agendarPost(post, midia, publicaEm, legenda) : recusa(404, "Post não encontrado.");
}

/**
 * Renderiza a arte agora e fixa o JPEG na fila: o que sai é o que estava na tela ao agendar, mesmo
 * que a arte mude depois. A mídia vem do formato da arte.
 */
async function agendarArte(
  estudio: EstudioDaFila,
  arteId: string,
  midia: TipoMidia,
  publicaEm: number,
  legenda?: string,
  agora = Date.now(),
): Promise<{ ok: true; filaId: number } | RecusaDaFila> {
  const arte = await pegarArte(estudio.banco, arteId);
  if (!arte) return recusa(404, "Arte não encontrada.");
  const daArte = MIDIA_DO_FORMATO[arte.formato];
  if (midia !== daArte) return recusa(409, `Esta arte é de ${arte.formato}, então só vai para o ${NOME_DA_MIDIA[daArte]}.`);
  if (publicaEm <= agora) return NO_PASSADO;

  const cena = await estudio.arquivos.ler(arte.cena);
  if (!cena) return recusa(409, "A cena desta arte sumiu dos arquivos. Gere uma cena nova em Artes e agende de novo.");
  // Confere antes de renderizar para não gravar um JPEG que ninguém vai publicar; enfileirarSeLivre confere de novo.
  const fonte: Fonte = { tipo: "arte", arteId };
  const ocupada = await recusaSeOcupada(fonte, midia);
  if (ocupada) return ocupada;

  const jpegPath = await gravarArquivo("fila", `${crypto.randomUUID()}.jpg`, await renderizarJpeg(arte, cena, (c) => estudio.arquivos.ler(c)), "image/jpeg");
  return enfileirarSeLivre({ fonte, midia, jpegPath, legenda: legendaDa(midia, legenda, null) }, publicaEm);
}

type LinhaDaFila = ColunasDaFonte & {
  media_type: TipoMidia;
  publish_at: string;
  status: StatusFila;
  /** Só o tick grava, quando a publicação falha. */
  error: string | null;
};

const linhaDaFila = (filaId: number) =>
  primeira(q<LinhaDaFila>`SELECT post_id, arte_id, media_type, publish_at, status, error FROM queue WHERE id = ${filaId}`);

/** PATCH /api/fila/:id */
export interface Reagendado {
  item: ItemAgendado;
  /** O horário de antes, em epoch ms. Desfazer é mandar este valor no mesmo PATCH. */
  anterior: number;
}

/** Muda o horário de um agendamento pendente para um horário no futuro. Devolve o horário de antes. */
export async function reagendar(filaId: number, publicaEm: number, agora = Date.now()): Promise<{ ok: true; anterior: number } | RecusaDaFila> {
  const linha = await linhaDaFila(filaId);
  if (!linha) return NAO_ENCONTRADO;
  if (linha.status !== "pending") return recusa(409, `Só dá para mudar o horário de um agendamento pendente. Este está ${NOME_DO_STATUS[linha.status]}.`);
  if (publicaEm <= agora) return NO_PASSADO;
  await q`UPDATE queue SET publish_at = ${utcDe(publicaEm)} WHERE id = ${filaId} AND status = 'pending'`;
  return { ok: true, anterior: Date.parse(isoDoUtc(linha.publish_at)) };
}

/**
 * Cancelar de novo não muda nada. O pendente cancela e o que falhou é dispensado; o que está
 * saindo ou já saiu fica como está.
 */
export async function cancelar(filaId: number): Promise<{ ok: true } | RecusaDaFila> {
  const linha = await linhaDaFila(filaId);
  if (!linha) return NAO_ENCONTRADO;
  if (linha.status === "cancelled" || (await cancelQueueItem(filaId))) return { ok: true };
  if ((await q`UPDATE queue SET status = 'cancelled' WHERE id = ${filaId} AND status = 'failed' RETURNING id`).length > 0) return { ok: true };
  return recusa(409, `Só dá para cancelar um agendamento pendente ou com falha. Este está ${NOME_DO_STATUS[linha.status]}.`);
}

/** A linha já tem o JPEG: o post ainda precisa estar com a peça desta mídia, a arte não. */
async function recusaParaVoltar(fonte: Fonte, midia: TipoMidia): Promise<RecusaDaFila | null> {
  if (fonte.tipo === "arte") return recusaSeOcupada(fonte, midia);
  const pode = await pecaDoPost(await postPorId(fonte.postId), midia);
  return pode.ok ? null : pode;
}

/**
 * Desfaz o cancelar. Uma falha dispensada volta a ser falha, sem tentar de novo. Um pendente
 * cancelado volta enquanto o horário não passou, com as mesmas regras de agendar. Restaurar um
 * pendente não muda nada.
 */
export async function restaurar(filaId: number, agora = Date.now()): Promise<{ ok: true } | RecusaDaFila> {
  const linha = await linhaDaFila(filaId);
  if (!linha) return NAO_ENCONTRADO;
  if (linha.status === "cancelled" && linha.error !== null) {
    await q`UPDATE queue SET status = 'failed' WHERE id = ${filaId} AND status = 'cancelled'`;
    return { ok: true };
  }

  if (linha.status === "pending") return { ok: true };
  if (linha.status !== "cancelled") return recusa(409, `Só dá para restaurar um agendamento cancelado. Este está ${NOME_DO_STATUS[linha.status]}.`);
  if (Date.parse(isoDoUtc(linha.publish_at)) <= agora) return recusa(400, "O horário deste agendamento já passou. Agende de novo com um horário no futuro.");
  const recusada = await recusaParaVoltar(fonteDa(linha), linha.media_type);
  if (recusada) return recusada;

  await q`UPDATE queue SET status = 'pending' WHERE id = ${filaId} AND status = 'cancelled'`;
  return { ok: true };
}

/** GET /api/prontos: o que dá para agendar agora, de qualquer fonte, e em quais mídias. */
export interface Pronto {
  fonte: Fonte;
  titulo: string;
  capa: string;
  /** Arte do estúdio não tem pilar. */
  pilar: Pilar | null;
  midias: TipoMidia[];
  /** A legenda que o feed leva se nada for mandado: a do post; arte não tem. */
  legenda: string | null;
}

/** As artes vêm do Postgres do estúdio, lidas por quem chama; as artes primeiro, que é onde o trabalho novo está. */
export async function prontos(artes: readonly ResumoDaArte[]): Promise<Pronto[]> {
  return [...(await artesProntas(artes)), ...(await postsProntos())];
}

async function artesProntas(artes: readonly ResumoDaArte[]): Promise<Pronto[]> {
  const porArte = await Promise.all(
    artes.map(async (a): Promise<Pronto[]> => {
      const midia = MIDIA_DO_FORMATO[a.formato];
      const fonte: Fonte = { tipo: "arte", arteId: a.id };
      return (await recusaSeOcupada(fonte, midia)) ? [] : [{ fonte, titulo: a.titulo, capa: a.capa, pilar: null, midias: [midia], legenda: null }];
    }),
  );
  return porArte.flat();
}

async function postsProntos(): Promise<Pronto[]> {
  const ids = await q<{ id: number }>`SELECT id FROM posts ORDER BY id DESC`;
  const porPost = await emOrdem(ids, async ({ id }): Promise<Pronto[]> => {
    const post = await postPorId(id);
    if (!post || !("peca" in post)) return [];
    const midias: TipoMidia[] = [];
    for (const m of ["IMAGE", "STORIES"] as const) if ((await pecaDoPost(post, m)).ok) midias.push(m);
    if (midias.length === 0) return [];

    const { peca } = post;
    const headline = peca.origem === "gerada" ? peca.headline.headline : null;
    const legenda = post.etapa === "escolhida" ? null : post.legenda;
    return [{ fonte: { tipo: "post", postId: id }, titulo: tituloDoPost(headline, id), capa: await urlDaMidia(peca.arte.path), pilar: post.brief.pilar, midias, legenda }];
  });
  return porPost.flat();
}
