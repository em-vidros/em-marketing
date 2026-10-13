import { useSyncExternalStore } from "react";

export interface Desfazivel {
  chave: number;
  desfazer: () => void | Promise<void>;
}

/**
 * A pilha de desfazer do app inteiro: conversas, config de bot, o que vier. O ⌘Z e o botão
 * do toast consomem a mesma entrada, então nada é desfeito duas vezes.
 */
export function criarPilhaDeDesfazer(limite = 20) {
  const pilha: Desfazivel[] = [];
  const ouvintes = new Set<() => void>();
  let proximaChave = 1;
  const avisar = () => {
    for (const o of ouvintes) o();
  };

  /** Tira da pilha antes de rodar. */
  async function consumir(chave: number): Promise<void> {
    const i = pilha.findIndex((d) => d.chave === chave);
    if (i < 0) return;
    const [d] = pilha.splice(i, 1);
    avisar();
    await d!.desfazer();
  }

  return {
    empilhar(desfazer: Desfazivel["desfazer"]): number {
      const chave = proximaChave++;
      pilha.push({ chave, desfazer });
      if (pilha.length > limite) pilha.shift();
      avisar();
      return chave;
    },
    contem: (chave: number) => pilha.some((d) => d.chave === chave),
    /** Tira sem rodar: a ação falhou, ou o desfazer não faz mais sentido. */
    descartar(chave: number) {
      const i = pilha.findIndex((d) => d.chave === chave);
      if (i < 0) return;
      pilha.splice(i, 1);
      avisar();
    },
    consumir,
    /** O ⌘Z: desfaz a entrada mais nova e devolve a chave dela, ou null com a pilha vazia. */
    desfazerUltimo(): number | null {
      const d = pilha.at(-1);
      if (!d) return null;
      void consumir(d.chave);
      return d.chave;
    },
    vazia: () => pilha.length === 0,
    assinar(o: () => void) {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
  };
}

export type PilhaDeDesfazer = ReturnType<typeof criarPilhaDeDesfazer>;

export const pilhaDeDesfazer = criarPilhaDeDesfazer();

export const useTemDesfazer = () => !useSyncExternalStore(pilhaDeDesfazer.assinar, pilhaDeDesfazer.vazia);
