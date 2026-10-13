/*
 * Adaptado do TaskRows do Beautiful UI (beautifului.dev, MIT, Copyright (c) 2026 Shane Levine).
 * Variante List: uma linha por passo do especialista, com o anel numerado girando no passo
 * ativo, selo de feito ou de falha, e o tempo de cada passo em mono.
 */
import type { Fase } from "../../tipos";
import { estadoFalado } from "./LinhaFerramenta";

export interface LinhaDeTarefa {
  id: string;
  rotulo: string;
  estado: Fase;
  tempo: string | null;
}

function Anel({ ativo, children }: { ativo: boolean; children: React.ReactNode }) {
  const tamanho = 22;
  const raio = (tamanho - 2) / 2;
  const volta = 2 * Math.PI * raio;
  return (
    <span className="relative inline-grid flex-none place-items-center" style={{ width: tamanho, height: tamanho }}>
      <svg
        aria-hidden="true"
        width={tamanho}
        height={tamanho}
        className={`absolute inset-0 ${ativo ? "girando" : ""}`}
        style={ativo ? { animation: "gira 1.1s linear infinite" } : undefined}
      >
        <circle cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" stroke="var(--color-linha-forte)" strokeWidth={2} />
        {ativo && (
          <circle
            cx={tamanho / 2}
            cy={tamanho / 2}
            r={raio}
            fill="none"
            stroke="var(--color-tinta-3)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={`${volta * 0.28} ${volta * 0.72}`}
          />
        )}
      </svg>
      <span className="tabular relative font-mono text-[10.5px] font-semibold text-tinta">{children}</span>
    </span>
  );
}

function Selo({ cor, children }: { cor: string; children: React.ReactNode }) {
  return <span className={`surge grid size-[22px] flex-none place-items-center rounded-full text-sobre-tinta ${cor}`}>{children}</span>;
}

const traco = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Indicador({ estado, numero }: { estado: LinhaDeTarefa["estado"]; numero: number }) {
  switch (estado) {
    case "feito":
      return (
        <Selo cor="bg-tinta">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" {...traco} strokeWidth={3.5}>
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </Selo>
      );
    case "falhou":
      return (
        <Selo cor="bg-erro">
          <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" {...traco} strokeWidth={3.5}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </Selo>
      );
    case "recusado":
      return (
        <Selo cor="bg-tinta-4">
          <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" {...traco} strokeWidth={3.5}>
            <path d="M6 12h12" />
          </svg>
        </Selo>
      );
    default:
      return <Anel ativo={estado === "fazendo"}>{numero}</Anel>;
  }
}

const COR_DO_ROTULO: Record<Fase, string> = {
  fazendo: "brilho",
  feito: "text-tinta",
  falhou: "text-erro",
  esperando: "text-tinta",
  recusado: "text-tinta-3",
};

/** `inicio` é quantos passos ficaram de fora antes destes, para a numeração continuar certa. */
export function LinhasDeTarefa({ linhas, inicio = 0, className = "" }: { linhas: readonly LinhaDeTarefa[]; inicio?: number; className?: string }) {
  if (linhas.length === 0) return null;
  return (
    <ol aria-label="Passos" className={`flex list-none flex-col ${className}`}>
      {linhas.map((l, i) => (
        <li key={l.id} className="sobe flex h-11 min-w-0 items-center gap-2.5 border-t border-linha px-3.5 first:border-t-0">
          <Indicador estado={l.estado} numero={inicio + i + 1} />
          <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${COR_DO_ROTULO[l.estado]}`}>
            {l.rotulo}
            {estadoFalado(l.rotulo, l.estado) && <span className="sr-only">, {estadoFalado(l.rotulo, l.estado)}</span>}
          </span>
          {l.tempo && <span className="tabular flex-none font-mono text-xs text-tinta-3">{l.tempo}</span>}
        </li>
      ))}
    </ol>
  );
}
