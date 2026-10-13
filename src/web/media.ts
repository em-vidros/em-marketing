import { useSyncExternalStore } from "react";

/** O breakpoint md do Tailwind: daqui para cima a barra lateral é fixa; abaixo, gaveta. */
export const DESKTOP = "(min-width: 48rem)";

/** Abaixo do lg, o painel lateral cobre a tela em vez de virar coluna. */
export const ESTREITO = "(max-width: 63.99rem)";

export function useMedia(consulta: string): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const m = matchMedia(consulta);
      m.addEventListener("change", avisar);
      return () => m.removeEventListener("change", avisar);
    },
    () => matchMedia(consulta).matches,
  );
}

/**
 * Deixa inerte tudo fora de `el`, subindo até o body: o Tab e o leitor de tela ficam presos
 * nele, como num dialog modal. `poupar` escapa de ficar inerte (o fundo que fecha no clique).
 * Devolve a função que desfaz.
 */
export function inertizarFora(el: Element, poupar = "[data-fecha-painel]"): () => void {
  const feitos: HTMLElement[] = [];
  for (let n: Element = el; n.parentElement && n !== document.body; n = n.parentElement)
    for (const irmao of n.parentElement.children)
      if (irmao !== n && irmao instanceof HTMLElement && !irmao.inert && !irmao.matches(poupar)) {
        irmao.inert = true;
        feitos.push(irmao);
      }
  return () => feitos.forEach((e) => (e.inert = false));
}
