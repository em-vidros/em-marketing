import type { Transition } from "motion/react";

/** Mola criticamente amortecida, sem quique (apple-design: damping 1.0, response ~0.35s). */
export const MOLA: Transition = { type: "spring", bounce: 0, duration: 0.35 };

/** Com movimento reduzido só a opacidade muda, num fade curto. */
export const MOLA_REDUZIDA: Transition = { duration: 0.2, ease: "easeOut" };
