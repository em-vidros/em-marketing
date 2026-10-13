import { diaPorExtenso, type Dia } from "./datas";

export const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const QUANTOS = new Intl.PluralRules("pt-BR");

/** O nome de uma casa para o leitor de tela: o dia por extenso, se é hoje e quantos itens tem. */
export function rotuloDoDia(dia: Dia, itens: number, hj: Dia): string {
  const contagem = itens === 0 ? "nada marcado" : `${itens} ${QUANTOS.select(itens) === "one" ? "item" : "itens"}`;
  return [dia === hj ? "Hoje" : null, diaPorExtenso(dia), contagem].filter(Boolean).join(", ");
}
