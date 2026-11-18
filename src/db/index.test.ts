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
  db.run(`INSERT INTO posts (chat_id, brief, formato, status, linear_issue_id) VALUES (7, '{"tema":"arquivado"}', 'feed', 'archived', 'EMV-1')`);
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

  test("preserva os posts que já existiam, e o arquivado volta a ter a arte escolhida", () => {
    expect(db.query("SELECT brief, status FROM posts ORDER BY id").all()).toEqual([
      { brief: '{"tema":"legado"}', status: "published" },
      { brief: '{"tema":"arquivado"}', status: "chosen" },
    ]);
  });

  test("remove chat_id e linear_issue_id, das integrações que saíram", () => {
    expect(colunas(db, "posts")).not.toContain("chat_id");
    expect(colunas(db, "posts")).not.toContain("linear_issue_id");
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
    expect((db2.query("SELECT COUNT(*) n FROM posts").get() as { n: number }).n).toBe(2);
    expect(colunas(db2, "posts")).toContain("pilar");
    expect(colunas(db2, "posts")).not.toContain("linear_issue_id");
    db2.close();
  });
});

/** queue e publicacoes como eram antes de a fila aceitar arte do estúdio: post_id NOT NULL, sem JPEG nem legenda na linha. */
function filaAnterior(path: string) {
  migrar(path);
  const db = new Database(path);
  db.run("DROP TABLE queue");
  db.run("DROP TABLE publicacoes");
  db.run(`CREATE TABLE queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id),
    media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE','STORIES')),
    publish_at TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    error TEXT
  )`);
  db.run(`CREATE TABLE publicacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id),
    media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE','STORIES')),
    ig_media_id TEXT NOT NULL,
    permalink TEXT,
    published_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`INSERT INTO posts (id, formato, legenda, arts, chosen, story_path) VALUES
    (1, 'ambos', 'Legenda do feed.', '[{"variant":1,"path":"/a/v1.jpg"},{"variant":2,"path":"/a/v2.jpg"}]', 2, '/a/story.jpg'),
    (2, 'feed', NULL, NULL, NULL, NULL)`);
  db.run(`INSERT INTO queue (id, post_id, media_type, publish_at, status, error) VALUES
    (5, 1, 'IMAGE', '2031-01-01 12:00:00', 'pending', NULL),
    (6, 1, 'STORIES', '2031-01-01 12:00:00', 'failed', 'Token expirado'),
    (7, 2, 'IMAGE', '2031-01-02 12:00:00', 'cancelled', NULL)`);
  db.run("UPDATE sqlite_sequence SET seq = 9 WHERE name = 'queue'");
  db.run("INSERT INTO publicacoes (id, post_id, media_type, ig_media_id, permalink, published_at) VALUES (3, 1, 'IMAGE', 'ig_antigo', 'https://instagram.com/p/a', '2030-12-01 12:00:00')");
  db.close();
}

describe("migração da fila para post ou arte", () => {
  const path = join(tmp, "fila.db");
  filaAnterior(path);
  migrar(path);
  const db = new Database(path);
  const fila = () => db.query("SELECT id, post_id, arte_id, media_type, status, error, jpeg_path, legenda FROM queue ORDER BY id").all();
  const comoMigrou = [
    { id: 5, post_id: 1, arte_id: null, media_type: "IMAGE", status: "pending", error: null, jpeg_path: "/a/v2.jpg", legenda: "Legenda do feed." },
    { id: 6, post_id: 1, arte_id: null, media_type: "STORIES", status: "failed", error: "Token expirado", jpeg_path: "/a/story.jpg", legenda: null },
    { id: 7, post_id: 2, arte_id: null, media_type: "IMAGE", status: "cancelled", error: null, jpeg_path: "", legenda: null },
  ];

  // Pega linha perdida, id trocado ou o JPEG e a legenda que o tick leria do post não copiados.
  test("preserva as linhas da fila com os mesmos ids e fixa o JPEG e a legenda que o post tinha", () => {
    expect(fila()).toEqual(comoMigrou);
    expect(db.query("SELECT id, post_id, arte_id, ig_media_id, published_at FROM publicacoes").all()).toEqual([
      { id: 3, post_id: 1, arte_id: null, ig_media_id: "ig_antigo", published_at: "2030-12-01 12:00:00" },
    ]);
  });

  // Pega o AUTOINCREMENT zerado pela troca de tabela, que faria um id já usado voltar.
  test("o próximo id da fila continua de onde o contador estava", () => {
    const { id } = db.query("INSERT INTO queue (post_id, media_type, publish_at, jpeg_path) VALUES (2, 'IMAGE', '2031-02-01 12:00:00', '/a/n.jpg') RETURNING id").get() as { id: number };
    db.run("DELETE FROM queue WHERE id = ?", [id]);
    expect(id).toBe(10);
  });

  // Pega a CHECK ausente: linha sem fonte ou com as duas passaria e o tick não saberia o que publicar.
  test("queue e publicacoes recusam linha sem fonte ou com post e arte ao mesmo tempo", () => {
    const naFila = (post: number | null, arte: string | null) => () =>
      db.query("INSERT INTO queue (post_id, arte_id, media_type, publish_at, jpeg_path) VALUES (?, ?, 'IMAGE', '2031-02-01 12:00:00', '/a/n.jpg')").run(post, arte);
    const publicada = (post: number | null, arte: string | null) => () =>
      db.query("INSERT INTO publicacoes (post_id, arte_id, media_type, ig_media_id) VALUES (?, ?, 'IMAGE', ?)").run(post, arte, crypto.randomUUID());
    expect(naFila(null, null)).toThrow();
    expect(naFila(1, "a1b2")).toThrow();
    expect(publicada(null, null)).toThrow();
    expect(publicada(1, "a1b2")).toThrow();
  });

  // Pega a migração rodando de novo no boot seguinte e recriando ou estragando a tabela.
  test("rodar de novo não muda nada e mantém o índice único de ig_media_id", () => {
    migrar(path);
    const depois = new Database(path);
    expect(depois.query("SELECT id, post_id, arte_id, media_type, status, error, jpeg_path, legenda FROM queue ORDER BY id").all()).toEqual(comoMigrou);
    expect(() => depois.run("INSERT INTO publicacoes (post_id, media_type, ig_media_id) VALUES (1, 'IMAGE', 'ig_antigo')")).toThrow();
    depois.close();
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
