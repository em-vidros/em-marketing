import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite } from "@electric-sql/pglite";
import { SQL } from "bun";
import { drizzle as drizzleBun } from "drizzle-orm/bun-sql";
import { migrate as migrarBun } from "drizzle-orm/bun-sql/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migrarPglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type Banco = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * SQL cru em template: `await q<Linha>\`SELECT ... WHERE id = ${id}\``. Os valores viram parâmetros.
 * Dentro de `transacao`, a mesma função roda na transação aberta.
 * As duas pontas (Bun SQL no Neon, PGlite local) devolvem tipos iguais só com estas regras:
 * contagem com `::int`, epoch ms em `double precision`, lista como `= ANY(${lista}::int[])`.
 */
export type Q = <T = Record<string, unknown>>(textos: TemplateStringsArray, ...valores: unknown[]) => Promise<T[]>;

interface Conexao {
  banco: Banco;
  q: Q;
  transacao<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

const migrationsFolder = `${process.cwd()}/drizzle`;
const naTransacao = new AsyncLocalStorage<Q>();
let atual: Conexao | undefined;

// O Bun SQL manda uma lista JS como "a,b", que o Postgres recusa em `::text[]`; o PGlite manda "{a,b}". Aqui as duas pontas ficam iguais.
export function comoArrayDoPostgres(valor: unknown): unknown {
  if (!Array.isArray(valor)) return valor;
  const item = (v: unknown) => (v === null || v === undefined ? "NULL" : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `{${valor.map(item).join(",")}}`;
}

function doBun(cliente: SQL): Conexao {
  const comoQ = (s: SQL): Q => (async (textos, ...valores) => [...(await s(textos, ...valores.map(comoArrayDoPostgres)))]) as Q;
  return {
    banco: drizzleBun({ client: cliente, schema, casing: "snake_case" }) as unknown as Banco,
    q: comoQ(cliente),
    transacao: (fn) => cliente.begin((tx) => fn(comoQ(tx as unknown as SQL))) as Promise<never>,
  };
}

function doPglite(pg: PGlite): Conexao {
  type ComSql = Pick<PGlite, "sql">;
  const comoQ = (alvo: ComSql): Q => (async (textos, ...valores) => (await alvo.sql(textos, ...valores)).rows) as Q;
  return {
    banco: drizzlePglite(pg, { schema, casing: "snake_case" }) as unknown as Banco,
    q: comoQ(pg),
    transacao: (fn) => pg.transaction((tx) => fn(comoQ(tx as unknown as ComSql))),
  };
}

/**
 * Com DATABASE_URL (Neon na Vercel), conecta nele.
 * Sem ela, sobe um Postgres embutido em `dir`, ou na memória quando `dir` é null, para rodar local e nos testes sem instalar nada.
 * Nos dois casos aplica as migrations que faltam e passa a ser a conexão que `q` e `banco()` usam.
 */
export async function abrirBanco(opcoes: { url?: string; dir: string | null }): Promise<Banco> {
  const conexao = opcoes.url ? doBun(new SQL(opcoes.url)) : doPglite(new PGlite(opcoes.dir ?? undefined));
  if (opcoes.url) await comNovaTentativa(() => migrarBun(conexao.banco as never, { migrationsFolder }));
  else await migrarPglite(conexao.banco as never, { migrationsFolder });
  atual = conexao;
  return conexao.banco;
}

// Duas funções frias da Vercel migram ao mesmo tempo e uma perde a corrida no CREATE SCHEMA; na volta tudo já existe.
async function comNovaTentativa(fn: () => Promise<unknown>, tentativas = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (erro) {
      if (i >= tentativas) throw erro;
      await Bun.sleep(300 * i + Math.random() * 300);
    }
  }
}

function conexao(): Conexao {
  if (!atual) throw new Error("Banco não aberto: chame abrirBanco antes.");
  return atual;
}

export const banco = (): Banco => conexao().banco;

export const q: Q = (textos, ...valores) => (naTransacao.getStore() ?? conexao().q)(textos, ...valores);

/** Roda `fn` numa transação. Todo `q` chamado dentro dela, direta ou indiretamente, entra na mesma transação. */
export function transacao<T>(fn: () => Promise<T>): Promise<T> {
  const aberta = naTransacao.getStore();
  if (aberta) return fn();
  return conexao().transacao((tx) => naTransacao.run(tx, fn));
}
