import { z } from "zod";
import { primeira } from "../db";
import { q } from "../v2/banco";

/**
 * O crédito da OpenAI. Com OPENAI_SESSION_KEY (a sessão do painel, a única que lê o saldo), vem direto de
 * /v1/dashboard/billing/credit_grants, guardado 5 minutos no banco. Sem ela, ou se a leitura falhar sem
 * nenhuma leitura boa guardada, o app calcula: o último saldo que a equipe informou, mais os depósitos
 * depois dele, menos o custo medido em uso_api desde então.
 */
export interface Movimento {
  id: string;
  tipo: "saldo" | "deposito";
  valor: number;
  por: string;
  /** epoch ms. */
  em: number;
}

export type Saldo =
  | { estado: "sem-saldo"; movimentos: Movimento[] }
  | {
      estado: "ok";
      /** De onde vem o número: lido da OpenAI ou calculado a partir do saldo informado. */
      origem: "openai" | "informado";
      disponivel: number;
      /** O saldo informado mais os depósitos depois dele: a barra mostra quanto disso resta. */
      total: number;
      gasto: number;
      /** epoch ms do último saldo informado. */
      desde: number;
      movimentos: Movimento[];
    };

export const NovoMovimento = z.object(
  {
    tipo: z.enum(["saldo", "deposito"], { error: "O tipo precisa ser saldo ou deposito." }),
    valor: z
      .number({ error: "O valor precisa ser um número." })
      .min(0, "O valor não pode ser negativo.")
      .max(100_000, "O valor passa de US$ 100.000."),
  },
  { error: "Mande um objeto JSON." },
);

const MOVIMENTOS = 20;

/** O saldo dos movimentos ativos, do mais novo para o mais velho, e do custo medido depois do último saldo informado. */
export function calcularSaldo(movimentos: Movimento[], gastoDesde: number): Saldo {
  const base = movimentos.find((m) => m.tipo === "saldo");
  if (!base) return { estado: "sem-saldo", movimentos };
  const total = base.valor + movimentos.filter((m) => m.tipo === "deposito" && m.em > base.em).reduce((s, m) => s + m.valor, 0);
  return { estado: "ok", origem: "informado", disponivel: total - gastoDesde, total, gasto: gastoDesde, desde: base.em, movimentos };
}

async function movimentosAtivos(): Promise<Movimento[]> {
  return q<Movimento>`SELECT id, tipo, valor, por, (extract(epoch FROM em) * 1000)::double precision AS em
    FROM movimentos_do_saldo WHERE removido_em IS NULL ORDER BY em DESC`;
}

interface RespostaDaOpenAI {
  total_granted?: number;
  total_used?: number;
  total_available?: number;
  grants?: { data?: { effective_at?: number }[] };
  error?: { message?: string } | string;
}

type Lido = Extract<Saldo, { estado: "ok" }>;
const CHAVE_DO_CACHE = "credito_openai";
const CACHE_MS = 5 * 60_000;

/** O desde é o depósito mais antigo; o gasto, o que a OpenAI diz que foi usado. */
export function lerDaOpenAI(r: RespostaDaOpenAI): Lido {
  const primeiro = Math.min(...(r.grants?.data ?? []).map((g) => (g.effective_at ?? 0) * 1000).filter(Boolean), Date.now());
  return { estado: "ok", origem: "openai", disponivel: r.total_available ?? 0, total: r.total_granted ?? 0, gasto: r.total_used ?? 0, desde: primeiro, movimentos: [] };
}

/** Do banco se a leitura tem menos de 5 minutos, para as funções da Vercel dividirem uma chamada só. null quando não dá para ler. */
async function lidoDaOpenAI(chave: string | undefined): Promise<Lido | null> {
  if (!chave) return null;
  const linha = await primeira(q<{ valor: string }>`SELECT valor FROM configuracoes WHERE chave = ${CHAVE_DO_CACHE}`);
  const guardado = linha ? (JSON.parse(linha.valor) as { lido: Lido; lidoEm: number }) : null;
  if (guardado && Date.now() - guardado.lidoEm < CACHE_MS) return guardado.lido;
  try {
    const res = await fetch("https://api.openai.com/v1/dashboard/billing/credit_grants", { headers: { authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(8000) });
    const corpo = (await res.json().catch(() => ({}))) as RespostaDaOpenAI;
    if (!res.ok) throw new Error(`A OpenAI respondeu ${res.status}.`);
    const lido = lerDaOpenAI(corpo);
    await q`INSERT INTO configuracoes (chave, valor) VALUES (${CHAVE_DO_CACHE}, ${JSON.stringify({ lido, lidoEm: Date.now() })}) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`;
    return lido;
  } catch {
    return guardado?.lido ?? null;
  }
}

export async function saldo(chave = process.env.OPENAI_SESSION_KEY): Promise<Saldo> {
  const daOpenAI = await lidoDaOpenAI(chave);
  if (daOpenAI) return daOpenAI;
  const movimentos = await movimentosAtivos();
  const base = movimentos.find((m) => m.tipo === "saldo");
  const gasto = base
    ? ((await primeira(q<{ gasto: number }>`SELECT coalesce(sum(custo), 0)::double precision AS gasto FROM uso_api WHERE em > ${base.em}`))?.gasto ?? 0)
    : 0;
  const s = calcularSaldo(movimentos, gasto);
  return { ...s, movimentos: s.movimentos.slice(0, MOVIMENTOS) };
}

/** O relógio é o do servidor, o mesmo do `em` de uso_api: o relógio do banco poderia deixar de fora a chamada do mesmo instante. */
export async function informar(m: z.output<typeof NovoMovimento>, por: string, agora = Date.now()): Promise<Movimento> {
  const [novo] = await q<Movimento>`INSERT INTO movimentos_do_saldo (tipo, valor, por, em) VALUES (${m.tipo}, ${m.valor}, ${por}, to_timestamp(${agora}::double precision / 1000))
    RETURNING id, tipo, valor, por, (extract(epoch FROM em) * 1000)::double precision AS em`;
  return novo!;
}

/** false quando o movimento não existe. Remover e restaurar duas vezes dá no mesmo. */
export async function removerMovimento(id: string, removido: boolean): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const linhas = await q`UPDATE movimentos_do_saldo SET removido_em = ${removido ? new Date() : null} WHERE id = ${id} RETURNING id`;
  return linhas.length > 0;
}
