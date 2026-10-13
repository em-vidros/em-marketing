import { tokens } from "./index";

export interface ItemDeCota {
  pilar: keyof typeof tokens.pilares;
  feitos: number;
  ideal: number;
  faltam: number;
}

/**
 * A base é o mês fechado na cadência mínima, não o que já saiu.
 * Com 2 posts publicados, 40% de 2 arredonda para 1: o sistema diria "PROVA no
 * alvo" com o mês inteiro pela frente, e o buraco só apareceria no dia 30.
 */
export function cotaDePilares(feitosPorPilar: Record<string, number>, total: number): { base: number; itens: ItemDeCota[] } {
  const base = Math.max(total, tokens.cadencia.publicacoesPorMesMin);
  const itens = (Object.keys(tokens.pilares) as (keyof typeof tokens.pilares)[]).map((pilar) => {
    const feitos = feitosPorPilar[pilar] ?? 0;
    const ideal = Math.round(tokens.pilares[pilar].percentual * base);
    return { pilar, feitos, ideal, faltam: Math.max(0, ideal - feitos) };
  });
  return { base, itens };
}
