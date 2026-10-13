import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { ESTREITO, inertizarFora, useMedia } from "../media";
import { MOLA, MOLA_REDUZIDA } from "../movimento";

interface Jeito {
  /** Aberto ou fechado pelo teclado (⌘I): troca na hora, sem animar. */
  instantaneo: boolean;
  reduzir: boolean;
  /** Abaixo do lg: cobre a tela, entra e sai pela direita. */
  estreito: boolean;
}

const SEM_TEMPO = { duration: 0 };

const COLUNA: Variants = {
  fora: ({ instantaneo, reduzir }: Jeito) =>
    instantaneo ? { opacity: 1, transform: "translateX(0px)" } : reduzir ? { opacity: 0 } : { opacity: 0, transform: "translateX(24px)" },
  dentro: ({ instantaneo, reduzir }: Jeito) => ({
    opacity: 1,
    transform: "translateX(0px)",
    transition: instantaneo ? SEM_TEMPO : reduzir ? MOLA_REDUZIDA : MOLA,
  }),
  // Como coluna, sai só no fade e rápido: o espaço que ela ocupa some em 150 ms em vez de ficar vazio.
  saindo: ({ instantaneo, reduzir, estreito }: Jeito) =>
    instantaneo
      ? { opacity: 0, transition: SEM_TEMPO }
      : reduzir
        ? { opacity: 0, transition: MOLA_REDUZIDA }
        : estreito
          ? { opacity: 0, transform: "translateX(24px)", transition: MOLA }
          : { opacity: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

const FUNDO: Variants = {
  fora: { opacity: 0 },
  dentro: ({ instantaneo }: Jeito) => ({ opacity: 1, transition: instantaneo ? SEM_TEMPO : MOLA_REDUZIDA }),
  saindo: ({ instantaneo }: Jeito) => ({ opacity: 0, transition: instantaneo ? SEM_TEMPO : MOLA_REDUZIDA }),
};

/**
 * Coluna à direita a partir do lg; abaixo, cobre a tela sobre um fundo escuro e vira modal:
 * o resto da página fica inerte, e o Tab e o Esc ficam com o painel. O conteúdo cuida do
 * próprio foco inicial; quem abre cuida de devolver o foco.
 */
export function PainelLateral({
  aberto,
  rotulo,
  fechar,
  instantaneo = false,
  className = "",
  children,
}: {
  aberto: boolean;
  rotulo: string;
  fechar: () => void;
  instantaneo?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const jeito: Jeito = { instantaneo, reduzir: !!useReducedMotion(), estreito: useMedia(ESTREITO) };
  return (
    <AnimatePresence custom={jeito}>
      {aberto && (
        <motion.div
          key="fundo"
          aria-hidden="true"
          data-fecha-painel
          onClick={() => fechar()}
          custom={jeito}
          variants={FUNDO}
          initial="fora"
          animate="dentro"
          exit="saindo"
          className="fixed inset-0 z-30 bg-tinta/20 lg:hidden"
        />
      )}
      {aberto && (
        <Coluna key="painel" rotulo={rotulo} fechar={fechar} jeito={jeito} className={className}>
          {children}
        </Coluna>
      )}
    </AnimatePresence>
  );
}

function Coluna({ rotulo, fechar, jeito, className, children }: { rotulo: string; fechar: () => void; jeito: Jeito; className: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const modal = jeito.estreito;
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && fechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [fechar]);
  useEffect(() => (modal && ref.current ? inertizarFora(ref.current) : undefined), [modal]);
  return (
    <motion.aside
      ref={ref}
      role={modal ? "dialog" : undefined}
      aria-modal={modal || undefined}
      aria-label={rotulo}
      custom={jeito}
      variants={COLUNA}
      initial="fora"
      animate="dentro"
      exit="saindo"
      className={`fixed inset-y-0 right-0 z-40 w-full max-w-[420px] border-l border-linha bg-painel lg:static lg:z-auto lg:w-[400px] lg:flex-none ${className}`}
    >
      {children}
    </motion.aside>
  );
}
