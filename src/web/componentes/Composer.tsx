import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

/** Enter envia, Shift+Enter quebra linha. Enquanto o bot responde, o botão vira parar. */
export function Composer({
  rotulo,
  placeholder,
  respondendo,
  enviar,
  parar,
}: {
  rotulo: string;
  placeholder: string;
  respondendo: boolean;
  enviar: (texto: string) => void;
  parar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const vazio = texto.trim().length === 0;

  function aoEnviar(e?: FormEvent) {
    e?.preventDefault();
    if (respondendo || vazio) return;
    enviar(texto.trim());
    setTexto("");
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      aoEnviar();
    }
  }

  return (
    <form
      onSubmit={aoEnviar}
      className="sticky bottom-0 bg-linear-to-t from-fundo from-70% to-fundo/0 px-4 pt-2 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-6"
    >
      <div
        onClick={() => campo.current?.focus()}
        className="mx-auto flex max-w-3xl cursor-text flex-col gap-1.5 rounded-composer border border-borda-campo bg-superficie pt-3.5 pr-3 pb-2.5 pl-5 transition-[border-color] duration-150 focus-within:border-tinta"
      >
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
          className="max-h-[40dvh] min-h-7 resize-none bg-transparent py-0.5 pr-2 text-base/6 text-tinta outline-none [field-sizing:content] focus-visible:outline-none"
        />
        <div className="flex justify-end">
          {respondendo ? (
            <button
              type="button"
              onClick={parar}
              aria-label="Parar resposta"
              className="pressiona grid size-9 flex-none cursor-pointer place-items-center rounded-full bg-tinta text-sobre-tinta"
            >
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
                <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Enviar"
              className={`pressiona grid size-9 flex-none cursor-pointer place-items-center rounded-full transition-colors duration-150 ${vazio ? "bg-linha-forte text-tinta-3" : "bg-tinta text-sobre-tinta"}`}
            >
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
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
