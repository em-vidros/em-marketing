/*
 * Adaptado do ThinkingState do Beautiful UI (beautifului.dev, MIT, Copyright (c) 2026 Shane Levine).
 * Variante Reasoning: cabeçalho com brilho enquanto pensa, "Pensou por Ns" ao terminar, e o
 * raciocínio num trilho que abre sozinho durante o stream e fecha quando assenta.
 */
import { useEffect, useRef, useState } from "react";
import { Expansivel } from "../Expansivel";
import { Markdown } from "../Markdown";

/** Quanto durou o stream, medido aqui. Um raciocínio que já chegou pronto (recarga) não tem duração. */
function useDuracao(ativo: boolean): number | null {
  const inicio = useRef(ativo ? Date.now() : null);
  const [segundos, setSegundos] = useState<number | null>(null);
  useEffect(() => {
    if (ativo) inicio.current ??= Date.now();
    else if (inicio.current) setSegundos(Math.max(1, Math.round((Date.now() - inicio.current) / 1000)));
  }, [ativo]);
  return segundos;
}

function Brilho({ ativo }: { ativo: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className={`flex-none transition-colors duration-200 ${ativo ? "text-tinta-2" : "text-tinta-3"}`}
      fill="currentColor"
    >
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  );
}

export function Chevron({ aberto, className = "" }: { aberto: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-none text-tinta-3 transition-transform duration-200 ease-(--ease-saida) ${aberto ? "rotate-180" : ""} ${className}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Raciocinio({ texto, ativo }: { texto: string; ativo: boolean }) {
  const duracao = useDuracao(ativo);
  const [escolha, setEscolha] = useState<boolean | null>(null);
  const aberto = escolha ?? ativo;

  return (
    <div className="flex flex-col text-sm">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setEscolha(!aberto)}
        className="-mx-1.5 flex w-fit cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 transition-colors duration-100 hover:bg-hover"
      >
        <Brilho ativo={ativo} />
        <span role="status" className="contents">
          {ativo ? (
            <span className="brilho text-[13px] font-medium whitespace-nowrap">Pensando</span>
          ) : (
            <span className="text-[13px] font-medium whitespace-nowrap text-tinta-2">
              {duracao ? `Pensou por ${duracao}s` : "Pensou"}
            </span>
          )}
        </span>
        <Chevron aberto={aberto} />
      </button>
      <Expansivel aberto={aberto && !!texto.trim()} className="relative ml-[5px] pt-1 pl-4">
        <span aria-hidden="true" className="absolute top-1 bottom-1 left-[3px] w-px bg-linha-forte" />
        <Markdown texto={texto} className="gap-2 py-1 text-[13px]/relaxed text-tinta-2" />
      </Expansivel>
    </div>
  );
}
