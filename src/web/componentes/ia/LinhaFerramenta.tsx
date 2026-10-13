/*
 * Adaptado do ToolChips do Beautiful UI (beautifului.dev, MIT, Copyright (c) 2026 Shane Levine).
 * Uma chamada de tool numa linha: ícone do estado, rótulo e um chip com o valor da entrada.
 */
import type { Fase, Passo } from "../../tipos";

const traco = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Check({ cor = "currentColor" }: { cor?: string }) {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" {...traco} stroke={cor} strokeWidth={2.4} className="flex-none">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function Girando() {
  return (
    <span
      aria-hidden="true"
      className="girando size-3 flex-none rounded-full border-[1.5px] border-linha-forte border-t-tinta-2"
      style={{ animation: "gira 700ms linear infinite" }}
    />
  );
}

const ICONE: Record<Fase, React.ReactNode> = {
  fazendo: <Girando />,
  feito: <Check cor="var(--color-tinta-3)" />,
  falhou: (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" {...traco} strokeWidth={2.6} className="flex-none text-erro">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  esperando: (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" {...traco} className="flex-none text-tinta-3">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  recusado: (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" {...traco} className="flex-none text-tinta-3">
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  ),
};

export const IconeDaFase = ({ fase }: { fase: Fase }) => <span className="grid size-4 flex-none place-items-center">{ICONE[fase]}</span>;

export const COR_DO_ROTULO: Record<Fase, string> = {
  fazendo: "brilho",
  feito: "text-tinta-2",
  falhou: "text-erro",
  esperando: "text-tinta-2",
  recusado: "text-tinta-3",
};

/** O estado de um passo em palavras, para o leitor de tela: o ícone é decorativo. */
export const FASE_FALADA: Record<Fase, string> = {
  fazendo: "em andamento",
  feito: "concluído",
  falhou: "falhou",
  esperando: "aguardando",
  recusado: "recusado",
};

/** O estado falado, a menos que o rótulo já o diga depois dos dois-pontos ("Publicando: falhou"). */
export const estadoFalado = (rotulo: string, fase: Fase) => (rotulo.includes(": ") ? null : FASE_FALADA[fase]);

export function LinhaFerramenta({ passo, children }: { passo: Passo; children?: React.ReactNode }) {
  const falado = estadoFalado(passo.rotulo, passo.estado);
  return (
    <li className="sobe flex min-w-0 flex-col gap-2">
      <div className="flex h-7 min-w-0 items-center gap-2">
        <IconeDaFase fase={passo.estado} />
        <span className={`min-w-0 truncate text-[13px] font-medium ${COR_DO_ROTULO[passo.estado]}`}>
          {passo.rotulo}
          {falado && <span className="sr-only">, {falado}</span>}
        </span>
        {passo.detalhe && (
          <span className="inline-flex h-5.5 min-w-0 items-center truncate rounded-[6px] bg-ativo px-1.5 text-xs text-tinta-2">
            <span className="truncate">{passo.detalhe}</span>
          </span>
        )}
      </div>
      {children}
    </li>
  );
}
