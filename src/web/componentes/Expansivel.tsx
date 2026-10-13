import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import type { ReactNode } from "react";
import { MOLA } from "../movimento";

const SAIDA: Transition = { duration: 0.2, ease: [0.23, 1, 0.32, 1] };

/**
 * Abre e fecha na altura, de 0 até a do conteúdo, para o que vem embaixo descer junto em vez
 * de pular. Com movimento reduzido a altura muda de uma vez e só a opacidade anima.
 */
export function Expansivel({ aberto, className = "", children }: { aberto: boolean; className?: string; children: ReactNode }) {
  const reduzir = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {aberto && (
        <motion.div
          key="conteudo"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, transition: { height: reduzir ? { duration: 0 } : MOLA, opacity: SAIDA } }}
          exit={{ height: 0, opacity: 0, transition: { height: reduzir ? { duration: 0, delay: SAIDA.duration } : SAIDA, opacity: SAIDA } }}
          className="overflow-hidden"
        >
          <div className={className}>{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
