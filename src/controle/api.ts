/**
 * Costura do plano de controle: uma porta para workers (ControlePlano), uma para
 * o webhook (EntradaTelegram), o reconciliador e a inspeção somente leitura do
 * arnês. Todo estado mora no banco; nada aqui vive só na memória.
 *
 * O pacote de contexto carrega resumo de artefato e de decisão porque a escolha
 * do worker tem que ser função do banco: uma tarefa repetida depois de uma queda
 * lê a mesma coisa e converge para o mesmo trabalho. Bytes continuam saindo por
 * lerArtefato, que é o único caminho que confere o hash antes de devolver.
 */

import { dirname, join } from "node:path";
import type { Adaptadores, ContextoMarca } from "../adaptadores/tipos";
import type {
  Decisao,
  Estagio,
  EstadoConversa,
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
import { criarFluxo, fluxoAtivoDoChat, lerFluxo, transicionar } from "./fluxos";
import type { Lease, SaidaTarefa, Tarefa } from "./tarefas";
import {
  bater,
  cancelarTarefasVivas,
  concluir,
  falhar,
  reivindicar,
  visitaDaTarefa,
} from "./tarefas";
import type { ArtefatoLido, NovoArtefato } from "./artefatos";
import { lerArtefato, publicarArtefato } from "./artefatos";
import type { OpcoesUmaVez } from "./idempotencia";
import { executarUmaVez } from "./idempotencia";
import type { ResultadoDecisao, ResultadoValidacao } from "./aprovacoes";
import { decidir, validarCallback } from "./aprovacoes";
import type { RevisaoAberta } from "./revisoes";
import { abrirRevisao, revisoesAbertas } from "./revisoes";
import { lerConversa, gravarConversa } from "./conversas";
import { executarEntregas } from "./entregas";
import { reconciliar } from "./reconciliador";

export type { Lease, SaidaTarefa } from "./tarefas";
export type { NovoArtefato } from "./artefatos";
export type { ResultadoDecisao, ResultadoValidacao } from "./aprovacoes";
export type { RevisaoAberta } from "./revisoes";

export interface ResumoArtefato {
  readonly id: VersaoId;
  readonly papel: NovoArtefato["papel"];
  readonly formato: Formato | null;
  readonly rodada: number;
  readonly linhagemId: string;
  readonly versao: number;
  readonly sha256: string;
  readonly mediaTipo: string;
  readonly derivadaDe: VersaoId | null;
  readonly meta: Record<string, unknown> | null;
}

export interface ResumoDecisao {
  readonly stage: Estagio;
  readonly rodada: number;
  readonly decision: Decisao;
  readonly opcao: VersaoId | null;
  readonly notas: string | null;
  /** Versões exatas que a decisão cobre (PRD §3.3). */
  readonly versoes: readonly VersaoId[];
}

export interface PacoteContexto {
  readonly fluxoId: FluxoId;
  readonly tipo: TipoFluxo;
  readonly estado: EstadoQualquer;
  readonly rodada: number;
  readonly chatId: number;
  readonly marca: ContextoMarca;
  readonly pedido: Pedido;
  /** Do fluxo inteiro, em ordem de criação. */
  readonly artefatos: readonly ResumoArtefato[];
  /** Em ordem de decisão. */
  readonly decisoes: readonly ResumoDecisao[];
}

export interface TarefaAtribuida {
  readonly lease: Lease;
  readonly tipo: TipoTarefa;
  readonly fluxoId: FluxoId;
  readonly entrada: unknown;
  readonly contexto: PacoteContexto;
  readonly tentativa: number;
  /** Quantas vezes esta tarefa já foi criada nesta rodada, esta incluída. Fecha o laço de QA. */
  readonly visita: number;
}

export interface ControlePlano {
  reivindicar(papel: Papel, dono: string): TarefaAtribuida | null;
  bater(lease: Lease): boolean;
  publicarArtefato(lease: Lease, a: NovoArtefato): VersaoId;
  executarUmaVez<T>(
    chave: string,
    efeito: () => Promise<T>,
    opcoes?: OpcoesUmaVez,
  ): Promise<{ novo: boolean; resultado: T }>;
  concluir(lease: Lease, saida: SaidaTarefa): void;
  falhar(lease: Lease, erro: { tipo: "transitoria" | "permanente"; mensagem: string }): "pendente" | "revisao_manual";
  lerArtefato(id: VersaoId): ArtefatoLido;
  resumoArtefato(id: VersaoId): ResumoArtefato;
  artefatosDoFluxo(fluxoId: FluxoId): readonly ResumoArtefato[];
  /** O executor de entrega confere o desfecho: executarEntregas transiciona sozinho. */
  estadoDoFluxo(fluxoId: FluxoId): EstadoQualquer;
  revisoesAbertas(): readonly RevisaoAberta[];
  executarEntregas(fluxoId: FluxoId): Promise<void>;
  reconciliar(): void;
}

export interface EntradaTelegram {
  criarFluxo(e: { tipo: TipoFluxo; chatId: number; solicitanteId: number; pedido: Pedido }): FluxoId;
  confirmarBrief(fluxoId: FluxoId): void;
  abrirRevisao(fluxoId: FluxoId, stage: Estagio, versoes: readonly VersaoId[], aviso?: string): void;
  validarCallback(e: { deId: number; data: string }): ResultadoValidacao;
  aoCallback(e: { deId: number; callbackId: string; data: string; notas?: string }): ResultadoDecisao;
  cancelar(fluxoId: FluxoId, porId: number): void;
  fluxoAtivoDoChat(chatId: number): Fluxo | null;
  conversa: {
    ler(chatId: number): EstadoConversa;
    gravar(chatId: number, estado: EstadoConversa): void;
  };
  executarEntregas(fluxoId: FluxoId): Promise<void>;
}

const MOTIVO_TEXTO: Record<Exclude<ResultadoDecisao, { ok: true }>["motivo"], string> = {
  nao_autorizado: "Só o aprovador decide.",
  aprovacao_vencida: "Esse botão é de uma rodada que já fechou.",
  estado_incompativel: "Essa revisão não está mais aberta.",
  callback_invalido: "Botão inválido.",
};

interface LinhaResumo {
  id: string;
  papel: string;
  formato: string | null;
  rodada: number;
  linhagem_id: string;
  versao: number;
  sha256: string;
  media_tipo: string;
  derivada_de: string | null;
  meta_json: string | null;
}

const COLUNAS_RESUMO =
  "id, papel, formato, rodada, linhagem_id, versao, sha256, media_tipo, derivada_de, meta_json";

function paraResumo(l: LinhaResumo): ResumoArtefato {
  return {
    id: l.id as VersaoId,
    papel: l.papel as NovoArtefato["papel"],
    formato: (l.formato as Formato | null) ?? null,
    rodada: l.rodada,
    linhagemId: l.linhagem_id,
    versao: l.versao,
    sha256: l.sha256,
    mediaTipo: l.media_tipo,
    derivadaDe: (l.derivada_de as VersaoId | null) ?? null,
    meta: l.meta_json ? (JSON.parse(l.meta_json) as Record<string, unknown>) : null,
  };
}

function artefatosDoFluxo(db: Banco, fluxoId: FluxoId): ResumoArtefato[] {
  return (
    db
      .query(`SELECT ${COLUNAS_RESUMO} FROM artifact_versions WHERE workflow_id = ? ORDER BY rowid`)
      .all(fluxoId) as LinhaResumo[]
  ).map(paraResumo);
}

function decisoesDoFluxo(db: Banco, fluxoId: FluxoId): ResumoDecisao[] {
  return (
    db
      .query(
        "SELECT stage, rodada, decision, opcao, notas, artifact_version_ids FROM approvals WHERE workflow_id = ? ORDER BY rowid",
      )
      .all(fluxoId) as {
      stage: string;
      rodada: number;
      decision: string;
      opcao: string | null;
      notas: string | null;
      artifact_version_ids: string;
    }[]
  ).map((l) => ({
    stage: l.stage as Estagio,
    rodada: l.rodada,
    decision: l.decision as Decisao,
    opcao: (l.opcao as VersaoId | null) ?? null,
    notas: l.notas,
    versoes: JSON.parse(l.artifact_version_ids) as VersaoId[],
  }));
}

function montarContexto(db: Banco, fluxo: Fluxo): PacoteContexto {
  const marca = db
    .query("SELECT id, brandbook, voz, tokens, estilos FROM brand_versions WHERE id = ?")
    .get(fluxo.brandVersionId) as { id: string; brandbook: string; voz: string; tokens: string; estilos: string };
  return {
    fluxoId: fluxo.id,
    tipo: fluxo.tipo,
    estado: fluxo.estado,
    rodada: fluxo.rodada,
    chatId: fluxo.chatId,
    marca: {
      brandVersionId: marca.id,
      brandbook: marca.brandbook,
      voz: marca.voz,
      tokens: JSON.parse(marca.tokens) as unknown,
      estilos: JSON.parse(marca.estilos) as Record<string, string>,
    },
    pedido: fluxo.pedido,
    artefatos: artefatosDoFluxo(db, fluxo.id),
    decisoes: decisoesDoFluxo(db, fluxo.id),
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
    entregas(fluxoId: FluxoId): { chave: string; estado: string; hashConferido: string | null; nome: string }[];
    artefatos(fluxoId: FluxoId): ResumoArtefato[];
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
          visita: visitaDaTarefa(db, tarefa),
        };
      });
    },
    bater: (lease) => bater(db, lease),
    publicarArtefato: (lease, a) => publicarArtefato(db, artefatosDir, lease, a),
    executarUmaVez: (chave, efeito, opcoes) => executarUmaVez(db, chave, efeito, opcoes),
    concluir: (lease, saida) => concluir(db, lease, saida),
    falhar: (lease, erro) => falhar(db, lease, erro),
    lerArtefato: (id) => lerArtefato(db, id),
    resumoArtefato(id) {
      const linha = db
        .query(`SELECT ${COLUNAS_RESUMO} FROM artifact_versions WHERE id = ?`)
        .get(id) as LinhaResumo | null;
      if (!linha) throw new Error(`versão ${id} não existe`);
      return paraResumo(linha);
    },
    artefatosDoFluxo: (fluxoId) => artefatosDoFluxo(db, fluxoId),
    estadoDoFluxo(fluxoId) {
      const fluxo = lerFluxo(db, fluxoId);
      if (!fluxo) throw new Error(`fluxo ${fluxoId} não existe`);
      return fluxo.estado;
    },
    revisoesAbertas: () => revisoesAbertas(db),
    executarEntregas: (fluxoId) => executarEntregas(db, opts.adaptadores, fluxoId),
    reconciliar: () => reconciliar(db),
  };

  const paraTelegram: EntradaTelegram = {
    criarFluxo: (e) => criarFluxo(db, e),
    confirmarBrief(fluxoId) {
      const fluxo = lerFluxo(db, fluxoId);
      if (!fluxo) throw new Error(`fluxo ${fluxoId} não existe`);
      transicionar(db, { fluxoId, para: "brief_confirmed", ator: `telegram:${fluxo.solicitanteId}` });
    },
    abrirRevisao: (fluxoId, stage, versoes, aviso) => abrirRevisao(db, fluxoId, stage, versoes, aviso),
    validarCallback: (e) => validarCallback(db, { ...e, aprovadorId: opts.aprovadorId }),
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
    fluxoAtivoDoChat: (chatId) => fluxoAtivoDoChat(db, chatId),
    conversa: {
      ler: (chatId) => lerConversa(db, chatId),
      gravar: (chatId, estado) => gravarConversa(db, chatId, estado),
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
            .query(
              `SELECT d.chave, d.estado, d.hash_conferido AS hashConferido, v.papel || ':' || ifnull(v.formato, '') AS nome
               FROM deliveries d JOIN artifact_versions v ON v.id = d.artifact_version_id
               WHERE d.workflow_id = ? ORDER BY d.rowid`,
            )
            .all(fluxoId) as { chave: string; estado: string; hashConferido: string | null; nome: string }[]
        );
      },
      artefatos: (fluxoId) => artefatosDoFluxo(db, fluxoId),
    },
  };
}
