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

export type Saldo =
  | { estado: "sem-saldo" }
  | { estado: "sem-chave"; carregado: number; desde: number }
  | { estado: "erro"; carregado: number; desde: number; erro: string }
  | { estado: "ok"; carregado: number; desde: number; gasto: number; disponivel: number };

const CHAVE = "saldo_openai";
const CACHE_MS = 10 * 60_000;
let cache: { desde: number; em: number; gasto: number } | null = null;

export async function saldoGravado(): Promise<SaldoGravado | null> {
  const linha = await primeira(q<{ valor: string }>`SELECT valor FROM configuracoes WHERE chave = ${CHAVE}`);
  return linha ? (JSON.parse(linha.valor) as SaldoGravado) : null;
}

export async function gravarSaldo(carregado: number, por: string, agora = Date.now()): Promise<void> {
  const valor = JSON.stringify({ carregado, desde: agora, por } satisfies SaldoGravado);
  await q`INSERT INTO configuracoes (chave, valor) VALUES (${CHAVE}, ${valor}) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`;
  cache = null;
}

interface PaginaDeCustos {
  data?: { results?: { amount?: { value?: number } }[] }[];
  has_more?: boolean;
  next_page?: string | null;
  error?: { message?: string };
}

/** Soma em dólar os custos da organização desde `desde`, página por página. */
async function gastoDesde(desde: number, chave: string): Promise<number> {
  if (cache && cache.desde === desde && Date.now() - cache.em < CACHE_MS) return cache.gasto;
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
    for (const balde of corpo.data ?? []) for (const r of balde.results ?? []) gasto += r.amount?.value ?? 0;
    pagina = corpo.has_more ? corpo.next_page : null;
  } while (pagina);
  cache = { desde, em: Date.now(), gasto };
  return gasto;
}

export async function saldo(chave = process.env.OPENAI_ADMIN_KEY): Promise<Saldo> {
  const gravado = await saldoGravado();
  if (!gravado) return { estado: "sem-saldo" };
  const { carregado, desde } = gravado;
  if (!chave) return { estado: "sem-chave", carregado, desde };
  try {
    const gasto = await gastoDesde(desde, chave);
    return { estado: "ok", carregado, desde, gasto, disponivel: Math.max(0, carregado - gasto) };
  } catch (e) {
    return { estado: "erro", carregado, desde, erro: e instanceof Error ? e.message : String(e) };
  }
}
