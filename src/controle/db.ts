/**
 * Único import de bun:sqlite na árvore nova (conferido por scripts/verificar/fronteira.ts).
 * Todo o resto de src/controle recebe um Banco já aberto.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Banco = Database;

export function abrirBanco(caminho: string): Banco {
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new Database(caminho, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA synchronous = NORMAL");
  return db;
}

const emCurso = new WeakSet<Database>();

/**
 * BEGIN IMMEDIATE pega o write lock na entrada; um BEGIN adiado pode falhar com
 * SQLITE_BUSY no meio da transação, depois de já ter lido estado que outro
 * escritor mudou. Chamada aninhada participa da transação de fora.
 */
export function emTransacao<T>(db: Banco, fn: () => T): T {
  if (emCurso.has(db)) return fn();
  db.run("BEGIN IMMEDIATE");
  emCurso.add(db);
  try {
    const resultado = fn();
    db.run("COMMIT");
    return resultado;
  } catch (erro) {
    db.run("ROLLBACK");
    throw erro;
  } finally {
    emCurso.delete(db);
  }
}
