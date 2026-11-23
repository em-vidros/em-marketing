import type { Brief, Pilar } from "./art/pipeline";

/** GLOSSARY.md, Público. Cada post fala com um só deles (§1.2 do brandbook). */
export const PUBLICOS = ["vidraceiro", "arquiteto", "consumidor"] as const;
export type Publico = (typeof PUBLICOS)[number];

/**
 * O brandbook não dá um público padrão por pilar: o primário é o B2B (§1.2). O pedido que não diz
 * para quem é cai no vidraceiro, que é quem compra da EM Vidros.
 */
export const publicoPadrao = (_pilar: Pilar): Publico => "vidraceiro";

/** Brief antigo, gravado antes do campo, vale como vidraceiro. */
export const publicoDoBrief = (brief: Pick<Brief, "pilar" | "publico">): Publico => brief.publico ?? publicoPadrao(brief.pilar);

/** Arquiteto e consumidor não compram da EM Vidros. Eles são levados a uma vidraçaria parceira. */
export const levaAVidracariaParceira = (publico: Publico) => publico !== "vidraceiro";

export const CTA_DA_VIDRACARIA_PARCEIRA = "Procure uma vidraçaria parceira EM Vidros.";

const QUEM: Record<Publico, string> = {
  vidraceiro: "vidraceiro, a vidraçaria que compra da EM Vidros e revende. Fale de profissional para profissional: especificação, norma, prazo.",
  arquiteto: "arquiteto, que especifica o projeto mas não compra da EM Vidros. Fale de especificação e de norma, sem explicar o básico.",
  consumidor: "consumidor final, que decide box, janela, guarda-corpo ou espelho e não compra da EM Vidros. Traduza o termo técnico, sem simplificar.",
};

/** Para quem o texto fala. */
export const quemEOPublico = (publico: Publico) => `Público deste post: ${QUEM[publico]}`;

/** Aonde a chamada do post leva, e o que ela nunca diz (§10.3). */
export const chamadaDoPublico = (publico: Publico) =>
  levaAVidracariaParceira(publico)
    ? `A chamada leva à vidraçaria parceira: "${CTA_DA_VIDRACARIA_PARCEIRA}". Nunca "compre com a gente", "fale com a EM", "fale com a unidade" nem "peça o orçamento pelo 0800", porque a EM Vidros não atende esse público direto.`
    : 'A chamada pode levar direto à EM Vidros: "Fale com a unidade mais próxima." ou "Peça o orçamento pelo 0800 150 0103.".';

/** O brief de um post novo. O público que o pedido não disse sai do padrão do pilar. */
export function montarBrief(entrada: Omit<Brief, "publico"> & { publico?: Publico }): Brief {
  return { ...entrada, publico: entrada.publico ?? publicoPadrao(entrada.pilar) };
}
