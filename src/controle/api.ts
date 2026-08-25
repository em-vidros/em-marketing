/**
 * Costura do plano de controle: uma porta para workers (ControlePlano), uma para
 * o webhook (EntradaTelegram), o reconciliador e a inspeção somente leitura do
 * arnês. Todo estado mora no banco; nada aqui vive só na memória.
 */

import { dirname, join } from "node:path";
import type { Adaptadores, ContextoMarca } from "../adaptadores/tipos";
import type {
  Estagio,
  EstadoQualquer,
  FluxoId,
  Formato,
  Papel,
  Pedido,
  TarefaId,
  TipoFluxo,
  TipoTarefa,
  VersaoId,
} from "../modelos/tipos";
import type { Banco } from "./db";
import { abrirBanco, emTransacao } from "./db";
import { migrar } from "./migracoes";
import type { Fluxo } from "./fluxos";
import { criarFluxo, lerFluxo, transicionar } from "./fluxos";
import type { Lease, Tarefa } from "./tarefas";
import {
  bater,
  cancelarTarefasVivas,
  concluir,
  falhar,
  reivindicar,
} from "./tarefas";
import type { NovoArtefato } from "./artefatos";
import { lerArtefato, publicarArtefato } from "./artefatos";
import { executarUmaVez } from "./idempotencia";
import type { ResultadoDecisao } from "./aprovacoes";
import { abrirRevisao, decidir } from "./aprovacoes";
import { executarEntregas } from "./entregas";
import { reconciliar } from "./reconciliador";

export type { Lease } from "./tarefas";
export type { NovoArtefato } from "./artefatos";
export type { ResultadoDecisao } from "./aprovacoes";

/** Marca + pedido + versões já produzidas no fluxo; imutável do ponto de vista do worker. */
export interface PacoteContexto {
  readonly marca: ContextoMarca;
  readonly pedido: Pedido;
  readonly versoes: readonly VersaoId[];
}

export interface TarefaAtribuida {
  readonly lease: Lease;
  readonly tipo: TipoTarefa;
  readonly fluxoId: FluxoId;
  readonly entrada: unknown;
  readonly contexto: PacoteContexto;
  readonly tentativa: number;
}

export interface ControlePlano {
  reivindicar(papel: Papel, dono: string): TarefaAtribuida | null;
  bater(lease: Lease): boolean;
  publicarArtefato(lease: Lease, a: NovoArtefato): VersaoId;
  executarUmaVez<T>(chave: string, efeito: () => Promise<T>): Promise<{ novo: boolean; resultado: T }>;
  concluir(lease: Lease, saida: { versoes: readonly VersaoId[]; resumo?: string }): void;
  falhar(lease: Lease, erro: { tipo: "transitoria" | "permanente"; mensagem: string }): void;
  lerArtefato(id: VersaoId): { bytes: Buffer; mediaTipo: string; sha256: string };
}

export interface EntradaTelegram {
  criarFluxo(e: { tipo: TipoFluxo; chatId: number; solicitanteId: number; pedido: Pedido }): FluxoId;
  confirmarBrief(fluxoId: FluxoId): void;
  abrirRevisao(fluxoId: FluxoId, stage: Estagio, versoes: readonly VersaoId[]): void;
  aoCallback(e: { deId: number; callbackId: string; data: string; notas?: string }): ResultadoDecisao;
  cancelar(fluxoId: FluxoId, porId: number): void;
  executarEntregas(fluxoId: FluxoId): Promise<void>;
}

const MOTIVO_TEXTO: Record<Exclude<ResultadoDecisao, { ok: true }>["motivo"], string> = {
  nao_autorizado: "Só o aprovador decide.",
  aprovacao_vencida: "Esse botão é de uma rodada que já fechou.",
  estado_incompativel: "Essa revisão não está mais aberta.",
  callback_invalido: "Botão inválido.",
};

function montarContexto(db: Banco, fluxo: Fluxo): PacoteContexto {
  const marca = db
    .query("SELECT id, brandbook, voz, tokens, estilos FROM brand_versions WHERE id = ?")
    .get(fluxo.brandVersionId) as { id: string; brandbook: string; voz: string; tokens: string; estilos: string };
  const versoes = (
    db.query("SELECT id FROM artifact_versions WHERE workflow_id = ? ORDER BY rowid").all(fluxo.id) as { id: string }[]
  ).map((l) => l.id as VersaoId);
  return {
    marca: {
      brandVersionId: marca.id,
      brandbook: marca.brandbook,
      voz: marca.voz,
      tokens: JSON.parse(marca.tokens) as unknown,
      estilos: JSON.parse(marca.estilos) as Record<string, string>,
    },
    pedido: fluxo.pedido,
    versoes,
  };
}

export function criarControle(opts: {
  caminhoDb: string;
  adaptadores: Adaptadores;
  aprovadorId: number;
  artefatosDir?: string;
}): {
  paraWorkers: ControlePlano;
  paraTelegram: EntradaTelegram;
  reconciliar(): void;
  fechar(): void;
  inspecionar: {
    fluxo(id: FluxoId): { estado: EstadoQualquer; rodada: number; versao: number; tipo: TipoFluxo } | null;
    tarefas(fluxoId: FluxoId): { id: TarefaId; tipo: TipoTarefa; estado: string; tentativas: number }[];
    eventos(fluxoId: FluxoId): { seq: number; tipo: string; ator: string }[];
    entregas(fluxoId: FluxoId): { chave: string; estado: string; hashConferido: string | null }[];
  };
} {
  const db = abrirBanco(opts.caminhoDb);
  migrar(db);
  const artefatosDir = opts.artefatosDir ?? join(dirname(opts.caminhoDb), "artefatos");
  reconciliar(db);

  const paraWorkers: ControlePlano = {
    reivindicar(papel, dono) {
      return emTransacao(db, () => {
        const tarefa: Tarefa | null = reivindicar(db, papel, dono);
        if (!tarefa) return null;
        const fluxo = lerFluxo(db, tarefa.workflowId)!;
        return {
          lease: { tarefaId: tarefa.id, epoca: tarefa.leaseEpoca },
          tipo: tarefa.tipo,
          fluxoId: tarefa.workflowId,
          entrada: tarefa.entrada,
          contexto: montarContexto(db, fluxo),
          tentativa: tarefa.tentativas,
        };
      });
    },
    bater: (lease) => bater(db, lease),
    publicarArtefato: (lease, a) => publicarArtefato(db, artefatosDir, lease, a),
    executarUmaVez: (chave, efeito) => executarUmaVez(db, chave, efeito),
    concluir: (lease, saida) => concluir(db, lease, saida),
    falhar: (lease, erro) => falhar(db, lease, erro),
    lerArtefato: (id) => lerArtefato(db, id),
  };

  const paraTelegram: EntradaTelegram = {
    criarFluxo: (e) => criarFluxo(db, e),
    confirmarBrief(fluxoId) {
      const fluxo = lerFluxo(db, fluxoId);
      if (!fluxo) throw new Error(`fluxo ${fluxoId} não existe`);
      transicionar(db, { fluxoId, para: "brief_confirmed", ator: `telegram:${fluxo.solicitanteId}` });
    },
    abrirRevisao: (fluxoId, stage, versoes) => abrirRevisao(db, fluxoId, stage, versoes),
    aoCallback(e) {
      const resultado = decidir(db, {
        deId: e.deId,
        aprovadorId: opts.aprovadorId,
        data: e.data,
        notas: e.notas,
      });
      void opts.adaptadores.telegram
        .responderCallback(e.callbackId, resultado.ok ? undefined : MOTIVO_TEXTO[resultado.motivo])
        .catch(() => {});
      return resultado;
    },
    cancelar(fluxoId, porId) {
      emTransacao(db, () => {
        const fluxo = lerFluxo(db, fluxoId);
        if (!fluxo) throw new Error(`fluxo ${fluxoId} não existe`);
        if (porId !== opts.aprovadorId && porId !== fluxo.solicitanteId) {
          throw new Error(`telegram:${porId} não pode cancelar o fluxo ${fluxoId}`);
        }
        transicionar(db, { fluxoId, para: "cancelled", ator: `telegram:${porId}`, revisaoPendente: null });
        cancelarTarefasVivas(db, fluxoId);
      });
    },
    executarEntregas: (fluxoId) => executarEntregas(db, opts.adaptadores, fluxoId),
  };

  return {
    paraWorkers,
    paraTelegram,
    reconciliar: () => reconciliar(db),
    fechar: () => db.close(),
    inspecionar: {
      fluxo(id) {
        const fluxo = lerFluxo(db, id);
        return fluxo
          ? { estado: fluxo.estado, rodada: fluxo.rodada, versao: fluxo.versao, tipo: fluxo.tipo }
          : null;
      },
      tarefas(fluxoId) {
        return (
          db
            .query("SELECT id, tipo, estado, tentativas FROM tasks WHERE workflow_id = ? ORDER BY rowid")
            .all(fluxoId) as { id: TarefaId; tipo: TipoTarefa; estado: string; tentativas: number }[]
        );
      },
      eventos(fluxoId) {
        return (
          db
            .query("SELECT seq, tipo, ator FROM events WHERE workflow_id = ? ORDER BY seq")
            .all(fluxoId) as { seq: number; tipo: string; ator: string }[]
        );
      },
      entregas(fluxoId) {
        return (
          db
            .query("SELECT chave, estado, hash_conferido AS hashConferido FROM deliveries WHERE workflow_id = ? ORDER BY rowid")
            .all(fluxoId) as { chave: string; estado: string; hashConferido: string | null }[]
        );
      },
    },
  };
}
