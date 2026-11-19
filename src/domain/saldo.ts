import { primeira } from "../db";
import { q } from "../v2/banco";

/**
 * O crédito da OpenAI, lido de /v1/dashboard/billing/credit_grants: o saldo disponível e cada
 * depósito com valor e data. Esse endpoint só aceita a chave de sessão do painel (sess-...), que
 * não expira; ela fica em OPENAI_SESSION_KEY. Chave de API e chave de admin recebem 403.
 */
export interface Deposito {
  valor: number;
  usado: number;
  /** epoch ms. */
  em: number;
  expiraEm: number | null;
}

export type Saldo =
  | { estado: "sem-chave" }
  | { estado: "erro"; erro: string }
  | { estado: "ok"; disponivel: number; depositado: number; usado: number; depositos: Deposito[]; lidoEm: number };

export interface RespostaDaOpenAI {
  total_granted?: number;
  total_used?: number;
  total_available?: number;
  grants?: { data?: { grant_amount?: number; used_amount?: number; effective_at?: number; expires_at?: number | null }[] };
  error?: { message?: string } | string;
}

const CHAVE_DO_CACHE = "credito_openai";
const CACHE_MS = 5 * 60_000;

/** A resposta da OpenAI no formato da tela, depósitos do mais novo para o mais velho. */
export function lerResposta(r: RespostaDaOpenAI, lidoEm: number): Extract<Saldo, { estado: "ok" }> {
  const depositos = (r.grants?.data ?? [])
    .map((g) => ({ valor: g.grant_amount ?? 0, usado: g.used_amount ?? 0, em: (g.effective_at ?? 0) * 1000, expiraEm: g.expires_at ? g.expires_at * 1000 : null }))
    .sort((a, b) => b.em - a.em);
  return { estado: "ok", disponivel: r.total_available ?? 0, depositado: r.total_granted ?? 0, usado: r.total_used ?? 0, depositos, lidoEm };
}

async function guardado(): Promise<Extract<Saldo, { estado: "ok" }> | null> {
  const linha = await primeira(q<{ valor: string }>`SELECT valor FROM configuracoes WHERE chave = ${CHAVE_DO_CACHE}`);
  return linha ? JSON.parse(linha.valor) : null;
}

/**
 * Do banco se a leitura tem menos de 5 minutos, para todas as funções da Vercel dividirem uma chamada só.
 * Se a OpenAI falhar, vale a última leitura boa; sem nenhuma, o erro vai para a tela.
 */
export async function saldo(chave = process.env.OPENAI_SESSION_KEY): Promise<Saldo> {
  if (!chave) return { estado: "sem-chave" };
  const ultimo = await guardado();
  if (ultimo && Date.now() - ultimo.lidoEm < CACHE_MS) return ultimo;
  try {
    const res = await fetch("https://api.openai.com/v1/dashboard/billing/credit_grants", {
      headers: { authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(8000),
    });
    const corpo = (await res.json().catch(() => ({}))) as RespostaDaOpenAI;
    if (!res.ok) throw new Error(typeof corpo.error === "string" ? corpo.error : (corpo.error?.message ?? `A OpenAI respondeu ${res.status}.`));
    const novo = lerResposta(corpo, Date.now());
    await q`INSERT INTO configuracoes (chave, valor) VALUES (${CHAVE_DO_CACHE}, ${JSON.stringify(novo)}) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`;
    return novo;
  } catch (e) {
    return ultimo ?? { estado: "erro", erro: e instanceof Error ? e.message : String(e) };
  }
}
