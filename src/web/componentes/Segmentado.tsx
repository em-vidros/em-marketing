import { motion, useReducedMotion } from "motion/react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { MOLA } from "../movimento";

export interface Opcao<V extends string> {
  valor: V;
  rotulo: string;
  /** Com ícone, o rótulo vira só o nome acessível. */
  icone?: ReactNode;
}

/**
 * Controle segmentado com a pílula que desliza até a opção escolhida.
 * `abas` segue o padrão de abas do APG (setas, Home, End, um só ponto no Tab);
 * `alternar` é um grupo de botões com aria-pressed.
 */
export function Segmentado<V extends string>({
  tipo,
  rotulo,
  opcoes,
  valor,
  aoMudar,
  idDoPainel,
}: {
  tipo: "abas" | "alternar";
  rotulo: string;
  opcoes: readonly Opcao<V>[];
  valor: V;
  aoMudar: (v: V) => void;
  /** Só em `abas`: o id do painel, para aria-controls. */
  idDoPainel?: string;
}) {
  const reduzir = useReducedMotion();
  const pilula = useId();
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  // A pílula desliza no clique; pelas setas, troca na hora.
  const porTeclado = useRef(false);
  const abas = tipo === "abas";

  function aoTeclar(e: KeyboardEvent) {
    if (!abas) return;
    const i = opcoes.findIndex((o) => o.valor === valor);
    const destino = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: opcoes.length - 1 }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    porTeclado.current = true;
    const j = (destino + opcoes.length) % opcoes.length;
    aoMudar(opcoes[j]!.valor);
    botoes.current[j]?.focus();
  }

  return (
    <div
      role={abas ? "tablist" : "group"}
      aria-label={rotulo}
      onKeyDown={aoTeclar}
      className="flex flex-none gap-0.5 rounded-full border border-linha bg-superficie p-[3px]"
    >
      {opcoes.map((o, i) => {
        const ativa = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              botoes.current[i] = el;
            }}
            type="button"
            role={abas ? "tab" : undefined}
            aria-selected={abas ? ativa : undefined}
            aria-controls={abas && ativa ? idDoPainel : undefined}
            aria-pressed={abas ? undefined : ativa}
            aria-label={o.icone ? o.rotulo : undefined}
            tabIndex={abas && !ativa ? -1 : 0}
            onClick={() => {
              porTeclado.current = false;
              aoMudar(o.valor);
            }}
            className={`pressiona relative grid cursor-pointer place-items-center rounded-full ${
              o.icone ? "h-7 w-8" : "px-3.5 py-[5px]"
            } ${ativa ? "font-medium text-sobre-tinta" : "text-tinta-2 hover:text-tinta"}`}
          >
            {ativa && (
              <motion.span
                layoutId={pilula}
                aria-hidden="true"
                transition={reduzir || porTeclado.current ? { duration: 0 } : MOLA}
                className="absolute inset-0 rounded-full bg-tinta"
              />
            )}
            <span className="relative">{o.icone ?? o.rotulo}</span>
          </button>
        );
      })}
    </div>
  );
}
