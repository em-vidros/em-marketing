import type { Transition } from "motion/react";
import { useRef } from "react";

/** A curva do token --ease-saida (estilo.css), para o motion e o WAAPI. */
export const CURVA_SAIDA = [0.23, 1, 0.32, 1] as const;

/** Saída e troca curtas na curva do token: 200 ms para o que sai, 150 ms para o que troca no lugar. */
export const SAIDA: Transition = { duration: 0.2, ease: CURVA_SAIDA };
export const TROCA: Transition = { duration: 0.15, ease: CURVA_SAIDA };

/** Mola criticamente amortecida, sem quique (apple-design: damping 1.0, response ~0.35s). */
export const MOLA: Transition = { type: "spring", bounce: 0, duration: 0.35 };

/** Com movimento reduzido só a opacidade muda, num fade curto. */
export const MOLA_REDUZIDA: Transition = { duration: 0.2, ease: "easeOut" };

/**
 * Diz quais itens chegaram depois da primeira pintura da lista. Só esses entram com movimento:
 * abrir uma conversa antiga mostra o histórico parado, sem replay.
 */
export function useChegouDepois(ids: readonly string[]): (id: string) => boolean {
  const iniciais = useRef<ReadonlySet<string> | null>(null);
  iniciais.current ??= new Set(ids);
  return (id) => !iniciais.current!.has(id);
}
