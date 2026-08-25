/**
 * Aprovação ligada ao Telegram do Ricardo. O callback carrega o mínimo que
 * identifica a decisão (fluxo, etapa, ação, rodada, opção); o conjunto exato de
 * versões cobertas é resolvido no servidor a partir de
 * workflow_runs.revisao_pendente, gravado quando a revisão abriu. decidir() roda
 * as cinco checagens numa transação e não escreve nada se qualquer uma falhar.
 *
 * Formato: a|<fluxo12>|<st>|<ac>|<rodada>|<opcao12 ou vazio>. O DESIGN omitiu a
 * rodada e a etapa de ângulo do codec, mas exige recusar botão de rodada velha
 * para qualquer ação e cobre awaiting_angle_selection na máquina do blog; sem os
 * dois campos as duas promessas não fecham. Pior caso 36 bytes, teto 64.
 */

import type { Estagio, EstadoQualquer, FluxoId, VersaoId } from "../modelos/tipos";
import type { Banco } from "./db";
import { emTransacao } from "./db";
import { lerFluxo, registrarEvento, transicionar } from "./fluxos";
import { ID_RE, gerarId } from "./ids";
import { cancelarTarefasVivas } from "./tarefas";

export type AcaoCallback = "aceitar" | "ajustar" | "recusar_todas" | "cancelar" | "encerrar";

export interface Callback {
  fluxoId: FluxoId;
  stage: Estagio;
  acao: AcaoCallback;
  rodada: number;
  opcao?: VersaoId;
}

export type ResultadoDecisao =
  | { ok: true; estado: EstadoQualquer }
  | { ok: false; motivo: "nao_autorizado" | "aprovacao_vencida" | "estado_incompativel" | "callback_invalido" };

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

const ESPERA: Record<Estagio, EstadoQualquer> = {
  prototype: "awaiting_prototype_review",
  package: "awaiting_package_review",
  copy: "awaiting_copy_review",
  angle: "awaiting_angle_selection",
};

/**
 * Sucessores por etapa e ação, derivados das tabelas de transição. ajustar tem
 * dois saltos porque o sucessor de adjustment_requested depende de onde a
 * revisão estava (DESIGN, Máquinas de estado); os dois saem na mesma transação
 * para reinício não deixar o fluxo parado no meio.
 */
const APOS: Record<
  Estagio,
  {
    aceitar: EstadoQualquer;
    ajustar?: readonly [EstadoQualquer, EstadoQualquer];
    recusarTodas?: EstadoQualquer;
    exigeOpcao: boolean;
  }
> = {
  prototype: {
    aceitar: "prototype_approved",
    ajustar: ["adjustment_requested", "prototypes_generating"],
    recusarTodas: "directions_ready",
    exigeOpcao: true,
  },
  package: { aceitar: "approved_for_manual_delivery", ajustar: ["adjustment_requested", "package_finalizing"], exigeOpcao: false },
  copy: { aceitar: "copy_approved", ajustar: ["adjustment_requested", "draft_generating"], exigeOpcao: false },
  angle: { aceitar: "draft_generating", recusarTodas: "angles_ready", exigeOpcao: true },
};

/** Abre a rodada de revisão: grava revisao_pendente na mesma transação da aresta para awaiting_*. */
export function abrirRevisao(db: Banco, fluxoId: FluxoId, stage: Estagio, versoes: readonly VersaoId[]): void {
  if (versoes.length === 0) throw new Error("revisão sem versões");
  emTransacao(db, () => {
    const fluxo = lerFluxo(db, fluxoId);
    if (!fluxo) throw new Error(`fluxo ${fluxoId} não existe`);
    const marcadores = versoes.map(() => "?").join(",");
    const { n } = db
      .query(`SELECT COUNT(*) AS n FROM artifact_versions WHERE workflow_id = ? AND id IN (${marcadores})`)
      .get(fluxoId, ...versoes) as { n: number };
    if (n !== versoes.length) throw new Error(`revisão cita versão que não é do fluxo ${fluxoId}`);
    transicionar(db, {
      fluxoId,
      para: ESPERA[stage],
      ator: "sistema",
      revisaoPendente: { stage, rodada: fluxo.rodada, versoes: [...versoes] },
      dados: { stage, versoes },
    });
  });
}

export function decidir(
  db: Banco,
  e: { deId: number; aprovadorId: number; data: string; notas?: string },
): ResultadoDecisao {
  const cb = decodificar(e.data);
  if (!cb) return { ok: false, motivo: "callback_invalido" };
  return emTransacao(db, () => {
    const fluxo = lerFluxo(db, cb.fluxoId);
    if (!fluxo) return { ok: false, motivo: "callback_invalido" } as const;
    // revisor é a pessoa, nunca o chat (DESIGN, Aprovação)
    if (e.deId !== e.aprovadorId) return { ok: false, motivo: "nao_autorizado" } as const;
    const revisao = fluxo.revisaoPendente;
    if (fluxo.estado !== ESPERA[cb.stage] || !revisao || revisao.stage !== cb.stage) {
      return { ok: false, motivo: "estado_incompativel" } as const;
    }
    if (cb.rodada !== fluxo.rodada || revisao.rodada !== fluxo.rodada) {
      return { ok: false, motivo: "aprovacao_vencida" } as const;
    }
    if (cb.opcao && !revisao.versoes.includes(cb.opcao)) {
      return { ok: false, motivo: "aprovacao_vencida" } as const;
    }

    const regra = APOS[cb.stage];
    let destinos: readonly EstadoQualquer[];
    switch (cb.acao) {
      case "aceitar":
        if (regra.exigeOpcao && !cb.opcao) return { ok: false, motivo: "callback_invalido" } as const;
        destinos = [regra.aceitar];
        break;
      case "ajustar":
        if (!regra.ajustar) return { ok: false, motivo: "estado_incompativel" } as const;
        destinos = regra.ajustar;
        break;
      case "recusar_todas":
        if (!regra.recusarTodas) return { ok: false, motivo: "estado_incompativel" } as const;
        destinos = [regra.recusarTodas];
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
