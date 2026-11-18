import { join } from "node:path";
import { colunasDaFonte, db, fonteDa, isoDoSqlite, sqliteDe, urlDaMidia, type ColunasDaFonte, type Fonte, type Pilar, type StatusFila, type TipoMidia } from "../db";
import { cancelQueueItem, enqueue, type PecaDaFila } from "../domain/scheduler";
import type { Arquivos } from "../v2/arquivos";
import { pegarArte, type ResumoDaArte } from "../v2/artes";
import type { Banco } from "../v2/banco";
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

/** O que agendar uma arte usa: o banco e os arquivos do estúdio, e a pasta onde o JPEG espera a hora de sair. */
export interface EstudioDaFila {
  banco: Banco;
  arquivos: Arquivos;
  pasta: string;
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
function recusaSeOcupada(fonte: Fonte, midia: TipoMidia): RecusaDaFila | null {
  const ocupada = db
    .query(
      `SELECT 1 FROM queue WHERE post_id IS ?1 AND arte_id IS ?2 AND media_type = ?3 AND status IN ('pending', 'publishing')
       UNION ALL SELECT 1 FROM publicacoes WHERE post_id IS ?1 AND arte_id IS ?2 AND media_type = ?3 LIMIT 1`,
    )
    .get(...colunasDaFonte(fonte), midia);
  return ocupada ? recusa(409, `${nomeDa(fonte)} já tem ${NOME_DA_MIDIA[midia]} agendado ou publicado.`) : null;
}

/** Legenda só vai no feed. Sem legenda mandada, o feed leva a do post; mandada vazia, sai sem. */
function legendaDa(midia: TipoMidia, mandada: string | undefined, padrao: string | null): string | null {
  if (midia === "STORIES") return null;
  if (mandada === undefined) return padrao;
  return mandada || null;
}

/** Com a peça escolhida, a peça desta mídia e nada ativo nesta mídia. */
function pecaDoPost(post: EtapaPost | null, midia: TipoMidia, legenda?: string): { ok: true; postId: number; peca: PecaDaFila } | RecusaDaFila {
  const r = midiaParaPublicar(post, midia);
  if (!r.ok) return recusa(409, r.motivo);
  const { postId, path, legenda: doPost } = r.post;
  const fonte: Fonte = { tipo: "post", postId };

  return recusaSeOcupada(fonte, midia) ?? { ok: true, postId, peca: { fonte, midia, jpegPath: path, legenda: legendaDa(midia, legenda, doPost ?? null) } };
}

/** O único caminho de post para a fila. publicaEm em epoch ms. */
export function agendarPost(
  post: EtapaPost | null,
  midia: TipoMidia,
  publicaEm: number,
  legenda?: string,
  agora = Date.now(),
): { ok: true; filaId: number; postId: number } | RecusaDaFila {
  const pode = pecaDoPost(post, midia, legenda);
  if (!pode.ok) return pode;
  if (publicaEm <= agora) return NO_PASSADO;

  return { ok: true, filaId: enqueue(pode.peca, sqliteDe(publicaEm)), postId: pode.postId };
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
  const post = postPorId(fonte.postId);
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

  const jpegPath = join(estudio.pasta, `${crypto.randomUUID()}.jpg`);
  await Bun.write(jpegPath, await renderizarJpeg(arte.formato, cena, arte.camadas));

  // Conferido depois do render, sem await até gravar, para dois pedidos ao mesmo tempo não agendarem duas vezes.
  const fonte: Fonte = { tipo: "arte", arteId };
  const ocupada = recusaSeOcupada(fonte, midia);
  if (ocupada) return ocupada;

  return { ok: true, filaId: enqueue({ fonte, midia, jpegPath, legenda: legendaDa(midia, legenda, null) }, sqliteDe(publicaEm)) };
}

type LinhaDaFila = ColunasDaFonte & {
  media_type: TipoMidia;
  publish_at: string;
  status: StatusFila;
  /** Só o tick grava, quando a publicação falha. */
  error: string | null;
};

const linhaDaFila = (filaId: number) =>
  db.query("SELECT post_id, arte_id, media_type, publish_at, status, error FROM queue WHERE id = ?").get(filaId) as LinhaDaFila | null;

/** PATCH /api/fila/:id */
export interface Reagendado {
  item: ItemAgendado;
  /** O horário de antes, em epoch ms. Desfazer é mandar este valor no mesmo PATCH. */
  anterior: number;
}

/** Muda o horário de um agendamento pendente para um horário no futuro. Devolve o horário de antes. */
export function reagendar(filaId: number, publicaEm: number, agora = Date.now()): { ok: true; anterior: number } | RecusaDaFila {
  const linha = linhaDaFila(filaId);
  if (!linha) return NAO_ENCONTRADO;
  if (linha.status !== "pending") return recusa(409, `Só dá para mudar o horário de um agendamento pendente. Este está ${NOME_DO_STATUS[linha.status]}.`);
  if (publicaEm <= agora) return NO_PASSADO;
  db.query("UPDATE queue SET publish_at = ? WHERE id = ? AND status = 'pending'").run(sqliteDe(publicaEm), filaId);
  return { ok: true, anterior: Date.parse(isoDoSqlite(linha.publish_at)) };
}

/**
 * Cancelar de novo não muda nada. O pendente cancela e o que falhou é dispensado; o que está
 * saindo ou já saiu fica como está.
 */
export function cancelar(filaId: number): { ok: true } | RecusaDaFila {
  const linha = linhaDaFila(filaId);
  if (!linha) return NAO_ENCONTRADO;
  if (linha.status === "cancelled" || cancelQueueItem(filaId)) return { ok: true };
  if (db.query("UPDATE queue SET status = 'cancelled' WHERE id = ? AND status = 'failed'").run(filaId).changes > 0) return { ok: true };
  return recusa(409, `Só dá para cancelar um agendamento pendente ou com falha. Este está ${NOME_DO_STATUS[linha.status]}.`);
}

/** A linha já tem o JPEG: o post ainda precisa estar com a peça desta mídia, a arte não. */
function recusaParaVoltar(fonte: Fonte, midia: TipoMidia): RecusaDaFila | null {
  if (fonte.tipo === "arte") return recusaSeOcupada(fonte, midia);
  const pode = pecaDoPost(postPorId(fonte.postId), midia);
  return pode.ok ? null : pode;
}

/**
 * Desfaz o cancelar. Uma falha dispensada volta a ser falha, sem tentar de novo. Um pendente
 * cancelado volta enquanto o horário não passou, com as mesmas regras de agendar. Restaurar um
 * pendente não muda nada.
 */
export function restaurar(filaId: number, agora = Date.now()): { ok: true } | RecusaDaFila {
  const linha = linhaDaFila(filaId);
  if (!linha) return NAO_ENCONTRADO;
  if (linha.status === "cancelled" && linha.error !== null) {
    db.query("UPDATE queue SET status = 'failed' WHERE id = ? AND status = 'cancelled'").run(filaId);
    return { ok: true };
  }

  if (linha.status === "pending") return { ok: true };
  if (linha.status !== "cancelled") return recusa(409, `Só dá para restaurar um agendamento cancelado. Este está ${NOME_DO_STATUS[linha.status]}.`);
  if (Date.parse(isoDoSqlite(linha.publish_at)) <= agora) return recusa(400, "O horário deste agendamento já passou. Agende de novo com um horário no futuro.");
  const recusada = recusaParaVoltar(fonteDa(linha), linha.media_type);
  if (recusada) return recusada;

  db.query("UPDATE queue SET status = 'pending' WHERE id = ? AND status = 'cancelled'").run(filaId);
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
export function prontos(artes: readonly ResumoDaArte[]): Pronto[] {
  return [...artesProntas(artes), ...postsProntos()];
}

function artesProntas(artes: readonly ResumoDaArte[]): Pronto[] {
  return artes.flatMap((a): Pronto[] => {
    const midia = MIDIA_DO_FORMATO[a.formato];
    const fonte: Fonte = { tipo: "arte", arteId: a.id };
    return recusaSeOcupada(fonte, midia) ? [] : [{ fonte, titulo: a.titulo, capa: a.capa, pilar: null, midias: [midia], legenda: null }];
  });
}

function postsProntos(): Pronto[] {
  const ids = db.query("SELECT id FROM posts ORDER BY id DESC").all() as { id: number }[];
  return ids.flatMap(({ id }): Pronto[] => {
    const post = postPorId(id);
    if (!post || !("peca" in post)) return [];
    const midias = (["IMAGE", "STORIES"] as const).filter((m) => pecaDoPost(post, m).ok);
    if (midias.length === 0) return [];

    const { peca } = post;
    const headline = peca.origem === "gerada" ? peca.headline.headline : null;
    const legenda = post.etapa === "escolhida" ? null : post.legenda;
    return [{ fonte: { tipo: "post", postId: id }, titulo: tituloDoPost(headline, id), capa: urlDaMidia(peca.arte.path), pilar: post.brief.pilar, midias, legenda }];
  });
}
