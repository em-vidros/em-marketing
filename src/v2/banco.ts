import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleBun } from "drizzle-orm/bun-sql";
import { migrate as migrarBun } from "drizzle-orm/bun-sql/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migrarPglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type Banco = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

/**
 * Com DATABASE_URL (Neon na Vercel), conecta nele.
 * Sem ela, sobe um Postgres embutido em `dir`, ou na memória quando `dir` é null, para rodar local e nos testes sem instalar nada.
 * Nos dois casos aplica as migrations que faltam.
 */
export async function abrirBanco(opcoes: { url?: string; dir: string | null }): Promise<Banco> {
  if (opcoes.url) {
    const db = drizzleBun(opcoes.url, { schema, casing: "snake_case" });
    await migrarBun(db, { migrationsFolder });
    return db as unknown as Banco;
  }
  const db = drizzlePglite(new PGlite(opcoes.dir ?? undefined), { schema, casing: "snake_case" });
  await migrarPglite(db, { migrationsFolder });
  return db as unknown as Banco;
}
