import { AnimatePresence, motion, type TargetAndTransition, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { ESTREITO, inertizarFora, useMedia } from "../media";
import { MOLA, MOLA_REDUZIDA } from "../movimento";

/**
 * Coluna à direita a partir do lg; abaixo, cobre a tela sobre um fundo escuro e vira modal:
 * o resto da página fica inerte, e o Tab e o Esc ficam com o painel. O conteúdo cuida do
 * próprio foco inicial; quem abre cuida de devolver o foco.
 */
export function PainelLateral({
  aberto,
  rotulo,
  fechar,
  className = "",
  children,
}: {
  aberto: boolean;
  rotulo: string;
  fechar: () => void;
  className?: string;
  children: ReactNode;
}) {
  const reduzir = useReducedMotion();
  const estreito = useMedia(ESTREITO);
  const fora: TargetAndTransition = reduzir ? { opacity: 0 } : { opacity: 0, transform: "translateX(24px)" };
  return (
    <AnimatePresence>
      {aberto && (
        <motion.div
          key="fundo"
          aria-hidden="true"
          data-fecha-painel
          onClick={fechar}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={MOLA_REDUZIDA}
          className="fixed inset-0 z-30 bg-tinta/20 lg:hidden"
        />
      )}
      {aberto && (
        <Coluna key="painel" rotulo={rotulo} fechar={fechar} modal={estreito} fora={fora} reduzir={!!reduzir} className={className}>
          {children}
        </Coluna>
      )}
    </AnimatePresence>
  );
}

function Coluna({
  rotulo,
  fechar,
  modal,
  fora,
  reduzir,
  className,
  children,
}: {
  rotulo: string;
  fechar: () => void;
  modal: boolean;
  fora: TargetAndTransition;
  reduzir: boolean;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
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
      initial={fora}
      animate={{ opacity: 1, transform: "translateX(0px)" }}
      exit={fora}
      transition={reduzir ? MOLA_REDUZIDA : MOLA}
      className={`fixed inset-y-0 right-0 z-40 w-full max-w-[420px] border-l border-linha bg-painel lg:static lg:z-auto lg:w-[400px] lg:flex-none ${className}`}
    >
      {children}
    </motion.aside>
  );
}
