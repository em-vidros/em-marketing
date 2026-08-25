/**
 * Domínio da agência: ids marcados, as duas máquinas de estado do PRD §4.3 e §4.4,
 * e o mapa que liga estado a tarefa obrigatória.
 *
 * Nada aqui toca banco, rede ou modelo. É o alfabeto que o resto da árvore usa.
 */

export type Id<M extends string> = string & { readonly __marca: M };
export type FluxoId = Id<"fluxo">;
export type TarefaId = Id<"tarefa">;
export type VersaoId = Id<"versao">;
export type MarcaId = Id<"marca">;
export type EntregaId = Id<"entrega">;

export type TipoFluxo = "instagram" | "blog";
export type Formato = "feed" | "stories";
export type FormatoPedido = Formato | "both" | "blog";

export type EstadoInstagram =
  | "requested"
  | "brief_confirmed"
  | "directions_ready"
  | "prototypes_generating"
  | "prototype_qa"
  | "awaiting_prototype_review"
  | "adjustment_requested"
  | "prototype_approved"
  | "package_finalizing"
  | "package_qa"
  | "awaiting_package_review"
  | "approved_for_manual_delivery"
  | "delivered"
  | "archived"
  | "rejected"
  | "cancelled"
  | "failed";

export type EstadoBlog =
  | "requested"
  | "brief_confirmed"
  | "angles_ready"
  | "awaiting_angle_selection"
  | "draft_generating"
  | "copy_review"
  | "awaiting_copy_review"
  | "adjustment_requested"
  | "copy_approved"
  | "delivered"
  | "archived"
  | "rejected"
  | "cancelled"
  | "failed";

export type EstadoQualquer = EstadoInstagram | EstadoBlog;

/** Mapped type sobre a união: esquecer um estado não compila. */
type Transicoes<E extends string> = { readonly [S in E]: readonly E[] };

export const TRANSICOES_INSTAGRAM: Transicoes<EstadoInstagram> = {
  requested: ["brief_confirmed", "cancelled", "failed"],
  brief_confirmed: ["directions_ready", "cancelled", "failed"],
  directions_ready: ["prototypes_generating", "cancelled", "failed"],
  prototypes_generating: ["prototype_qa", "cancelled", "failed"],
  // volta para generating quando o diretor de arte reprova e ainda há tentativa
  prototype_qa: ["awaiting_prototype_review", "prototypes_generating", "cancelled", "failed"],
  // "recusar todas" volta para directions_ready com rodada nova; rejected é encerrar de vez
  awaiting_prototype_review: [
    "prototype_approved",
    "adjustment_requested",
    "directions_ready",
    "rejected",
    "cancelled",
  ],
  adjustment_requested: ["prototypes_generating", "package_finalizing", "cancelled", "failed"],
  // formato único pula a revisão de pacote (PRD §4.3)
  prototype_approved: ["package_finalizing", "approved_for_manual_delivery", "cancelled"],
  package_finalizing: ["package_qa", "cancelled", "failed"],
  package_qa: ["awaiting_package_review", "package_finalizing", "cancelled", "failed"],
  awaiting_package_review: [
    "approved_for_manual_delivery",
    "adjustment_requested",
    "rejected",
    "cancelled",
  ],
  approved_for_manual_delivery: ["delivered", "failed"],
  delivered: ["archived", "failed"],
  archived: [],
  rejected: [],
  cancelled: [],
  failed: [],
};

export const TRANSICOES_BLOG: Transicoes<EstadoBlog> = {
  requested: ["brief_confirmed", "cancelled", "failed"],
  brief_confirmed: ["angles_ready", "cancelled", "failed"],
  angles_ready: ["awaiting_angle_selection", "cancelled", "failed"],
  awaiting_angle_selection: ["draft_generating", "angles_ready", "rejected", "cancelled"],
  draft_generating: ["copy_review", "cancelled", "failed"],
  copy_review: ["awaiting_copy_review", "draft_generating", "cancelled", "failed"],
  awaiting_copy_review: ["copy_approved", "adjustment_requested", "rejected", "cancelled"],
  adjustment_requested: ["draft_generating", "cancelled", "failed"],
  copy_approved: ["delivered", "failed"],
  delivered: ["archived", "failed"],
  archived: [],
  rejected: [],
  cancelled: [],
  failed: [],
};

export const TERMINAIS = ["archived", "rejected", "cancelled", "failed"] as const;

export function ehTerminal(estado: EstadoQualquer): boolean {
  return (TERMINAIS as readonly string[]).includes(estado);
}

export function transicoesDe(tipo: TipoFluxo): Record<string, readonly string[]> {
  return tipo === "instagram" ? TRANSICOES_INSTAGRAM : TRANSICOES_BLOG;
}

export function arestaLegal(tipo: TipoFluxo, de: EstadoQualquer, para: EstadoQualquer): boolean {
  return (transicoesDe(tipo)[de] ?? []).includes(para);
}

export type Papel =
  | "diretor_criativo"
  | "redator"
  | "designer"
  | "diretor_de_arte"
  | "operacoes";

export type TipoTarefa =
  | "direcao_criativa"
  | "design_prototipos"
  | "qa_visual"
  | "finalizar_pacote"
  | "redacao_angulos"
  | "redacao_artigo"
  | "revisao_copy"
  | "entrega"
  | "arquivar_linear";

export const PAPEL_DA_TAREFA: Record<TipoTarefa, Papel> = {
  direcao_criativa: "diretor_criativo",
  design_prototipos: "designer",
  qa_visual: "diretor_de_arte",
  finalizar_pacote: "designer",
  redacao_angulos: "redator",
  redacao_artigo: "redator",
  revisao_copy: "diretor_de_arte",
  entrega: "operacoes",
  arquivar_linear: "operacoes",
};

/**
 * Regra que sustenta a segurança no reinício: estar num estado obriga a existência
 * de uma tarefa viva. O reconciliador consulta este mapa e recria o que faltar, em
 * vez de depender de qualquer coisa que só existia na memória do processo morto.
 *
 * Estado ausente daqui é espera humana, e para esses a segurança no reinício é
 * justamente a ausência de trabalho.
 */
export const TAREFA_DO_ESTADO: Partial<Record<EstadoQualquer, TipoTarefa>> = {
  brief_confirmed: "direcao_criativa",
  directions_ready: "design_prototipos",
  prototypes_generating: "design_prototipos",
  prototype_qa: "qa_visual",
  package_finalizing: "finalizar_pacote",
  package_qa: "qa_visual",
  approved_for_manual_delivery: "entrega",
  delivered: "arquivar_linear",
  angles_ready: "redacao_angulos",
  draft_generating: "redacao_artigo",
  copy_review: "revisao_copy",
};

export type Estagio = "prototype" | "package" | "copy" | "angle";
export type Decisao = "accepted" | "adjustment_requested" | "rejected";

/** Pedido criativo do PRD §3.3, guardado em workflow_runs.pedido_json. */
export interface Pedido {
  theme: string;
  format: FormatoPedido;
  objective?: string;
  constraints?: Record<string, unknown>;
}

/** Direção visual do PRD §3.3. */
export interface DirecaoVisual {
  direction_id: string;
  territory: string;
  composition: string;
  palette: string[];
  typography: string;
  main_element: string;
  headline: string;
  support_text?: string;
  logo_rule: string;
  rationale: string;
  prohibited_elements: string[];
}

/** O que foi de fato apresentado numa revisão, gravado ao abrir a rodada. */
export interface RevisaoPendente {
  stage: Estagio;
  rodada: number;
  versoes: VersaoId[];
}
