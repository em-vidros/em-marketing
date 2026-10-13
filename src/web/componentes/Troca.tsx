import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const TEMPO = { duration: 0.15, ease: [0.23, 1, 0.32, 1] } as const;

/**
 * Troca o conteúdo de um botão (ícone, rótulo) num crossfade curto. O desfoque junta os dois
 * estados num só durante a troca; com movimento reduzido fica só a opacidade.
 */
export function Troca({ chave, children, className = "" }: { chave: string; children: ReactNode; className?: string }) {
  const reduzir = useReducedMotion();
  const fora = reduzir ? { opacity: 0 } : { opacity: 0, transform: "scale(0.9)", filter: "blur(2px)" };
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={chave}
        initial={fora}
        animate={reduzir ? { opacity: 1 } : { opacity: 1, transform: "scale(1)", filter: "blur(0px)" }}
        exit={fora}
        transition={TEMPO}
        className={className}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}
