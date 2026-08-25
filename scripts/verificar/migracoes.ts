/**
 * Prova do commit "migrações por user_version": migrar materializa o schema,
 * rodar de novo é no-op, e contra um arquivo com o schema do bot v1 (o de
 * produção) também é no-op. Ids: 12 chars Crockford, sem colisão barata.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco } from "../../src/controle/db";
import { migrar, VERSAO_ALVO } from "../../src/controle/migracoes";
import { gerarId, ID_RE } from "../../src/controle/ids";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "em-mkt-migracoes-"));
const versaoDe = (db: ReturnType<typeof abrirBanco>) =>
  (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
const schemaDe = (db: ReturnType<typeof abrirBanco>) =>
  JSON.stringify(db.query("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all());

// banco novo em folha
const db1 = abrirBanco(join(dir, "novo.db"));
migrar(db1);
assert(versaoDe(db1) === VERSAO_ALVO, `user_version ${versaoDe(db1)} != alvo ${VERSAO_ALVO}`);
for (const t of ["conversations", "posts", "queue", "media", "calendar_sent"]) {
  const linha = db1.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  assert(linha, `tabela legada ${t} não materializou`);
}
const antes = schemaDe(db1);
migrar(db1);
assert(schemaDe(db1) === antes, "segunda migração alterou o schema");
assert(versaoDe(db1) === VERSAO_ALVO, "segunda migração mexeu no user_version");
db1.close();

// arquivo com a cara do de produção: schema do bot v1 já aplicado, user_version 0
const db2 = abrirBanco(join(dir, "prod.db"));
db2.run(`
CREATE TABLE IF NOT EXISTS conversations (chat_id INTEGER PRIMARY KEY, interaction_id TEXT, post_id INTEGER, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, brief TEXT, formato TEXT CHECK (formato IN ('feed','stories','ambos')), headline TEXT, legenda TEXT, arts TEXT, chosen INTEGER, story_path TEXT, linear_issue_id TEXT, status TEXT DEFAULT 'draft', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id), media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE','STORIES')), publish_at TEXT NOT NULL, status TEXT DEFAULT 'pending', error TEXT);
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, path TEXT NOT NULL, expired INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS calendar_sent (year INTEGER, mmdd TEXT, PRIMARY KEY (year, mmdd));
`);
db2.run("INSERT INTO media (id, path) VALUES ('abc', '/tmp/x.png')");
migrar(db2);
assert(versaoDe(db2) === VERSAO_ALVO, "migração não avançou user_version no arquivo de produção");
const media = db2.query("SELECT id, path FROM media").all() as { id: string; path: string }[];
assert(media.length === 1 && media[0]!.id === "abc", "migração tocou em dado existente");
db2.close();

// ids
const vistos = new Set<string>();
for (let i = 0; i < 5000; i++) {
  const id = gerarId();
  assert(ID_RE.test(id), `id fora do alfabeto: ${id}`);
  assert(!vistos.has(id), `colisão de id em ${i} amostras: ${id}`);
  vistos.add(id);
}

rmSync(dir, { recursive: true, force: true });
console.log("ok: migracoes");
