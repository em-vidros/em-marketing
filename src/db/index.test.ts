import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * O schema evolui num banco que já está em produção. Estes testes rodam a
 * migração contra o schema anterior de verdade, em subprocesso, porque o módulo
 * abre a conexão no import e roda o DDL uma vez só por processo — importar duas
 * vezes no mesmo processo não provaria idempotência.
 */

const tmp = mkdtempSync(join(tmpdir(), "emv-db-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Exatamente como o banco estava antes deste commit: sem publicacoes, sem fotos. */
function schemaAnterior(path: string) {
  const db = new Database(path);
  db.run(`CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    brief TEXT,
    formato TEXT CHECK (formato IN ('feed','stories','ambos')),
    headline TEXT,
    legenda TEXT,
    arts TEXT,
    chosen INTEGER,
    story_path TEXT,
    linear_issue_id TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`INSERT INTO posts (chat_id, brief, formato, status) VALUES (7, '{"tema":"legado"}', 'feed', 'published')`);
  db.close();
}

function migrar(path: string) {
  const r = Bun.spawnSync(["bun", "-e", "await import('./src/db/index.ts')"], {
    env: { ...process.env, DB_PATH: path },
  });
  if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr));
}

const colunas = (db: Database, t: string) => (db.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const tabelas = (db: Database) =>
  (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);

describe("migração a partir do schema anterior", () => {
  const path = join(tmp, "legado.db");
  schemaAnterior(path);
  migrar(path);
  const db = new Database(path);

  test("preserva os posts que já existiam", () => {
    expect((db.query("SELECT COUNT(*) n FROM posts").get() as { n: number }).n).toBe(1);
    expect((db.query("SELECT brief FROM posts").get() as { brief: string }).brief).toBe('{"tema":"legado"}');
  });

  test("remove chat_id, que só existia por causa do Telegram", () => {
    expect(colunas(db, "posts")).not.toContain("chat_id");
  });

  test("adiciona pilar sem recriar a tabela", () => {
    expect(colunas(db, "posts")).toContain("pilar");
  });

  test("cria publicacoes e fotos", () => {
    expect(tabelas(db)).toContain("publicacoes");
    expect(tabelas(db)).toContain("fotos");
  });

  test("roda duas vezes sem estragar nada", () => {
    migrar(path);
    const db2 = new Database(path);
    expect((db2.query("SELECT COUNT(*) n FROM posts").get() as { n: number }).n).toBe(1);
    expect(colunas(db2, "posts")).toContain("pilar");
    db2.close();
  });
});

describe("publicacoes — a chave que liga a peça ao Instagram", () => {
  const path = join(tmp, "pub.db");
  migrar(path);
  const db = new Database(path);

  test("guarda o id da mídia e o tipo", () => {
    db.run("INSERT INTO posts (id) VALUES (1)");
    db.run("INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (1, 'IMAGE', 'ig_abc')");
    const row = db.query("SELECT * FROM publicacoes WHERE ig_media_id = 'ig_abc'").get() as any;
    expect(row.post_id).toBe(1);
    expect(row.published_at).toBeTruthy();
  });

  test("um post pode ter feed e story — por isso não é coluna em posts", () => {
    db.run("INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (1, 'STORIES', 'ig_def')");
    expect((db.query("SELECT COUNT(*) n FROM publicacoes WHERE post_id = 1").get() as { n: number }).n).toBe(2);
  });

  test("o mesmo ig_media_id não entra duas vezes", () => {
    expect(() => db.run("INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (1, 'IMAGE', 'ig_abc')")).toThrow();
  });

  test("media_type fora do domínio é rejeitado pelo banco", () => {
    expect(() => db.run("INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (1, 'REEL', 'ig_x')")).toThrow();
  });
});
