import { capaDo, emOrdem, fonteDa, headlineDo, isoDoUtc, primeira, utcDe, urlDaMidia, type ColunasDaFonte, type ColunasDoPost, type Fonte, type Pilar, type TipoMidia } from "../db";
import type { ResumoDaArte } from "../v2/artes";
import { q, transacao } from "../v2/banco";
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
  fonte: Fonte;
  /** epoch ms */
  publicaEm: number;
  midia: TipoMidia;
  titulo: string;
  pilar: Pilar | null;
  /** Do post, a arte escolhida; da arte do estúdio, o JPEG fixado no agendamento. */
  capa: string | null;
  status: StatusAgendado;
  /** O erro da Meta quando status é failed. */
  erro: string | null;
}

export interface ItemPublicado {
  tipo: "publicado";
  publicacaoId: number;
  fonte: Fonte;
  /** epoch ms */
  publicadoEm: number;
  midia: TipoMidia;
  titulo: string;
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

/** Só a pauta viva. A apagada some de todas as rotas até ser restaurada. conversa_id só sai para o dono da conversa, e só se ela não foi apagada. */
export async function pautaPorId(userId: string, id: number): Promise<ItemPauta | null> {
  const r = await primeira(
    q<LinhaPauta>`SELECT id, dia, hora, titulo, pilar, nota,
        (SELECT c.id FROM conversas c WHERE c.id = pautas.conversa_id AND c.user_id = ${userId}) AS conversa_id
      FROM pautas WHERE id = ${id} AND apagada_em IS NULL`,
  );
  return r ? daPauta(r) : null;
}

export async function criarPauta(userId: string, p: NovaPauta): Promise<ItemPauta> {
  const agora = Date.now();
  const { id } = (await primeira(
    q<{ id: number }>`INSERT INTO pautas (dia, hora, titulo, pilar, nota, criada_por, criada_em, atualizada_em)
      VALUES (${p.dia}, ${p.hora}, ${p.titulo}, ${p.pilar}, ${p.nota}, ${userId}, ${agora}, ${agora}) RETURNING id`,
  ))!;
  return (await pautaPorId(userId, id))!;
}

/** Só os campos mandados mudam; hora e pilar aceitam null para limpar. */
export async function mudarPauta(userId: string, id: number, mudanca: Partial<NovaPauta>): Promise<ItemPauta | null> {
  const atual = await pautaPorId(userId, id);
  if (!atual) return null;
  const mandados = Object.fromEntries(Object.entries(mudanca).filter(([, v]) => v !== undefined)) as Partial<NovaPauta>;
  const p: NovaPauta = { dia: atual.dia, hora: atual.hora, titulo: atual.titulo, pilar: atual.pilar, nota: atual.nota, ...mandados };
  await q`UPDATE pautas SET dia = ${p.dia}, hora = ${p.hora}, titulo = ${p.titulo}, pilar = ${p.pilar}, nota = ${p.nota}, atualizada_em = ${Date.now()}
    WHERE id = ${id}`;
  return pautaPorId(userId, id);
}

/** Apagar de novo mantém a data da primeira vez. false se a pauta não existe. */
export async function apagarPauta(id: number): Promise<boolean> {
  return (await q`UPDATE pautas SET apagada_em = COALESCE(apagada_em, ${Date.now()}::double precision) WHERE id = ${id} RETURNING id`).length > 0;
}

export async function restaurarPauta(userId: string, id: number): Promise<ItemPauta | null> {
  await q`UPDATE pautas SET apagada_em = NULL WHERE id = ${id}`;
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
export function conversaDaPauta(userId: string, id: number): Promise<ConversaDaPauta | null> {
  return transacao(async () => {
    const pauta = await pautaPorId(userId, id);
    if (!pauta) return null;
    let conversaId = pauta.conversaId;
    if (!conversaId) {
      conversaId = crypto.randomUUID();
      await abrirConversaDoUsuario(userId, conversaId, "chefe", pauta.titulo.slice(0, 80));
      await q`UPDATE pautas SET conversa_id = ${conversaId} WHERE id = ${id}`;
    }
    return { conversaId, pedido: pedidoDaPauta(pauta), vazia: (await mensagensDaConversa(conversaId)).length === 0 };
  });
}

// --- fila e publicações ---

/**
 * O resumo de cada arte pedida. As artes são lidas pelo drizzle do estúdio, que a rota
 * passa. Uma arte que não existe mais fica de fora do mapa.
 */
export type LerArtes = (ids: readonly string[]) => Promise<ReadonlyMap<string, ResumoDaArte>>;

/** Peça de foto real não tem headline: o número do post a identifica. */
export const tituloDoPost = (headline: string | null, postId: number) => headline ?? `Post sem headline (${postId})`;

const ARTE_SUMIDA = "Arte que não está mais no estúdio";

type LinhaDaFonte = ColunasDoPost & ColunasDaFonte & { headline: string | null; pilar: Pilar | null };

type LinhaAgendado = LinhaDaFonte & {
  id: number;
  media_type: TipoMidia;
  publish_at: string;
  status: StatusAgendado;
  error: string | null;
  jpeg_path: string;
};

type LinhaPublicado = LinhaDaFonte & {
  id: number;
  media_type: TipoMidia;
  permalink: string | null;
  published_at: string;
};

const idsDeArte = (linhas: readonly ColunasDaFonte[]) => [...new Set(linhas.flatMap((l) => (l.arte_id === null ? [] : [l.arte_id])))];

const tituloDa = (r: LinhaDaFonte, artes: ReadonlyMap<string, ResumoDaArte>) =>
  r.arte_id === null ? tituloDoPost(headlineDo(r.headline), r.post_id) : (artes.get(r.arte_id)?.titulo ?? ARTE_SUMIDA);

const doAgendado = async (r: LinhaAgendado, artes: ReadonlyMap<string, ResumoDaArte>): Promise<ItemAgendado> => ({
  tipo: "agendado",
  filaId: r.id,
  fonte: fonteDa(r),
  publicaEm: Date.parse(isoDoUtc(r.publish_at)),
  midia: r.media_type,
  titulo: tituloDa(r, artes),
  pilar: r.pilar,
  capa: r.arte_id === null ? await capaDo(r) : await urlDaMidia(r.jpeg_path),
  status: r.status,
  erro: r.error,
});

const doPublicado = async (r: LinhaPublicado, artes: ReadonlyMap<string, ResumoDaArte>): Promise<ItemPublicado> => ({
  tipo: "publicado",
  publicacaoId: r.id,
  fonte: fonteDa(r),
  publicadoEm: Date.parse(isoDoUtc(r.published_at)),
  midia: r.media_type,
  titulo: tituloDa(r, artes),
  pilar: r.pilar,
  capa: r.arte_id === null ? await capaDo(r) : (artes.get(r.arte_id)?.capa ?? null),
  link: r.permalink,
});

/** A linha da fila como o calendário a mostra; null se não existe, já saiu ou foi cancelada. */
export async function agendadoPorId(filaId: number, lerArtes: LerArtes): Promise<ItemAgendado | null> {
  const r = await primeira(
    q<LinhaAgendado>`SELECT q.id, q.post_id, q.arte_id, q.media_type, q.publish_at, q.status, q.error, q.jpeg_path, p.headline, p.pilar, p.arts, p.chosen
      FROM queue q LEFT JOIN posts p ON p.id = q.post_id WHERE q.status IN ('pending', 'publishing', 'failed') AND q.id = ${filaId}`,
  );
  return r ? doAgendado(r, await lerArtes(idsDeArte([r]))) : null;
}

/** GET /api/calendario: tudo de `de` a `ate`, inclusive, com os dias de São Paulo. Agrupado por tipo, cada grupo em ordem. */
export async function itensDoCalendario(userId: string, de: Dia, ate: Dia, lerArtes: LerArtes): Promise<ItemCalendario[]> {
  const inicio = utcDe(inicioDoDiaSP(de));
  const fim = utcDe(inicioDoDiaSP(ate) + DIA_MS);
  const pautas = (
    await q<LinhaPauta>`SELECT id, dia, hora, titulo, pilar, nota,
        (SELECT c.id FROM conversas c WHERE c.id = pautas.conversa_id AND c.user_id = ${userId}) AS conversa_id
      FROM pautas WHERE dia BETWEEN ${de} AND ${ate} AND apagada_em IS NULL ORDER BY dia, hora NULLS FIRST`
  ).map(daPauta);
  const datas = datasEntre(de, ate).map((d): ItemData => ({ tipo: "data", dia: d.dia as Dia, nome: d.ocasiao }));

  const agendados = await q<LinhaAgendado>`SELECT q.id, q.post_id, q.arte_id, q.media_type, q.publish_at, q.status, q.error, q.jpeg_path, p.headline, p.pilar, p.arts, p.chosen
    FROM queue q LEFT JOIN posts p ON p.id = q.post_id
    WHERE q.status IN ('pending', 'publishing', 'failed') AND q.publish_at >= ${inicio} AND q.publish_at < ${fim} ORDER BY q.publish_at`;
  const publicados = await q<LinhaPublicado>`SELECT u.id, u.post_id, u.arte_id, u.media_type, u.permalink, u.published_at, p.headline, p.pilar, p.arts, p.chosen
    FROM publicacoes u LEFT JOIN posts p ON p.id = u.post_id
    WHERE u.published_at >= ${inicio} AND u.published_at < ${fim} ORDER BY u.published_at`;
  const artes = await lerArtes(idsDeArte([...agendados, ...publicados]));

  return [
    ...datas,
    ...pautas,
    ...(await emOrdem(agendados, (r) => doAgendado(r, artes))),
    ...(await emOrdem(publicados, (r) => doPublicado(r, artes))),
  ];
}
