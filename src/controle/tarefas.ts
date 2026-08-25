/**
 * Fila com lease e época. A época é a cerca: quem reivindica incrementa
 * lease_epoca, então bater/concluir/falhar de um worker zumbi (lease vencida e
 * tarefa reivindicada por outro) altera zero linhas e o zumbi descobre que
 * perdeu. O estado do fluxo declara a tarefa exigida (TAREFA_DO_ESTADO);
 * garantirTarefa insere o que faltar e a chave fluxo:estado:rodada torna a
 * inserção no-op quando a tarefa já existe.
 */

import type { EstadoQualquer, FluxoId, Papel, TarefaId, TipoTarefa, VersaoId } from "../modelos/tipos";
import { PAPEL_DA_TAREFA, TAREFA_DO_ESTADO, transicoesDe } from "../modelos/tipos";
import type { Banco } from "./db";
import { emTransacao } from "./db";
import type { Fluxo } from "./fluxos";
import { lerFluxo, registrarEvento, transicionar } from "./fluxos";
import { novaTarefaId } from "./ids";

export class LeasePerdida extends Error {}

export interface Lease {
  readonly tarefaId: TarefaId;
  readonly epoca: number;
}

export interface Tarefa {
  id: TarefaId;
  workflowId: FluxoId;
  tipo: TipoTarefa;
  papel: Papel;
  estado: string;
  rodada: number;
  entrada: unknown;
  leaseEpoca: number;
  tentativas: number;
}

interface LinhaTarefa {
  id: string;
  workflow_id: string;
  tipo: string;
  papel: string;
  estado: string;
  rodada: number;
  entrada_json: string | null;
  lease_epoca: number;
  tentativas: number;
  max_tentativas: number;
}

function deLinha(l: LinhaTarefa): Tarefa {
  return {
    id: l.id as TarefaId,
    workflowId: l.workflow_id as FluxoId,
    tipo: l.tipo as TipoTarefa,
    papel: l.papel as Papel,
    estado: l.estado,
    rodada: l.rodada,
    entrada: l.entrada_json ? JSON.parse(l.entrada_json) : null,
    leaseEpoca: l.lease_epoca,
    tentativas: l.tentativas,
  };
}

const LEASE_MS = 60_000;

/** Pares estado:tarefa legítimos para reivindicação, direto do mapa congelado. */
const PARES_ELEGIVEIS = Object.entries(TAREFA_DO_ESTADO)
  .map(([estado, tipo]) => `'${estado}:${tipo}'`)
  .join(",");

/**
 * Reivindicar é uma instrução SQL só, atômica, que devolve a época nova. O join
 * com workflow_runs limita a fila ao que o estado atual do fluxo exige, então
 * tarefa de fluxo cancelado ou de rodada velha nunca chega a um worker.
 */
export function reivindicar(db: Banco, papel: Papel, dono: string): Tarefa | null {
  return emTransacao(db, () => {
    const expira = new Date(Date.now() + LEASE_MS).toISOString();
    const linha = db
      .query(
        `UPDATE tasks SET estado = 'reivindicada', lease_epoca = lease_epoca + 1, lease_dono = ?,
           lease_expira_em = ?, tentativas = tentativas + 1, atualizado_em = datetime('now')
         WHERE id = (
           SELECT t.id FROM tasks t JOIN workflow_runs w ON w.id = t.workflow_id
           WHERE t.estado = 'pendente' AND t.papel = ? AND t.rodada = w.rodada
             AND (w.estado || ':' || t.tipo) IN (${PARES_ELEGIVEIS})
           ORDER BY t.criado_em, t.id LIMIT 1
         ) RETURNING *`,
      )
      .get(dono, expira, papel) as LinhaTarefa | null;
    if (!linha) return null;
    const tarefa = deLinha(linha);
    registrarEvento(db, {
      fluxoId: tarefa.workflowId,
      tipo: "tarefa_reivindicada",
      ator: `worker:${dono}`,
      dados: { tarefaId: tarefa.id, tipo: tarefa.tipo, epoca: tarefa.leaseEpoca, tentativa: tarefa.tentativas },
    });
    // directions_ready -> prototypes_generating: estados vizinhos que exigem a
    // mesma tarefa marcam "trabalho em curso"; a aresta é derivada das tabelas,
    // não listada à mão.
    const fluxo = lerFluxo(db, tarefa.workflowId)!;
    if (TAREFA_DO_ESTADO[fluxo.estado] === tarefa.tipo) {
      const destino = (transicoesDe(fluxo.tipo)[fluxo.estado] ?? []).find(
        (p) => p !== fluxo.estado && TAREFA_DO_ESTADO[p as EstadoQualquer] === tarefa.tipo,
      ) as EstadoQualquer | undefined;
      if (destino) {
        transicionar(db, { fluxoId: fluxo.id, para: destino, ator: `worker:${dono}` });
      }
    }
    return tarefa;
  });
}

export function bater(db: Banco, lease: Lease): boolean {
  const r = db
    .query(
      `UPDATE tasks SET lease_expira_em = ?, atualizado_em = datetime('now')
       WHERE id = ? AND lease_epoca = ? AND estado = 'reivindicada'`,
    )
    .run(new Date(Date.now() + LEASE_MS).toISOString(), lease.tarefaId, lease.epoca);
  return r.changes > 0;
}

/**
 * Tarefas cuja conclusão tem um sucessor determinístico. As demais páram: quem
 * avança é abrirRevisao (estados awaiting_*) ou a orquestração da Fase 2.
 */
const ESTADO_APOS_CONCLUSAO: Partial<Record<TipoTarefa, EstadoQualquer>> = {
  direcao_criativa: "directions_ready",
  design_prototipos: "prototype_qa",
  finalizar_pacote: "package_qa",
  redacao_artigo: "copy_review",
  arquivar_linear: "archived",
};

export function concluir(
  db: Banco,
  lease: Lease,
  saida: { versoes: readonly VersaoId[]; resumo?: string },
): void {
  emTransacao(db, () => {
    const linha = db
      .query(
        `UPDATE tasks SET estado = 'concluida', saida_json = ?, lease_dono = NULL,
           lease_expira_em = NULL, atualizado_em = datetime('now')
         WHERE id = ? AND lease_epoca = ? AND estado = 'reivindicada' RETURNING *`,
      )
      .get(JSON.stringify(saida), lease.tarefaId, lease.epoca) as LinhaTarefa | null;
    if (!linha) throw new LeasePerdida(`tarefa ${lease.tarefaId} época ${lease.epoca}`);
    const tarefa = deLinha(linha);
    if (saida.versoes.length > 0) {
      const marcadores = saida.versoes.map(() => "?").join(",");
      const { n } = db
        .query(
          `SELECT COUNT(*) AS n FROM artifact_versions WHERE workflow_id = ? AND id IN (${marcadores})`,
        )
        .get(tarefa.workflowId, ...saida.versoes) as { n: number };
      if (n !== saida.versoes.length) {
        throw new Error(`saída cita versão que não é do fluxo ${tarefa.workflowId}`);
      }
    }
    registrarEvento(db, {
      fluxoId: tarefa.workflowId,
      tipo: "tarefa_concluida",
      ator: `worker:${tarefa.tipo}`,
      dados: { tarefaId: tarefa.id, tipo: tarefa.tipo, versoes: saida.versoes },
    });
    const sucessor = ESTADO_APOS_CONCLUSAO[tarefa.tipo];
    if (sucessor) {
      transicionar(db, { fluxoId: tarefa.workflowId, para: sucessor, ator: `worker:${tarefa.tipo}` });
    }
  });
}

export function falhar(
  db: Banco,
  lease: Lease,
  erro: { tipo: "transitoria" | "permanente"; mensagem: string },
): void {
  emTransacao(db, () => {
    const destino =
      erro.tipo === "permanente"
        ? "'revisao_manual'"
        : "CASE WHEN tentativas >= max_tentativas THEN 'revisao_manual' ELSE 'pendente' END";
    const linha = db
      .query(
        `UPDATE tasks SET estado = ${destino}, erro = ?, lease_dono = NULL,
           lease_expira_em = NULL, atualizado_em = datetime('now')
         WHERE id = ? AND lease_epoca = ? AND estado = 'reivindicada' RETURNING *`,
      )
      .get(erro.mensagem, lease.tarefaId, lease.epoca) as LinhaTarefa | null;
    if (!linha) throw new LeasePerdida(`tarefa ${lease.tarefaId} época ${lease.epoca}`);
    registrarEvento(db, {
      fluxoId: linha.workflow_id as FluxoId,
      tipo: linha.estado === "revisao_manual" ? "tarefa_para_revisao_manual" : "tarefa_falhou",
      ator: "sistema",
      dados: { tarefaId: linha.id, tipo: linha.tipo, erro: erro.mensagem, classe: erro.tipo },
    });
  });
}

/** Insere a tarefa que o estado do fluxo exige, se nenhuma equivalente está viva. */
export function garantirTarefa(db: Banco, fluxo: Fluxo): TarefaId | null {
  const tipo = TAREFA_DO_ESTADO[fluxo.estado];
  if (!tipo) return null;
  return emTransacao(db, () => {
    const viva = db
      .query(
        `SELECT 1 FROM tasks WHERE workflow_id = ? AND tipo = ? AND rodada = ?
           AND estado IN ('pendente','reivindicada')`,
      )
      .get(fluxo.id, tipo, fluxo.rodada);
    if (viva) return null;
    const id = novaTarefaId();
    const r = db
      .query(
        `INSERT OR IGNORE INTO tasks (id, workflow_id, tipo, papel, estado, rodada, chave_idempotencia, entrada_json)
         VALUES (?, ?, ?, ?, 'pendente', ?, ?, ?)`,
      )
      .run(
        id,
        fluxo.id,
        tipo,
        PAPEL_DA_TAREFA[tipo],
        fluxo.rodada,
        `${fluxo.id}:${fluxo.estado}:${fluxo.rodada}`,
        JSON.stringify({ estado: fluxo.estado, rodada: fluxo.rodada }),
      );
    if (r.changes === 0) return null;
    registrarEvento(db, {
      fluxoId: fluxo.id,
      tipo: "tarefa_criada",
      ator: "reconciliador",
      dados: { tarefaId: id, tipo, estado: fluxo.estado, rodada: fluxo.rodada },
    });
    return id;
  });
}

export function expirarLeases(db: Banco, agora: string): number {
  return emTransacao(db, () => {
    const linhas = db
      .query(
        `UPDATE tasks SET estado = 'pendente', lease_dono = NULL, lease_expira_em = NULL,
           atualizado_em = datetime('now')
         WHERE estado = 'reivindicada' AND lease_expira_em < ? RETURNING id, workflow_id, tipo`,
      )
      .all(agora) as { id: string; workflow_id: string; tipo: string }[];
    for (const l of linhas) {
      registrarEvento(db, {
        fluxoId: l.workflow_id as FluxoId,
        tipo: "lease_expirada",
        ator: "reconciliador",
        dados: { tarefaId: l.id, tipo: l.tipo },
      });
    }
    return linhas.length;
  });
}

export function promoverEsgotadas(db: Banco): number {
  return emTransacao(db, () => {
    const linhas = db
      .query(
        `UPDATE tasks SET estado = 'revisao_manual', atualizado_em = datetime('now')
         WHERE estado = 'pendente' AND tentativas >= max_tentativas RETURNING id, workflow_id, tipo, tentativas`,
      )
      .all() as { id: string; workflow_id: string; tipo: string; tentativas: number }[];
    for (const l of linhas) {
      registrarEvento(db, {
        fluxoId: l.workflow_id as FluxoId,
        tipo: "tarefa_para_revisao_manual",
        ator: "reconciliador",
        dados: { tarefaId: l.id, tipo: l.tipo, tentativas: l.tentativas },
      });
    }
    return linhas.length;
  });
}

/** Cancela o trabalho vivo de um fluxo encerrado; zumbis já reivindicados caem na cerca da época. */
export function cancelarTarefasVivas(db: Banco, fluxoId: FluxoId): void {
  db.query(
    `UPDATE tasks SET estado = 'cancelada', lease_dono = NULL, lease_expira_em = NULL,
       atualizado_em = datetime('now')
     WHERE workflow_id = ? AND estado IN ('pendente','reivindicada')`,
  ).run(fluxoId);
}

export function lerTarefa(db: Banco, id: TarefaId): Tarefa | null {
  const linha = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as LinhaTarefa | null;
  return linha ? deLinha(linha) : null;
}
