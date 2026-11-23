import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { editaAoSubir } from "./mensagem/teclas";
import { Troca } from "./Troca";

/** Enter envia, Shift+Enter quebra linha. Enquanto o bot responde, o botão vira parar. */
export function Composer({
  rotulo,
  placeholder,
  respondendo,
  enviar,
  parar,
  extra,
  fila,
  esperando = false,
  aoSubirVazio,
}: {
  rotulo: string;
  placeholder: string;
  respondendo: boolean;
  enviar: (texto: string) => void;
  parar: () => void;
  /** Fica à esquerda do botão de enviar (o seletor de bot de uma conversa nova). */
  extra?: React.ReactNode;
  /** As imagens que vão com a mensagem, acima do campo. */
  fila?: React.ReactNode;
  /** Uma imagem ainda subindo ou que não subiu: a mensagem espera. */
  esperando?: boolean;
  /** ↑ com o campo vazio. Devolve true se usou a tecla (abriu a edição da última mensagem). */
  aoSubirVazio?: () => boolean;
}) {
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const vazio = texto.trim().length === 0;

  function aoEnviar(e?: FormEvent) {
    e?.preventDefault();
    if (respondendo || vazio || esperando) return;
    enviar(texto.trim());
    setTexto("");
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      aoEnviar();
    } else if (editaAoSubir(e, texto) && aoSubirVazio?.()) e.preventDefault();
  }

  return (
    <form
      onSubmit={aoEnviar}
      className="sticky bottom-0 z-[1] bg-linear-to-t from-fundo from-25% to-fundo/0 to-55% px-4 pt-2 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-6"
    >
      <div
        onClick={(e) => {
          // Clique em botão (o seletor de bot, enviar) ou num popup em portal não rouba o foco dele.
          const alvo = e.target as Element;
          if (e.currentTarget.contains(alvo) && !alvo.closest("button, a")) campo.current?.focus();
        }}
        className="material mx-auto flex max-w-3xl cursor-text flex-col gap-1.5 rounded-composer pt-3.5 pr-2.5 pb-2.5 pl-5 shadow-material transition-shadow duration-150 focus-within:shadow-material-foco"
      >
        {fila}
        <label htmlFor="mensagem" className="sr-only">
          {rotulo}
        </label>
        <textarea
          ref={campo}
          id="mensagem"
          name="mensagem"
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={aoTeclar}
          placeholder={placeholder}
          enterKeyHint="send"
          className="max-h-[40dvh] min-h-7 resize-none bg-transparent py-0.5 pr-2 text-base/6 tracking-[-0.006em] text-tinta outline-none [field-sizing:content] placeholder:text-tinta-3 focus-visible:outline-none"
        />
        <div className="flex min-w-0 items-center justify-end gap-2">
          {extra && <div className="mr-auto flex min-w-0 items-center gap-1.5">{extra}</div>}
          {/* Um botão só, que troca de papel: o foco não se perde quando a resposta começa ou acaba. */}
          <button
            type={respondendo ? "button" : "submit"}
            onClick={respondendo ? parar : undefined}
            aria-label={respondendo ? "Parar resposta" : esperando ? "Enviar, espera a imagem subir" : "Enviar"}
            aria-disabled={(!respondendo && esperando) || undefined}
            className={`pressiona grid size-[34px] flex-none cursor-pointer place-items-center rounded-full aria-disabled:cursor-default ${
              respondendo || (!vazio && !esperando) ? "bg-tinta text-sobre-tinta" : "bg-preenchimento-forte text-sobre-tinta"
            }`}
          >
            <Troca chave={respondendo ? "parar" : "enviar"} className="grid place-items-center">
              {respondendo ? (
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
                  <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  width="15"
                  height="15"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 13V3M4 7l4-4 4 4" />
                </svg>
              )}
            </Troca>
          </button>
        </div>
      </div>
    </form>
  );
}
