/**
 * Aprovação ligada ao Telegram do Ricardo. O callback carrega o mínimo que
 * identifica a decisão (fluxo, etapa, ação, rodada, opção); o conjunto exato de
 * versões cobertas é resolvido no servidor a partir de
 * workflow_runs.revisao_pendente, gravado quando a revisão abriu. As cinco
 * checagens moram em checar(), rodam numa transação e não escrevem nada se
 * qualquer uma falhar. validarCallback() é a mesma porta sem escrita nenhuma,
 * para a conversa saber se vale a pena pedir a instrução do ajuste.
 *
 * Formato: a|<fluxo12>|<st>|<ac>|<rodada>|<opcao12 ou vazio>. O DESIGN omitiu a
 * rodada e a etapa de ângulo do codec, mas exige recusar botão de rodada velha
 * para qualquer ação e cobre awaiting_angle_selection na máquina do blog; sem os
 * dois campos as duas promessas não fecham. Pior caso 36 bytes, teto 64.
 */

import type { Estagio, EstadoQualquer, FluxoId, RevisaoPendente, VersaoId } from "../modelos/tipos";
import type { Banco } from "./db";
import { emTransacao } from "./db";
import type { Fluxo } from "./fluxos";
import { lerFluxo, registrarEvento, transicionar } from "./fluxos";
import { ID_RE, gerarId } from "./ids";
import { ESPERA } from "./revisoes";
import { cancelarTarefasVivas } from "./tarefas";

export type AcaoCallback = "aceitar" | "ajustar" | "recusar_todas" | "cancelar" | "encerrar";

export interface Callback {
  fluxoId: FluxoId;
  stage: Estagio;
  acao: AcaoCallback;
  rodada: number;
  opcao?: VersaoId;
}

export type MotivoRecusa =
  | "nao_autorizado"
  | "aprovacao_vencida"
  | "estado_incompativel"
  | "callback_invalido";

export type ResultadoDecisao = { ok: true; estado: EstadoQualquer } | { ok: false; motivo: MotivoRecusa };

export type ResultadoValidacao =
  | { ok: true; callback: Callback; revisao: RevisaoPendente }
  | { ok: false; motivo: MotivoRecusa };

const STAGE_PARA_CHAR: Record<Estagio, string> = { prototype: "p", package: "k", copy: "c", angle: "g" };
const CHAR_PARA_STAGE: Record<string, Estagio> = { p: "prototype", k: "package", c: "copy", g: "angle" };
const ACAO_PARA_CHAR: Record<AcaoCallback, string> = {
  aceitar: "a",
  ajustar: "j",
  recusar_todas: "r",
  cancelar: "x",
  encerrar: "e",
};
const CHAR_PARA_ACAO: Record<string, AcaoCallback> = { a: "aceitar", j: "ajustar", r: "recusar_todas", x: "cancelar", e: "encerrar" };

export function codificar(cb: Callback): string {
  if (!ID_RE.test(cb.fluxoId)) throw new Error(`fluxoId fora do alfabeto: ${cb.fluxoId}`);
  if (cb.opcao !== undefined && !ID_RE.test(cb.opcao)) throw new Error(`opcao fora do alfabeto: ${cb.opcao}`);
  if (!Number.isInteger(cb.rodada) || cb.rodada < 1 || cb.rodada > 9999) {
    throw new Error(`rodada fora do intervalo: ${cb.rodada}`);
  }
  const data = ["a", cb.fluxoId, STAGE_PARA_CHAR[cb.stage], ACAO_PARA_CHAR[cb.acao], String(cb.rodada), cb.opcao ?? ""].join("|");
  if (Buffer.byteLength(data, "utf8") > 64) throw new Error(`callback_data com ${data.length} bytes estoura o teto de 64`);
  return data;
}

/** Entrada não confiável: qualquer coisa malformada devolve null, nunca lança. */
export function decodificar(data: unknown): Callback | null {
  if (typeof data !== "string" || data.length > 64 || !/^[\x20-\x7e]*$/.test(data)) return null;
  const partes = data.split("|");
  if (partes.length !== 6 || partes[0] !== "a") return null;
  const [, fluxo, st, ac, rodadaStr, opcao] = partes as [string, string, string, string, string, string];
  const stage = CHAR_PARA_STAGE[st];
  const acao = CHAR_PARA_ACAO[ac];
  if (!stage || !acao || !ID_RE.test(fluxo) || !/^[1-9]\d{0,3}$/.test(rodadaStr)) return null;
  if (opcao !== "" && !ID_RE.test(opcao)) return null;
  return {
    fluxoId: fluxo as FluxoId,
    stage,
    acao,
    rodada: Number(rodadaStr),
    ...(opcao === "" ? {} : { opcao: opcao as VersaoId }),
  };
}

/**
 * Sucessores por etapa e ação, derivados das tabelas de transição. ajustar tem
 * dois saltos porque o sucessor de adjustment_requested depende de onde a
 * revisão estava (DESIGN, Máquinas de estado); os dois saem na mesma transação
 * para reinício não deixar o fluxo parado no meio.
 *
 * No protótipo o aceite também salta duas vezes: prototype_approved não tem
 * tarefa e não é espera humana, então parar nele deixaria o fluxo sem trabalho e
 * sem ninguém para acordá-lo. O destino do segundo salto vem do formato pedido.
 *
 * A opção é obrigatória nas duas ações que apontam para uma peça: aceitar diz
 * qual protótipo vale, ajustar diz qual peça reabrir. Sem ela o designer da
 * rodada seguinte não teria base para editar.
 */
const APOS: Record<
  Estagio,
  {
    aceitar: readonly EstadoQualquer[];
    ajustar?: readonly [EstadoQualquer, EstadoQualquer];
    recusarTodas?: EstadoQualquer;
    exigeOpcaoNoAceite: boolean;
    exigeOpcaoNoAjuste: boolean;
  }
> = {
  prototype: {
    aceitar: ["prototype_approved"],
    ajustar: ["adjustment_requested", "prototypes_generating"],
    recusarTodas: "brief_confirmed",
    exigeOpcaoNoAceite: true,
    exigeOpcaoNoAjuste: true,
  },
  package: {
    aceitar: ["approved_for_manual_delivery"],
    ajustar: ["adjustment_requested", "package_finalizing"],
    exigeOpcaoNoAceite: false,
    exigeOpcaoNoAjuste: true,
  },
  copy: {
    aceitar: ["copy_approved"],
    ajustar: ["adjustment_requested", "draft_generating"],
    exigeOpcaoNoAceite: false,
    exigeOpcaoNoAjuste: false,
  },
  angle: {
    aceitar: ["draft_generating"],
    recusarTodas: "angles_ready",
    exigeOpcaoNoAceite: true,
    exigeOpcaoNoAjuste: false,
  },
};

/** Segundo salto do aceite do protótipo: só o Stories dispensa a revisão de pacote (PRD §4.3). */
function aposAceitarPrototipo(fluxo: Fluxo): readonly EstadoQualquer[] {
  return fluxo.pedido.format === "stories"
    ? ["prototype_approved", "approved_for_manual_delivery"]
    : ["prototype_approved", "package_finalizing"];
}

/** As cinco checagens, sem escrever nada. Devolve o fluxo e a revisão que o callback cobre. */
function checar(
  db: Banco,
  e: { deId: number; aprovadorId: number; data: string },
): { ok: true; cb: Callback; fluxo: Fluxo; revisao: RevisaoPendente } | { ok: false; motivo: MotivoRecusa } {
  const cb = decodificar(e.data);
  if (!cb) return { ok: false, motivo: "callback_invalido" };
  const fluxo = lerFluxo(db, cb.fluxoId);
  if (!fluxo) return { ok: false, motivo: "callback_invalido" };
  // revisor é a pessoa, nunca o chat (DESIGN, Aprovação)
  if (e.deId !== e.aprovadorId) return { ok: false, motivo: "nao_autorizado" };
  const revisao = fluxo.revisaoPendente;
  if (fluxo.estado !== ESPERA[cb.stage] || !revisao || revisao.stage !== cb.stage) {
    return { ok: false, motivo: "estado_incompativel" };
  }
  if (cb.rodada !== fluxo.rodada || revisao.rodada !== fluxo.rodada) {
    return { ok: false, motivo: "aprovacao_vencida" };
  }
  if (cb.opcao && !revisao.versoes.includes(cb.opcao)) {
    return { ok: false, motivo: "aprovacao_vencida" };
  }
  const regra = APOS[cb.stage];
  switch (cb.acao) {
    case "aceitar":
      if (regra.exigeOpcaoNoAceite && !cb.opcao) return { ok: false, motivo: "callback_invalido" };
      break;
    case "ajustar":
      if (!regra.ajustar) return { ok: false, motivo: "estado_incompativel" };
      if (regra.exigeOpcaoNoAjuste && !cb.opcao) return { ok: false, motivo: "callback_invalido" };
      break;
    case "recusar_todas":
      if (!regra.recusarTodas) return { ok: false, motivo: "estado_incompativel" };
      break;
    case "encerrar":
    case "cancelar":
      break;
  }
  return { ok: true, cb, fluxo, revisao };
}

/** Mesma porta de decidir(), sem escrita: a conversa pergunta antes de pedir a instrução. */
export function validarCallback(
  db: Banco,
  e: { deId: number; aprovadorId: number; data: string },
): ResultadoValidacao {
  const r = checar(db, e);
  return r.ok ? { ok: true, callback: r.cb, revisao: r.revisao } : { ok: false, motivo: r.motivo };
}

export function decidir(
  db: Banco,
  e: { deId: number; aprovadorId: number; data: string; notas?: string },
): ResultadoDecisao {
  return emTransacao(db, () => {
    const checagem = checar(db, e);
    if (!checagem.ok) return { ok: false, motivo: checagem.motivo } as const;
    const { cb, fluxo, revisao } = checagem;
    const regra = APOS[cb.stage];

    let destinos: readonly EstadoQualquer[];
    switch (cb.acao) {
      case "aceitar":
        destinos = cb.stage === "prototype" ? aposAceitarPrototipo(fluxo) : regra.aceitar;
        break;
      case "ajustar":
        destinos = regra.ajustar!;
        break;
      case "recusar_todas":
        destinos = [regra.recusarTodas!];
        break;
      case "encerrar":
        destinos = ["rejected"];
        break;
      case "cancelar":
        destinos = ["cancelled"];
        break;
    }

    const decision =
      cb.acao === "aceitar" ? "accepted" : cb.acao === "ajustar" ? "adjustment_requested" : "rejected";
    db.query(
      `INSERT INTO approvals (id, workflow_id, stage, rodada, reviewer_id, decision, artifact_version_ids, opcao, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      gerarId(),
      fluxo.id,
      cb.stage,
      fluxo.rodada,
      e.deId,
      decision,
      JSON.stringify(revisao.versoes),
      cb.opcao ?? null,
      e.notas ?? null,
    );
    registrarEvento(db, {
      fluxoId: fluxo.id,
      tipo: "decisao",
      ator: `telegram:${e.deId}`,
      dados: { stage: cb.stage, acao: cb.acao, rodada: fluxo.rodada, opcao: cb.opcao, versoes: revisao.versoes },
    });

    const rodaDeNovo = cb.acao === "ajustar" || cb.acao === "recusar_todas";
    transicionar(db, {
      fluxoId: fluxo.id,
      para: destinos[0]!,
      ator: `telegram:${e.deId}`,
      incrementaRodada: rodaDeNovo,
      revisaoPendente: null,
    });
    for (const destino of destinos.slice(1)) {
      transicionar(db, { fluxoId: fluxo.id, para: destino, ator: "sistema" });
    }
    if (cb.acao === "cancelar" || cb.acao === "encerrar") cancelarTarefasVivas(db, fluxo.id);
    return { ok: true, estado: destinos[destinos.length - 1]! } as const;
  });
}
