import { db, isoDoSqlite, sqliteDe, urlDaMidia, type Pilar, type StatusFila, type TipoMidia } from "../db";
import { cancelQueueItem, enqueue } from "../domain/scheduler";
import { agendadoPorId, type ItemAgendado } from "./calendario";
import { midiaParaPublicar, postPorId, type EtapaPost } from "./post";

/**
 * As regras da fila de publicação, as mesmas para o agendar_publicacao do Chefe e para a tela de
 * calendário. A tool chega aqui depois da aprovação humana; na tela, a ação da pessoa é a aprovação.
 */

/** 400 é um pedido que não vale em estado nenhum, 404 é linha que não existe, 409 é o estado atual que impede. */
export type RecusaDaFila = { ok: false; status: 400 | 404 | 409; motivo: string };

const recusa = (status: RecusaDaFila["status"], motivo: string): RecusaDaFila => ({ ok: false, status, motivo });

const NAO_ENCONTRADO = recusa(404, "Agendamento não encontrado.");
const NO_PASSADO = recusa(400, "Esse horário já passou. Escolha um horário no futuro.");

const NOME_DA_MIDIA: Record<TipoMidia, string> = { IMAGE: "feed", STORIES: "stories" };

const NOME_DO_STATUS: Record<StatusFila, string> = {
  pending: "pendente",
  publishing: "sendo publicado agora",
  done: "já publicado",
  failed: "com falha na publicação",
  cancelled: "cancelado",
};

/**
 * Registrado no Linear, com a peça desta mídia, e sem outro agendamento ativo nem publicação desta
 * mídia. Agendamento com falha ou cancelado não conta: agendar de novo é o jeito de tentar outra vez.
 */
export function podeAgendar(post: EtapaPost | null, midia: TipoMidia): { ok: true; postId: number } | RecusaDaFila {
  const r = midiaParaPublicar(post, midia);
  if (!r.ok) return recusa(409, r.motivo);
  const { postId } = r.post;
  const ocupado = db
    .query(
      `SELECT 1 FROM queue WHERE post_id = ?1 AND media_type = ?2 AND status IN ('pending', 'publishing')
       UNION ALL SELECT 1 FROM publicacoes WHERE post_id = ?1 AND media_type = ?2 LIMIT 1`,
    )
    .get(postId, midia);
  if (ocupado) return recusa(409, `O post ${postId} já tem ${NOME_DA_MIDIA[midia]} agendado ou publicado.`);
  return { ok: true, postId };
}

/** O único caminho que grava na fila. publicaEm em epoch ms. */
export function agendar(post: EtapaPost | null, midia: TipoMidia, publicaEm: number, agora = Date.now()): { ok: true; filaId: number; postId: number } | RecusaDaFila {
  const pode = podeAgendar(post, midia);
  if (!pode.ok) return pode;
  if (publicaEm <= agora) return NO_PASSADO;
  return { ok: true, filaId: enqueue(pode.postId, midia, sqliteDe(publicaEm)), postId: pode.postId };
}

interface LinhaDaFila {
  post_id: number;
  media_type: TipoMidia;
  publish_at: string;
  status: StatusFila;
  /** Só o tick grava, quando a publicação falha. */
  error: string | null;
}

const linhaDaFila = (filaId: number) =>
  db.query("SELECT post_id, media_type, publish_at, status, error FROM queue WHERE id = ?").get(filaId) as LinhaDaFila | null;

/** PATCH /api/fila/:id */
export interface Reagendado {
  item: ItemAgendado;
  /** O horário de antes, em epoch ms. Desfazer é mandar este valor no mesmo PATCH. */
  anterior: number;
}

/** Muda o horário de um agendamento pendente para um horário no futuro. */
export function reagendar(filaId: number, publicaEm: number, agora = Date.now()): ({ ok: true } & Reagendado) | RecusaDaFila {
  const linha = linhaDaFila(filaId);
  if (!linha) return NAO_ENCONTRADO;
  if (linha.status !== "pending") return recusa(409, `Só dá para mudar o horário de um agendamento pendente. Este está ${NOME_DO_STATUS[linha.status]}.`);
  if (publicaEm <= agora) return NO_PASSADO;
  db.query("UPDATE queue SET publish_at = ? WHERE id = ? AND status = 'pending'").run(sqliteDe(publicaEm), filaId);
  return { ok: true, item: agendadoPorId(filaId)!, anterior: Date.parse(isoDoSqlite(linha.publish_at)) };
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

/**
 * Desfaz o cancelar. Uma falha dispensada volta a ser falha, sem tentar de novo. Um pendente
 * cancelado volta enquanto o horário não passou, com as mesmas regras de agendar. Restaurar um
 * pendente não muda nada.
 */
export function restaurar(filaId: number, agora = Date.now()): { ok: true; item: ItemAgendado } | RecusaDaFila {
  const linha = linhaDaFila(filaId);
  if (!linha) return NAO_ENCONTRADO;
  if (linha.status === "cancelled" && linha.error !== null) {
    db.query("UPDATE queue SET status = 'failed' WHERE id = ? AND status = 'cancelled'").run(filaId);
    return { ok: true, item: agendadoPorId(filaId)! };
  }
  if (linha.status !== "pending") {
    if (linha.status !== "cancelled") return recusa(409, `Só dá para restaurar um agendamento cancelado. Este está ${NOME_DO_STATUS[linha.status]}.`);
    if (Date.parse(isoDoSqlite(linha.publish_at)) <= agora) return recusa(400, "O horário deste agendamento já passou. Agende de novo com um horário no futuro.");
    const pode = podeAgendar(postPorId(linha.post_id), linha.media_type);
    if (!pode.ok) return pode;
    db.query("UPDATE queue SET status = 'pending' WHERE id = ? AND status = 'cancelled'").run(filaId);
  }
  return { ok: true, item: agendadoPorId(filaId)! };
}

/** GET /api/posts/prontos: um post que o Chefe poderia agendar agora, e em quais mídias. */
export interface PostPronto {
  postId: number;
  headline: string | null;
  pilar: Pilar;
  capa: string;
  midias: TipoMidia[];
}

export function postsProntos(): PostPronto[] {
  const ids = db.query("SELECT id FROM posts WHERE linear_issue_id IS NOT NULL ORDER BY id DESC").all() as { id: number }[];
  return ids.flatMap(({ id }) => {
    const post = postPorId(id);
    if (post?.etapa !== "registrado") return [];
    const midias = (["IMAGE", "STORIES"] as const).filter((m) => podeAgendar(post, m).ok);
    if (midias.length === 0) return [];
    const { peca } = post;
    return [{ postId: id, headline: peca.origem === "gerada" ? peca.headline.headline : null, pilar: post.brief.pilar, capa: urlDaMidia(peca.arte.path), midias }];
  });
}
