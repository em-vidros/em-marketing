import { primeira } from "../db";
import { q } from "../v2/banco";

/**
 * Quanto sobra de crédito na OpenAI. A OpenAI não expõe saldo nem depósitos para chave de API
 * (/v1/dashboard/billing/* só aceita sessão do navegador). Por isso os depósitos são lançados aqui,
 * e o gasto vem da Costs API (/v1/organization/costs), que exige OPENAI_ADMIN_KEY (sk-admin-...).
 *
 * Um lançamento "saldo" é uma foto do crédito num momento; um "deposito" soma ao que havia.
 * A conta começa no saldo mais recente, ou no primeiro depósito quando nunca houve saldo.
 */
export interface Lancamento {
  tipo: "saldo" | "deposito";
  /** Dólares. */
  valor: number;
  /** epoch ms. */
  em: number;
  por: string;
}

interface Comum {
  /** Tudo o que entrou desde o início da conta: o saldo de partida mais os depósitos seguintes. */
  creditado: number;
  desde: number;
  ultimoDeposito: Lancamento | null;
  lancamentos: Lancamento[];
}

export type Saldo =
  | { estado: "vazio" }
  | ({ estado: "sem-chave" } & Comum)
  | ({ estado: "erro"; erro: string } & Comum)
  | ({ estado: "ok"; gasto: number; disponivel: number; gastoDoMes: number; inicioDoMes: number } & Comum);

const CHAVE = "saldo_openai";
const LIMITE = 50;
const CACHE_MS = 10 * 60_000;

/** Da gravação mais nova para a mais velha. Lê também os formatos antigos (um saldo só, ou saldos sem tipo). */
async function lancamentos(): Promise<Lancamento[]> {
  const linha = await primeira(q<{ valor: string }>`SELECT valor FROM configuracoes WHERE chave = ${CHAVE}`);
  if (!linha) return [];
  const bruto = JSON.parse(linha.valor) as unknown;
  const lista = (Array.isArray(bruto) ? bruto : [bruto]) as Partial<Lancamento & { carregado: number; desde: number }>[];
  return lista
    .map((l): Lancamento => ({ tipo: l.tipo ?? "saldo", valor: l.valor ?? l.carregado ?? 0, em: l.em ?? l.desde ?? 0, por: l.por ?? "" }))
    .sort((a, b) => b.em - a.em);
}

async function gravar(lista: Lancamento[]): Promise<void> {
  const valor = JSON.stringify(lista.slice(0, LIMITE));
  await q`INSERT INTO configuracoes (chave, valor) VALUES (${CHAVE}, ${valor}) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`;
}

export async function lancar(l: Lancamento): Promise<void> {
  await gravar([l, ...(await lancamentos())].sort((a, b) => b.em - a.em));
}

/** Tira o lançamento feito naquele instante: o desfazer de um valor digitado errado. */
export async function removerLancamento(em: number): Promise<boolean> {
  const lista = await lancamentos();
  const resto = lista.filter((l) => l.em !== em);
  if (resto.length === lista.length) return false;
  await gravar(resto);
  return true;
}

/** Meia-noite de um dia AAAA-MM-DD em São Paulo (UTC-3 fixo desde 2019), em epoch ms. */
export const inicioDoDia = (dia: string) => Date.parse(`${dia}T03:00:00Z`);

/** Meia-noite do dia 1 do mês corrente em São Paulo, em epoch ms. */
export function inicioDoMes(agora = Date.now()): number {
  const mes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(agora);
  return inicioDoDia(`${mes}-01`);
}

/** De onde a conta parte e quanto entrou desde lá. */
export function contaDe(lista: readonly Lancamento[]): Comum | null {
  if (lista.length === 0) return null;
  const ultimoSaldo = lista.find((l) => l.tipo === "saldo");
  const depositos = lista.filter((l) => l.tipo === "deposito");
  const desde = ultimoSaldo?.em ?? Math.min(...depositos.map((d) => d.em));
  // Um depósito anterior ao último saldo já está dentro dele.
  const depois = depositos.filter((d) => (ultimoSaldo ? d.em > desde : true));
  return {
    creditado: (ultimoSaldo?.valor ?? 0) + depois.reduce((s, d) => s + d.valor, 0),
    desde,
    ultimoDeposito: depositos[0] ?? null,
    lancamentos: [...lista],
  };
}

interface PaginaDeCustos {
  data?: { start_time?: number; results?: { amount?: { value?: number | string } }[] }[];
  has_more?: boolean;
  next_page?: string | null;
  error?: { message?: string };
}

/** O custo de cada dia, em dólar, desde `inicio`. Guardado no banco para todas as funções da Vercel lerem o mesmo. */
interface Custos {
  inicio: number;
  em: number;
  dias: { t: number; v: number }[];
}

const CHAVE_DOS_CUSTOS = "custos_openai";

async function custosGuardados(): Promise<Custos | null> {
  const linha = await primeira(q<{ valor: string }>`SELECT valor FROM configuracoes WHERE chave = ${CHAVE_DOS_CUSTOS}`);
  return linha ? (JSON.parse(linha.valor) as Custos) : null;
}

async function buscarCustos(inicio: number, chave: string): Promise<Custos> {
  const dias: Custos["dias"] = [];
  let pagina: string | null | undefined;
  do {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(Math.floor(inicio / 1000)));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "180");
    if (pagina) url.searchParams.set("page", pagina);
    const res = await fetch(url, { headers: { authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(8000) });
    const corpo = (await res.json().catch(() => ({}))) as PaginaDeCustos;
    if (!res.ok) throw new Error(corpo.error?.message ?? `A Costs API respondeu ${res.status}.`);
    for (const balde of corpo.data ?? [])
      dias.push({ t: (balde.start_time ?? 0) * 1000, v: (balde.results ?? []).reduce((soma, r) => soma + Number(r.amount?.value ?? 0), 0) });
    pagina = corpo.has_more ? corpo.next_page : null;
  } while (pagina);
  const custos = { inicio, em: Date.now(), dias };
  await q`INSERT INTO configuracoes (chave, valor) VALUES (${CHAVE_DOS_CUSTOS}, ${JSON.stringify(custos)}) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`;
  return custos;
}

/**
 * Os custos diários desde `inicio`: do banco se têm menos de 10 minutos e cobrem o período, senão uma
 * chamada só à Costs API, que limita a 30 pedidos por minuto. Se ela recusar, vale o último guardado.
 */
async function custosDesde(inicio: number, chave: string): Promise<Custos> {
  const guardados = await custosGuardados();
  const cobre = guardados && guardados.inicio <= inicio;
  if (cobre && Date.now() - guardados.em < CACHE_MS) return guardados;
  try {
    return await buscarCustos(cobre ? guardados.inicio : inicio, chave);
  } catch (e) {
    if (cobre) return guardados;
    throw e;
  }
}

/** A soma dos dias que começam a partir de `desde`. Um saldo corrigido no meio do dia conta aquele dia inteiro. */
const somaDesde = (c: Custos, desde: number) => c.dias.filter((d) => d.t + 86_400_000 > desde).reduce((s, d) => s + d.v, 0);

export async function saldo(chave = process.env.OPENAI_ADMIN_KEY): Promise<Saldo> {
  const conta = contaDe(await lancamentos());
  if (!conta) return { estado: "vazio" };
  if (!chave) return { estado: "sem-chave", ...conta };
  try {
    const comeco = inicioDoMes();
    const custos = await custosDesde(Math.min(conta.desde, comeco), chave);
    const gasto = somaDesde(custos, conta.desde);
    return { estado: "ok", ...conta, gasto, disponivel: Math.max(0, conta.creditado - gasto), gastoDoMes: somaDesde(custos, comeco), inicioDoMes: comeco };
  } catch (e) {
    return { estado: "erro", ...conta, erro: e instanceof Error ? e.message : String(e) };
  }
}
