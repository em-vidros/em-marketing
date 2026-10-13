import type { Passo } from "../tipos";

export function Check({ cor = "currentColor" }: { cor?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke={cor}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function Girando() {
  return (
    <span
      aria-hidden="true"
      className="girando size-3.5 flex-none rounded-full border-[1.6px] border-tinta border-t-transparent"
      style={{ animation: "gira 0.9s linear infinite" }}
    />
  );
}

function Falhou() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--color-erro)"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="flex-none"
    >
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

/** Lista de passos de um especialista: feito com check, em andamento com o anel girando. */
export function Passos({ passos, className = "" }: { passos: readonly Passo[]; className?: string }) {
  if (passos.length === 0) return null;
  return (
    <ol className={`flex list-none flex-col gap-1.5 text-tinta-2 ${className}`}>
      {passos.map((p) => (
        <li key={p.id} className={`flex items-center gap-2 ${p.estado === "fazendo" ? "text-tinta" : ""}`}>
          {p.estado === "feito" ? <Check cor="var(--color-tinta-3)" /> : p.estado === "fazendo" ? <Girando /> : <Falhou />}
          <span className="min-w-0 truncate">{p.estado === "falhou" ? `${p.rotulo}: falhou` : p.rotulo}</span>
        </li>
      ))}
    </ol>
  );
}
