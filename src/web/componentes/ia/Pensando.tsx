/*
 * Adaptado do LoadingState do Beautiful UI (beautifului.dev, MIT, Copyright (c) 2026 Shane Levine).
 * Variante Dots: a grade 3x3 com a frente em chevron, rótulo com brilho e o tempo em mono.
 */
import { useEffect, useState } from "react";

const ATRASOS = Array.from({ length: 9 }, (_, i) => {
  const linha = Math.floor(i / 3);
  return (i % 3) + Math.abs(linha - 1);
}).map((passo) => passo * 90);

function Grade() {
  return (
    <span aria-hidden="true" className="grid flex-none grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {ATRASOS.map((atraso, i) => (
        <span
          key={i}
          className="pixel size-1 rounded-full bg-tinta opacity-15"
          style={{ animation: `pixel 650ms ease-in-out ${atraso}ms infinite` }}
        />
      ))}
    </span>
  );
}

/** Décimos de segundo desde a montagem: "0.4s", "1m 2.0s". */
export function useDecorrido() {
  const [decimos, setDecimos] = useState(0);
  useEffect(() => {
    const inicio = Date.now();
    const t = setInterval(() => setDecimos(Math.floor((Date.now() - inicio) / 100)), 100);
    return () => clearInterval(t);
  }, []);
  const s = decimos / 10;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s`;
}

/** O bot recebeu o pedido e ainda não mandou nada, ou está entre um passo e outro. */
export function Pensando({ rotulo = "Pensando", className = "" }: { rotulo?: string; className?: string }) {
  const decorrido = useDecorrido();
  return (
    <div role="status" className={`sobe flex w-fit items-center gap-2.5 ${className}`}>
      <Grade />
      <span className="brilho text-[13px] font-medium">{rotulo}</span>
      <span aria-hidden="true" className="tabular font-mono text-xs text-tinta-3">
        {decorrido}
      </span>
    </div>
  );
}
