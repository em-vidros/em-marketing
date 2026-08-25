/**
 * Prova do commit "artefatos imutáveis endereçados por conteúdo": bytes iguais
 * geram um arquivo e uma linha, o arquivo sai 0444, derivação continua a
 * linhagem, versão duplicada é recusada pelo banco e zumbi não publica.
 */

import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco } from "../../src/controle/db";
import { migrar } from "../../src/controle/migracoes";
import { criarFluxo, lerFluxo, transicionar } from "../../src/controle/fluxos";
import { LeasePerdida, garantirTarefa, reivindicar } from "../../src/controle/tarefas";
import { lerArtefato, publicarArtefato } from "../../src/controle/artefatos";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "em-mkt-artefatos-"));
const db = abrirBanco(join(dir, "t.db"));
const artefatosDir = join(dir, "artefatos");
migrar(db);

const id = criarFluxo(db, {
  tipo: "instagram",
  chatId: 10,
  solicitanteId: 20,
  pedido: { theme: "Espelho lapidado", format: "feed" },
});
transicionar(db, { fluxoId: id, para: "brief_confirmed", ator: "teste" });
garantirTarefa(db, lerFluxo(db, id)!);
const tarefa = reivindicar(db, "diretor_criativo", "wA")!;
const lease = { tarefaId: tarefa.id, epoca: tarefa.leaseEpoca };

const png = Buffer.from("png-fingido-mas-bytes-reais");
const v1 = publicarArtefato(db, artefatosDir, lease, {
  papel: "prototipo",
  formato: "feed",
  conteudo: png,
  mediaTipo: "image/png",
});

// bytes idênticos: mesma versão, uma linha, um arquivo
const v1b = publicarArtefato(db, artefatosDir, lease, {
  papel: "prototipo",
  formato: "feed",
  conteudo: Buffer.from(png),
  mediaTipo: "image/png",
});
assert(v1 === v1b, "bytes idênticos geraram versões diferentes");
const linhas = db.query("SELECT COUNT(*) AS n FROM artifact_versions").get() as { n: number };
assert(linhas.n === 1, `bytes idênticos geraram ${linhas.n} linhas`);
const arquivos = readdirSync(artefatosDir, { recursive: true }).filter((f) => String(f).endsWith(".png"));
assert(arquivos.length === 1, `bytes idênticos geraram ${arquivos.length} arquivos`);

// modo 0444 e leitura conferida por hash
const { caminho } = db.query("SELECT caminho FROM artifact_versions WHERE id = ?").get(v1) as {
  caminho: string;
};
assert((statSync(caminho).mode & 0o777) === 0o444, "arquivo não ficou 0444");
const lido = lerArtefato(db, v1);
assert(lido.bytes.equals(png) && lido.mediaTipo === "image/png", "lerArtefato não devolveu os bytes");

// derivação continua a linhagem; texto é Buffer UTF-8 com o mesmo modelo
const v2 = publicarArtefato(db, artefatosDir, lease, {
  papel: "prototipo",
  formato: "feed",
  conteudo: Buffer.from("ajuste dirigido"),
  mediaTipo: "image/png",
  derivadaDe: v1,
});
const l1 = db.query("SELECT linhagem_id, versao FROM artifact_versions WHERE id = ?").get(v1) as { linhagem_id: string; versao: number };
const l2 = db.query("SELECT linhagem_id, versao FROM artifact_versions WHERE id = ?").get(v2) as { linhagem_id: string; versao: number };
assert(l1.linhagem_id === l2.linhagem_id && l1.versao === 1 && l2.versao === 2, "derivação não continuou a linhagem");
publicarArtefato(db, artefatosDir, lease, {
  papel: "copy",
  conteudo: Buffer.from("legenda do feed", "utf8"),
  mediaTipo: "text/plain",
});

// número de versão não se reusa nem por INSERT direto
let lancou = false;
try {
  db.query(
    `INSERT INTO artifact_versions (id, workflow_id, linhagem_id, versao, papel, rodada, sha256, media_tipo, tamanho, caminho)
     VALUES ('xx', ?, ?, 2, 'prototipo', 1, 'outro-sha', 'image/png', 1, '/tmp/x')`,
  ).run(id, l1.linhagem_id);
} catch {
  lancou = true;
}
assert(lancou, "UNIQUE(linhagem_id, versao) deixou reusar o número");

// zumbi não publica: outro worker reivindicou depois do lease vencer
db.query("UPDATE tasks SET estado = 'pendente', lease_dono = NULL WHERE id = ?").run(tarefa.id);
const nova = reivindicar(db, "diretor_criativo", "wB")!;
assert(nova.leaseEpoca === lease.epoca + 1, "reivindicação nova não incrementou época");
lancou = false;
try {
  publicarArtefato(db, artefatosDir, lease, {
    papel: "prototipo",
    conteudo: Buffer.from("saída do zumbi"),
    mediaTipo: "image/png",
  });
} catch (e) {
  lancou = e instanceof LeasePerdida;
}
assert(lancou, "zumbi publicou artefato com época velha");
const total = db.query("SELECT COUNT(*) AS n FROM artifact_versions").get() as { n: number };
assert(total.n === 3, "saída do zumbi entrou no banco");

db.close();
rmSync(dir, { recursive: true, force: true });
console.log("ok: artefatos");
