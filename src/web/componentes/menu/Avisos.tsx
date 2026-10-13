import { toast, Toaster } from "sonner";
import type { Aviso } from "./conversas";
import { Teclas } from "./Teclas";

/** 8 s, o tempo do Grok para o desfazer de ocultar bot. Passar o mouse pausa (Sonner). */
const DURACAO = 8000;

/** O toast vai pela chave do desfazer: o ⌘Z fecha o mesmo toast que o botão fecharia. */
export const fecharAviso = (chave: number) => toast.dismiss(`desfazer-${chave}`);

/**
 * Faixa escura embaixo, no formato do Linear: o verbo em cinza, o nome em branco, Desfazer
 * em destaque com a tecla ao lado. Erros ficam até alguém fechar.
 */
export function mostrarAviso(a: Aviso) {
  if (a.tipo === "erro") {
    toast.custom((id) => <Faixa id={id} texto={a.texto} />, { duration: Infinity });
    return;
  }
  const id = `desfazer-${a.chave}`;
  toast.custom(
    () => (
      <Faixa id={id} texto={`Conversa ${a.verbo}:`} nome={a.titulo}>
        <button
          type="button"
          onClick={() => (toast.dismiss(id), a.desfazer())}
          className="pressiona flex h-8 flex-none cursor-pointer items-center gap-2 rounded-full px-3 font-medium text-white hover:bg-white/10"
        >
          Desfazer
          <Teclas atalho="desfazer" tom="escuro" />
        </button>
      </Faixa>
    ),
    { id, duration: DURACAO },
  );
}

function Faixa({ id, texto, nome, children }: { id: string | number; texto: string; nome?: string; children?: React.ReactNode }) {
  return (
    <div className="flex w-[min(420px,calc(100vw-32px))] items-center gap-2 rounded-cartao bg-tinta py-1.5 pr-1.5 pl-4 text-sm text-white/60 shadow-[0_12px_32px_rgb(0_0_0/0.22)]">
      <p className="min-w-0 flex-1 truncate">
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
