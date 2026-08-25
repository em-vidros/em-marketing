/**
 * Prova do commit "schema da fase 1": as oito tabelas materializam, os gatilhos
 * append-only rejeitam UPDATE e DELETE, e as chaves únicas seguram versão
 * duplicada, decisão duplicada e entrega duplicada.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco } from "../../src/controle/db";
import { migrar } from "../../src/controle/migracoes";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
}

function rejeita(fn: () => void, msg: string): void {
  try {
    fn();
  } catch {
    return;
  }
  console.error(`FALHOU: ${msg}`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "em-mkt-schema-"));
const db = abrirBanco(join(dir, "t.db"));
migrar(db);

const NOVAS = [
  "brand_versions",
  "workflow_runs",
  "tasks",
  "artifact_versions",
  "approvals",
  "deliveries",
  "idempotency_keys",
  "events",
];
for (const t of NOVAS) {
  assert(
    db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t),
    `tabela ${t} não materializou`,
  );
}

// linhas mínimas satisfazendo as FKs
db.run("INSERT INTO brand_versions (id, sha256, brandbook, voz, tokens, estilos) VALUES ('b', 's', '', '', '{}', '{}')");
db.run(
  "INSERT INTO workflow_runs (id, tipo, estado, chat_id, solicitante_id, pedido_json, brand_version_id) VALUES ('f', 'instagram', 'requested', 1, 2, '{}', 'b')",
);
db.run("INSERT INTO events (workflow_id, tipo, ator) VALUES ('f', 'teste', 'sistema')");
db.run(
  "INSERT INTO artifact_versions (id, workflow_id, linhagem_id, versao, papel, rodada, sha256, media_tipo, tamanho, caminho) VALUES ('v1', 'f', 'l', 1, 'prototipo', 1, 'h1', 'image/png', 3, '/x')",
);
db.run(
  "INSERT INTO approvals (id, workflow_id, stage, rodada, reviewer_id, decision, artifact_version_ids) VALUES ('a1', 'f', 'prototype', 1, 9, 'accepted', '[]')",
);

rejeita(() => db.run("UPDATE events SET tipo = 'x'"), "UPDATE em events passou");
rejeita(() => db.run("DELETE FROM events"), "DELETE em events passou");
rejeita(() => db.run("UPDATE approvals SET notas = 'x'"), "UPDATE em approvals passou");
rejeita(() => db.run("DELETE FROM approvals"), "DELETE em approvals passou");
rejeita(() => db.run("UPDATE artifact_versions SET sha256 = 'x'"), "UPDATE em artifact_versions passou");
rejeita(() => db.run("DELETE FROM artifact_versions"), "DELETE em artifact_versions passou");

rejeita(
  () =>
    db.run(
      "INSERT INTO artifact_versions (id, workflow_id, linhagem_id, versao, papel, rodada, sha256, media_tipo, tamanho, caminho) VALUES ('v2', 'f', 'l', 1, 'prototipo', 1, 'h2', 'image/png', 3, '/y')",
    ),
  "UNIQUE(linhagem_id, versao) não segurou versão duplicada",
);
rejeita(
  () =>
    db.run(
      "INSERT INTO approvals (id, workflow_id, stage, rodada, reviewer_id, decision, artifact_version_ids) VALUES ('a2', 'f', 'prototype', 1, 9, 'rejected', '[]')",
    ),
  "UNIQUE(workflow_id, stage, rodada) não segurou decisão duplicada",
);
db.run(
  "INSERT INTO deliveries (id, workflow_id, artifact_version_id, chave, canal) VALUES ('d1', 'f', 'v1', 'f:v1:telegram_doc', 'telegram_doc')",
);
rejeita(
  () =>
    db.run(
      "INSERT INTO deliveries (id, workflow_id, artifact_version_id, chave, canal) VALUES ('d2', 'f', 'v1', 'f:v1:telegram_doc', 'telegram_doc')",
    ),
  "UNIQUE(chave) não segurou entrega duplicada",
);

// migrar de novo continua no-op com o banco populado
const antes = JSON.stringify(
  db.query("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),
);
migrar(db);
assert(
  antes ===
    JSON.stringify(
      db.query("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),
    ),
  "segunda migração alterou o schema",
);

db.close();
rmSync(dir, { recursive: true, force: true });
console.log("ok: schema");
