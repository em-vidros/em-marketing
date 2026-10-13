import { capaDo, db, headlineDo, isoDoSqlite, sqliteDe, type ColunasDoPost, type Pilar, type TipoMidia } from "../db";
import { datasEntre } from "../domain/scheduler/calendar";
import { abrirConversaDoUsuario, mensagensDaConversa } from "./conversas";

/**
 * O que a tela de calendário mostra (.specs/project/CALENDARIO.md). Cada tipo vem de uma fonte
 * e tem as próprias regras de edição: pauta é desta tabela, agendado é a fila, publicado é
 * publicacoes, data é o calendário editorial (só leitura).
 */

/** AAAA-MM-DD em America/Sao_Paulo. */
export type Dia = `${number}-${number}-${number}`;

export interface ItemPauta {
  tipo: "pauta";
  id: number;
  dia: Dia;
  /** HH:MM; null é o dia inteiro. */
  hora: string | null;
  titulo: string;
  pilar: Pilar | null;
  nota: string;
  /** A conversa com o Chefe desta pauta, só se for do usuário que lê e estiver viva. */
  conversaId: string | null;
}

export type StatusAgendado = "pending" | "publishing" | "failed";

export interface ItemAgendado {
  tipo: "agendado";
  filaId: number;
  postId: number;
  /** epoch ms */
  publicaEm: number;
  midia: TipoMidia;
  headline: string | null;
  pilar: Pilar | null;
  capa: string | null;
  status: StatusAgendado;
  /** O erro da Meta quando status é failed. */
  erro: string | null;
}

export interface ItemPublicado {
  tipo: "publicado";
  publicacaoId: number;
  postId: number;
  /** epoch ms */
  publicadoEm: number;
  midia: TipoMidia;
  headline: string | null;
  pilar: Pilar | null;
  capa: string | null;
  link: string | null;
}

export interface ItemData {
  tipo: "data";
  dia: Dia;
  nome: string;
}

export type ItemCalendario = ItemPauta | ItemAgendado | ItemPublicado | ItemData;

/** A janela maior que GET /api/calendario aceita, em dias. O mês da tela mostra 42. */
export const JANELA_MAXIMA = 62;

const DIA_MS = 86_400_000;

/** Um dia que existe no calendário: 2026-02-30 não passa. */
export function ehDia(s: string): s is Dia {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
}

/** Meia-noite do dia em São Paulo, em epoch ms. O Brasil não tem horário de verão desde 2019. */
export const inicioDoDiaSP = (dia: Dia) => Date.parse(`${dia}T00:00:00-03:00`);

/** Quantos dias de `de` a `ate`, contando os dois. */
export const diasNaJanela = (de: Dia, ate: Dia) => Math.round((inicioDoDiaSP(ate) - inicioDoDiaSP(de)) / DIA_MS) + 1;

// --- pautas ---

interface LinhaPauta {
  id: number;
  dia: Dia;
  hora: string | null;
  titulo: string;
  pilar: Pilar | null;
  nota: string;
  conversa_id: string | null;
}

/** conversa_id só sai para o dono da conversa, e só se ela não foi apagada. O primeiro ? é o usuário. */
const COLUNAS_PAUTA = `id, dia, hora, titulo, pilar, nota,
  (SELECT c.id FROM conversas c WHERE c.id = pautas.conversa_id AND c.user_id = ? AND c.apagada_em IS NULL) AS conversa_id`;

const daPauta = (r: LinhaPauta): ItemPauta => ({
  tipo: "pauta",
  id: r.id,
  dia: r.dia,
  hora: r.hora,
  titulo: r.titulo,
  pilar: r.pilar,
  nota: r.nota,
  conversaId: r.conversa_id,
});

export interface NovaPauta {
  dia: Dia;
  hora: string | null;
  titulo: string;
  pilar: Pilar | null;
  nota: string;
}

/** Só a pauta viva. A apagada some de todas as rotas até ser restaurada. */
export function pautaPorId(userId: string, id: number): ItemPauta | null {
  const r = db.query(`SELECT ${COLUNAS_PAUTA} FROM pautas WHERE id = ? AND apagada_em IS NULL`).get(userId, id) as LinhaPauta | null;
  return r ? daPauta(r) : null;
}

export function criarPauta(userId: string, p: NovaPauta): ItemPauta {
  const agora = Date.now();
  const { id } = db
    .query("INSERT INTO pautas (dia, hora, titulo, pilar, nota, criada_por, criada_em, atualizada_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .get(p.dia, p.hora, p.titulo, p.pilar, p.nota, userId, agora, agora) as { id: number };
  return pautaPorId(userId, id)!;
}

/** Só os campos mandados mudam; hora e pilar aceitam null para limpar. */
export function mudarPauta(userId: string, id: number, mudanca: Partial<NovaPauta>): ItemPauta | null {
  if (!pautaPorId(userId, id)) return null;
  const campos = Object.entries(mudanca).filter(([, v]) => v !== undefined);
  db.query(`UPDATE pautas SET ${campos.map(([k]) => `${k} = ?, `).join("")}atualizada_em = ? WHERE id = ?`).run(
    ...campos.map(([, v]) => v as string | null),
    Date.now(),
    id,
  );
  return pautaPorId(userId, id);
}

/** Apagar de novo mantém a data da primeira vez. false se a pauta não existe. */
export function apagarPauta(id: number): boolean {
  return db.query("UPDATE pautas SET apagada_em = COALESCE(apagada_em, ?) WHERE id = ?").run(Date.now(), id).changes > 0;
}

export function restaurarPauta(userId: string, id: number): ItemPauta | null {
  db.query("UPDATE pautas SET apagada_em = NULL WHERE id = ?").run(id);
  return pautaPorId(userId, id);
}

const DATA_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** A primeira mensagem que a tela manda ao Chefe na conversa da pauta. */
export function pedidoDaPauta(p: ItemPauta): string {
  const quando = `${DATA_POR_EXTENSO.format(Date.parse(`${p.dia}T12:00:00Z`))}${p.hora ? `, às ${p.hora}` : ""}`;
  return [
    `Vamos criar o post da pauta "${p.titulo}", marcada no calendário para ${quando}.`,
    p.pilar && `Pilar: ${p.pilar}.`,
    p.nota.trim() && `Nota da pauta: ${p.nota.trim()}`,
    "Monte o brief comigo e me mostre antes de gerar.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** POST /api/pautas/:id/conversa */
export interface ConversaDaPauta {
  conversaId: string;
  pedido: string;
  /** true enquanto a conversa não tem mensagem: a tela só manda o pedido nesse caso. */
  vazia: boolean;
}

/**
 * A conversa do usuário com o Chefe para esta pauta. Repetir devolve a mesma enquanto ela estiver viva.
 * A pauta é da equipe e a conversa é de uma pessoa: se a ligada é de outro usuário ou foi apagada,
 * abre uma nova e a pauta passa a apontar para ela.
 */
export const conversaDaPauta = db.transaction((userId: string, id: number): ConversaDaPauta | null => {
  const pauta = pautaPorId(userId, id);
  if (!pauta) return null;
  let conversaId = pauta.conversaId;
  if (!conversaId) {
    conversaId = crypto.randomUUID();
    abrirConversaDoUsuario(userId, conversaId, "chefe", pauta.titulo.slice(0, 80));
    db.query("UPDATE pautas SET conversa_id = ? WHERE id = ?").run(conversaId, id);
  }
  return { conversaId, pedido: pedidoDaPauta(pauta), vazia: mensagensDaConversa(conversaId).length === 0 };
});

// --- fila e publicações ---

type LinhaAgendado = ColunasDoPost & {
  id: number;
  post_id: number;
  media_type: TipoMidia;
  publish_at: string;
  status: StatusAgendado;
  error: string | null;
  headline: string | null;
  pilar: Pilar | null;
};

const SELECT_AGENDADO = `SELECT q.id, q.post_id, q.media_type, q.publish_at, q.status, q.error, p.headline, p.pilar, p.arts, p.chosen
  FROM queue q JOIN posts p ON p.id = q.post_id WHERE q.status IN ('pending', 'publishing', 'failed')`;

const doAgendado = (r: LinhaAgendado): ItemAgendado => ({
  tipo: "agendado",
  filaId: r.id,
  postId: r.post_id,
  publicaEm: Date.parse(isoDoSqlite(r.publish_at)),
  midia: r.media_type,
  headline: headlineDo(r.headline),
  pilar: r.pilar,
  capa: capaDo(r),
  status: r.status,
  erro: r.error,
});

/** A linha da fila como o calendário a mostra; null se não existe, já saiu ou foi cancelada. */
export function agendadoPorId(filaId: number): ItemAgendado | null {
  const r = db.query(`${SELECT_AGENDADO} AND q.id = ?`).get(filaId) as LinhaAgendado | null;
  return r ? doAgendado(r) : null;
}

/** inicio e fim no formato do SQLite; o intervalo é [inicio, fim). */
function agendadosEntre(inicio: string, fim: string): ItemAgendado[] {
  return (db.query(`${SELECT_AGENDADO} AND q.publish_at >= ? AND q.publish_at < ? ORDER BY q.publish_at`).all(inicio, fim) as LinhaAgendado[]).map(doAgendado);
}

function publicadosEntre(inicio: string, fim: string): ItemPublicado[] {
  const linhas = db
    .query(
      `SELECT u.id, u.post_id, u.media_type, u.permalink, u.published_at, p.headline, p.pilar, p.arts, p.chosen
       FROM publicacoes u JOIN posts p ON p.id = u.post_id
       WHERE u.published_at >= ? AND u.published_at < ? ORDER BY u.published_at`,
    )
    .all(inicio, fim) as (ColunasDoPost & {
    id: number;
    post_id: number;
    media_type: TipoMidia;
    permalink: string | null;
    published_at: string;
    headline: string | null;
    pilar: Pilar | null;
  })[];
  return linhas.map((r) => ({
    tipo: "publicado",
    publicacaoId: r.id,
    postId: r.post_id,
    publicadoEm: Date.parse(isoDoSqlite(r.published_at)),
    midia: r.media_type,
    headline: headlineDo(r.headline),
    pilar: r.pilar,
    capa: capaDo(r),
    link: r.permalink,
  }));
}

/** GET /api/calendario: tudo de `de` a `ate`, inclusive, com os dias de São Paulo. Agrupado por tipo, cada grupo em ordem. */
export function itensDoCalendario(userId: string, de: Dia, ate: Dia): ItemCalendario[] {
  const inicio = sqliteDe(inicioDoDiaSP(de));
  const fim = sqliteDe(inicioDoDiaSP(ate) + DIA_MS);
  const pautas = (
    db.query(`SELECT ${COLUNAS_PAUTA} FROM pautas WHERE dia BETWEEN ? AND ? AND apagada_em IS NULL ORDER BY dia, hora`).all(userId, de, ate) as LinhaPauta[]
  ).map(daPauta);
  const datas = datasEntre(de, ate).map((d): ItemData => ({ tipo: "data", dia: d.dia as Dia, nome: d.ocasiao }));
  return [...datas, ...pautas, ...agendadosEntre(inicio, fim), ...publicadosEntre(inicio, fim)];
}
