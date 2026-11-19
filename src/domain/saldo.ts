import { primeira } from "../db";
import { q } from "../v2/banco";

/**
 * Quanto ainda há de crédito na OpenAI. A OpenAI não tem endpoint de saldo: o admin grava o valor
 * carregado e a data, e o gasto desde então vem da Costs API (/v1/organization/costs), que só
 * responde a uma chave de admin (OPENAI_ADMIN_KEY, sk-admin-...).
 */
export interface SaldoGravado {
  /** Crédito em dólar no momento da gravação. */
  carregado: number;
  /** epoch ms; o gasto conta a partir daqui. */
  desde: number;
  por: string;
}

/** Cada gravação de saldo, da mais nova para a mais velha. A primeira é a que vale para a barra. */
type Historico = SaldoGravado[];

interface Comum {
  carregado: number;
  desde: number;
  historico: Historico;
}

export type Saldo =
  | { estado: "sem-saldo" }
  | ({ estado: "sem-chave" } & Comum)
  | ({ estado: "erro"; erro: string } & Comum)
  | ({ estado: "ok"; gasto: number; disponivel: number; gastoDoMes: number; inicioDoMes: number } & Comum);

const CHAVE = "saldo_openai";
const LIMITE_DO_HISTORICO = 24;
const CACHE_MS = 10 * 60_000;
const cache = new Map<number, { em: number; gasto: number }>();

/** O valor antigo era um saldo só; o novo é a lista. Os dois são lidos. */
async function historico(): Promise<Historico> {
  const linha = await primeira(q<{ valor: string }>`SELECT valor FROM configuracoes WHERE chave = ${CHAVE}`);
  if (!linha) return [];
  const valor = JSON.parse(linha.valor) as SaldoGravado | Historico;
  return Array.isArray(valor) ? valor : [valor];
}

export async function gravarSaldo(carregado: number, por: string, agora = Date.now()): Promise<void> {
  const valor = JSON.stringify([{ carregado, desde: agora, por }, ...(await historico())].slice(0, LIMITE_DO_HISTORICO));
  await q`INSERT INTO configuracoes (chave, valor) VALUES (${CHAVE}, ${valor}) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`;
}

/** Meia-noite do dia 1 do mês corrente em São Paulo (UTC-3 fixo), em epoch ms. */
export function inicioDoMes(agora = Date.now()): number {
  const mes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(agora);
  return Date.parse(`${mes}-01T03:00:00Z`);
}

interface PaginaDeCustos {
  data?: { results?: { amount?: { value?: number | string } }[] }[];
  has_more?: boolean;
  next_page?: string | null;
  error?: { message?: string };
}

/** Soma em dólar os custos da organização desde `desde`, página por página. */
async function gastoDesde(desde: number, chave: string): Promise<number> {
  const guardado = cache.get(desde);
  if (guardado && Date.now() - guardado.em < CACHE_MS) return guardado.gasto;
  let gasto = 0;
  let pagina: string | null | undefined;
  do {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(Math.floor(desde / 1000)));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "180");
    if (pagina) url.searchParams.set("page", pagina);
    const res = await fetch(url, { headers: { authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(8000) });
    const corpo = (await res.json().catch(() => ({}))) as PaginaDeCustos;
    if (!res.ok) throw new Error(corpo.error?.message ?? `A Costs API respondeu ${res.status}.`);
    for (const balde of corpo.data ?? []) for (const r of balde.results ?? []) gasto += Number(r.amount?.value ?? 0);
    pagina = corpo.has_more ? corpo.next_page : null;
  } while (pagina);
  cache.set(desde, { em: Date.now(), gasto });
  return gasto;
}

export async function saldo(chave = process.env.OPENAI_ADMIN_KEY): Promise<Saldo> {
  const lista = await historico();
  const atual = lista[0];
  if (!atual) return { estado: "sem-saldo" };
  const comum: Comum = { carregado: atual.carregado, desde: atual.desde, historico: lista };
  if (!chave) return { estado: "sem-chave", ...comum };
  try {
    const comeco = inicioDoMes();
    const [gasto, gastoDoMes] = await Promise.all([gastoDesde(atual.desde, chave), gastoDesde(comeco, chave)]);
    return { estado: "ok", ...comum, gasto, disponivel: Math.max(0, atual.carregado - gasto), gastoDoMes, inicioDoMes: comeco };
  } catch (e) {
    return { estado: "erro", ...comum, erro: e instanceof Error ? e.message : String(e) };
  }
}
