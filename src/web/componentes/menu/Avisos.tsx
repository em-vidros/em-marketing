import { useEffect, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import type { Aviso } from "./conversas";
import { pilhaDeDesfazer } from "./desfazer";
import { Teclas } from "./Teclas";

/** 8 s, o tempo do Grok para o desfazer de ocultar bot. */
const DURACAO = 8000;

/** O toast vai pela chave do desfazer: o ⌘Z fecha o mesmo toast que o botão fecharia. */
export const fecharAviso = (chave: number) => toast.dismiss(`desfazer-${chave}`);

/**
 * Faixa escura embaixo, no formato do Linear: o texto em cinza, o nome em branco, Desfazer
 * em destaque com a tecla ao lado. Erros ficam até alguém fechar. O ⌘Z continua valendo
 * depois que o toast some, porque a entrada fica na pilha.
 */
export function mostrarAviso(a: Aviso) {
  if (a.tipo === "erro") {
    toast.custom((id) => <Faixa id={id} texto={a.texto} />, { duration: Infinity });
    return;
  }
  const id = `desfazer-${a.chave}`;
  // O Sonner pausa no hover mas não no foco; a Faixa conta o próprio tempo e pausa nos dois.
  toast.custom(
    () => (
      <Faixa id={id} texto={a.texto} nome={a.nome} vida={DURACAO}>
        <button
          type="button"
          onClick={() => (toast.dismiss(id), void pilhaDeDesfazer.consumir(a.chave))}
          className="pressiona flex h-8 flex-none cursor-pointer items-center gap-2 rounded-full px-3 font-medium text-white hover:bg-white/10"
        >
          Desfazer
          <Teclas atalho="desfazer" tom="escuro" />
        </button>
      </Faixa>
    ),
    { id, duration: Infinity },
  );
}

/** Conta `vida` ms com o ponteiro fora e o foco fora; ao acabar, fecha o toast. */
function useVida(id: string | number, vida: number | undefined) {
  const [parado, setParado] = useState({ ponteiro: false, foco: false, oculto: typeof document !== "undefined" && document.hidden });
  const resta = useRef(vida ?? Infinity);
  const pausado = parado.ponteiro || parado.foco || parado.oculto;

  useEffect(() => {
    const aoMudar = () => setParado((p) => ({ ...p, oculto: document.hidden }));
    document.addEventListener("visibilitychange", aoMudar);
    return () => document.removeEventListener("visibilitychange", aoMudar);
  }, []);

  useEffect(() => {
    if (pausado || resta.current === Infinity) return;
    const inicio = performance.now();
    const timer = setTimeout(() => toast.dismiss(id), resta.current);
    return () => {
      clearTimeout(timer);
      resta.current -= performance.now() - inicio;
    };
  }, [pausado, id]);

  return {
    onPointerEnter: () => setParado((p) => ({ ...p, ponteiro: true })),
    onPointerLeave: () => setParado((p) => ({ ...p, ponteiro: false })),
    onFocus: () => setParado((p) => ({ ...p, foco: true })),
    onBlur: (e: React.FocusEvent) => !e.currentTarget.contains(e.relatedTarget) && setParado((p) => ({ ...p, foco: false })),
  };
}

function Faixa({ id, texto, nome, vida, children }: { id: string | number; texto: string; nome?: string; vida?: number; children?: React.ReactNode }) {
  const pausa = useVida(id, vida);
  return (
    <div
      {...pausa}
      className="flex w-[min(420px,calc(100vw-32px))] items-center gap-2 rounded-[22px] bg-tinta py-1.5 pr-1.5 pl-4 text-sm text-white/60 shadow-[0_12px_32px_rgb(0_0_0/0.22)]"
    >
      <p className="line-clamp-3 min-w-0 flex-1 [overflow-wrap:anywhere]">
        {texto} {nome && <span className="text-white">{nome}</span>}
      </p>
      {children}
      <button
        type="button"
        aria-label="Fechar aviso"
        onClick={() => toast.dismiss(id)}
        className="grid size-8 flex-none cursor-pointer place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}

export const Avisos = () => <Toaster position="bottom-center" containerAriaLabel="Avisos" offset={16} mobileOffset={12} gap={8} />;
