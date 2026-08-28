/**
 * Abertura e leitura das revisões humanas. Mora fora de aprovacoes.ts porque
 * quem abre revisão é o `concluir` de tarefas.ts, e aprovacoes.ts já importa
 * tarefas.ts para cancelar trabalho vivo: juntar os dois fecharia um ciclo.
 *
 * Abrir a revisão grava `revisao_pendente` na mesma transação da aresta para
 * `awaiting_*`. É daí que sai o conjunto exato coberto por uma aprovação, sem o
 * teto de 64 bytes do callback_data limitar quantos artefatos ela cobre.
 */

import type {
  Estagio,
  EstadoQualquer,
  FluxoId,
  Pedido,
  RevisaoPendente,
  VersaoId,
} from "../modelos/tipos";
import type { Banco } from "./db";
import { emTransacao } from "./db";
import { lerFluxo, transicionar } from "./fluxos";

export const ESPERA: Record<Estagio, EstadoQualquer> = {
  prototype: "awaiting_prototype_review",
  package: "awaiting_package_review",
  copy: "awaiting_copy_review",
  angle: "awaiting_angle_selection",
};

export interface RevisaoAberta {
  readonly fluxoId: FluxoId;
  readonly chatId: number;
  readonly stage: Estagio;
  readonly rodada: number;
  readonly versoes: readonly VersaoId[];
  readonly aviso: string | null;
  readonly pedido: Pedido;
}

export function abrirRevisao(
  db: Banco,
  fluxoId: FluxoId,
  stage: Estagio,
  versoes: readonly VersaoId[],
  aviso?: string,
): void {
  if (versoes.length === 0) throw new Error("revisão sem versões");
  emTransacao(db, () => {
    const fluxo = lerFluxo(db, fluxoId);
    if (!fluxo) throw new Error(`fluxo ${fluxoId} não existe`);
    const marcadores = versoes.map(() => "?").join(",");
    const { n } = db
      .query(`SELECT COUNT(*) AS n FROM artifact_versions WHERE workflow_id = ? AND id IN (${marcadores})`)
      .get(fluxoId, ...versoes) as { n: number };
    if (n !== versoes.length) throw new Error(`revisão cita versão que não é do fluxo ${fluxoId}`);
    const pendente: RevisaoPendente = {
      stage,
      rodada: fluxo.rodada,
      versoes: [...versoes],
      ...(aviso ? { aviso } : {}),
    };
    transicionar(db, {
      fluxoId,
      para: ESPERA[stage],
      ator: "sistema",
      revisaoPendente: pendente,
      dados: { stage, versoes, aviso },
    });
  });
}

/** Fluxos parados esperando o Ricardo, na ordem em que a revisão abriu. */
export function revisoesAbertas(db: Banco): RevisaoAberta[] {
  const estados = Object.values(ESPERA);
  const marcadores = estados.map(() => "?").join(",");
  const linhas = db
    .query(
      `SELECT id, chat_id, estado, revisao_pendente, pedido_json FROM workflow_runs
       WHERE estado IN (${marcadores}) AND revisao_pendente IS NOT NULL
       ORDER BY atualizado_em, id`,
    )
    .all(...estados) as {
    id: string;
    chat_id: number;
    estado: string;
    revisao_pendente: string;
    pedido_json: string;
  }[];
  return linhas.map((l) => {
    const pendente = JSON.parse(l.revisao_pendente) as RevisaoPendente;
    return {
      fluxoId: l.id as FluxoId,
      chatId: l.chat_id,
      stage: pendente.stage,
      rodada: pendente.rodada,
      versoes: pendente.versoes,
      aviso: pendente.aviso ?? null,
      pedido: JSON.parse(l.pedido_json) as Pedido,
    };
  });
}
