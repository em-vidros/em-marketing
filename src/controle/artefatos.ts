/**
 * Versões imutáveis endereçadas por conteúdo em <dir>/<sha[0:2]>/<sha>.<ext>.
 * A escrita usa flag wx: arquivo existente significa que os bytes já estão lá, e
 * guardar o mesmo conteúdo duas vezes é de graça em vez de corrida. Imutável em
 * três camadas: modo 0444, gatilhos BEFORE UPDATE/DELETE e UNIQUE(linhagem_id,
 * versao). Texto entra como Buffer UTF-8 e ganha o mesmo tratamento.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { FluxoId, Formato, VersaoId } from "../modelos/tipos";
import type { Banco } from "./db";
import { emTransacao } from "./db";
import { registrarEvento } from "./fluxos";
import { gerarId, novaVersaoId } from "./ids";
import type { Lease } from "./tarefas";
import { LeasePerdida } from "./tarefas";

export interface NovoArtefato {
  readonly papel: "direcao" | "prototipo" | "master" | "preview" | "copy" | "artigo" | "qa";
  readonly formato?: Formato;
  readonly conteudo: Buffer;
  readonly mediaTipo: string;
  readonly derivadaDe?: VersaoId;
  readonly meta?: Record<string, unknown>;
}

const EXTENSOES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
};

interface LinhaVersao {
  id: string;
  workflow_id: string;
  linhagem_id: string;
  versao: number;
  sha256: string;
  media_tipo: string;
  caminho: string;
}

export function publicarArtefato(db: Banco, dir: string, lease: Lease, a: NovoArtefato): VersaoId {
  return emTransacao(db, () => {
    const tarefa = db
      .query("SELECT id, workflow_id, tipo FROM tasks WHERE id = ? AND lease_epoca = ? AND estado = 'reivindicada'")
      .get(lease.tarefaId, lease.epoca) as { id: string; workflow_id: string; tipo: string } | null;
    if (!tarefa) throw new LeasePerdida(`tarefa ${lease.tarefaId} época ${lease.epoca}`);
    const fluxo = db
      .query("SELECT rodada FROM workflow_runs WHERE id = ?")
      .get(tarefa.workflow_id) as { rodada: number };

    const sha = createHash("sha256").update(a.conteudo).digest("hex");
    const repetida = db
      .query(
        `SELECT id FROM artifact_versions
         WHERE workflow_id = ? AND papel = ? AND sha256 = ? AND ifnull(formato, '') = ?`,
      )
      .get(tarefa.workflow_id, a.papel, sha, a.formato ?? "") as { id: string } | null;
    if (repetida) return repetida.id as VersaoId;

    let linhagemId: string;
    let numero: number;
    if (a.derivadaDe) {
      const mae = db
        .query("SELECT workflow_id, linhagem_id FROM artifact_versions WHERE id = ?")
        .get(a.derivadaDe) as { workflow_id: string; linhagem_id: string } | null;
      if (!mae) throw new Error(`derivadaDe ${a.derivadaDe} não existe`);
      if (mae.workflow_id !== tarefa.workflow_id) {
        throw new Error(`derivadaDe ${a.derivadaDe} é de outro fluxo`);
      }
      linhagemId = mae.linhagem_id;
      const { m } = db
        .query("SELECT MAX(versao) AS m FROM artifact_versions WHERE linhagem_id = ?")
        .get(linhagemId) as { m: number };
      numero = m + 1;
    } else {
      linhagemId = gerarId();
      numero = 1;
    }

    const ext = EXTENSOES[a.mediaTipo] ?? "bin";
    const caminho = join(dir, sha.slice(0, 2), `${sha}.${ext}`);
    mkdirSync(dirname(caminho), { recursive: true });
    try {
      writeFileSync(caminho, a.conteudo, { flag: "wx" });
      chmodSync(caminho, 0o444);
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "EEXIST") throw erro;
    }

    const id = novaVersaoId();
    db.query(
      `INSERT INTO artifact_versions
         (id, workflow_id, linhagem_id, versao, papel, formato, rodada, sha256, media_tipo, tamanho, caminho, derivada_de, tarefa_id, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      tarefa.workflow_id,
      linhagemId,
      numero,
      a.papel,
      a.formato ?? null,
      fluxo.rodada,
      sha,
      a.mediaTipo,
      a.conteudo.length,
      caminho,
      a.derivadaDe ?? null,
      tarefa.id,
      a.meta ? JSON.stringify(a.meta) : null,
    );
    registrarEvento(db, {
      fluxoId: tarefa.workflow_id as FluxoId,
      tipo: "artefato_publicado",
      ator: `worker:${tarefa.tipo}`,
      dados: { versaoId: id, papel: a.papel, sha256: sha, linhagem: linhagemId, versao: numero },
    });
    return id;
  });
}

export interface ArtefatoLido {
  bytes: Buffer;
  mediaTipo: string;
  sha256: string;
  formato: Formato | null;
  versao: number;
}

export function lerArtefato(db: Banco, id: VersaoId): ArtefatoLido {
  const linha = db
    .query("SELECT sha256, media_tipo, caminho, formato, versao FROM artifact_versions WHERE id = ?")
    .get(id) as
    | (Pick<LinhaVersao, "sha256" | "media_tipo" | "caminho"> & { formato: string | null; versao: number })
    | null;
  if (!linha) throw new Error(`versão ${id} não existe`);
  const bytes = readFileSync(linha.caminho);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== linha.sha256) {
    throw new Error(`bytes de ${id} não batem com o hash registrado (${linha.caminho})`);
  }
  return {
    bytes,
    mediaTipo: linha.media_tipo,
    sha256: linha.sha256,
    formato: (linha.formato as Formato | null) ?? null,
    versao: linha.versao,
  };
}
