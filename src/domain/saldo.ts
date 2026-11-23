import { z } from "zod";
import { primeira } from "../db";
import { q } from "../v2/banco";

/**
 * O crédito da OpenAI, calculado aqui: a OpenAI não deixa ler o saldo com chave de API.
 * Vale o último saldo que a equipe informou, mais os depósitos depois dele, menos o custo
 * medido em uso_api desde então. Informar o saldo de novo corrige a diferença.
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
  return { estado: "ok", disponivel: total - gastoDesde, total, gasto: gastoDesde, desde: base.em, movimentos };
}

async function movimentosAtivos(): Promise<Movimento[]> {
  return q<Movimento>`SELECT id, tipo, valor, por, (extract(epoch FROM em) * 1000)::double precision AS em
    FROM movimentos_do_saldo WHERE removido_em IS NULL ORDER BY em DESC`;
}

export async function saldo(): Promise<Saldo> {
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
