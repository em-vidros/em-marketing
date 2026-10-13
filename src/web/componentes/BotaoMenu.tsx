import { Dica } from "./menu/Teclas";

/** Abre a gaveta no celular. A partir de md só aparece com a barra lateral escondida pelo ⌘\, e a mostra de volta. */
export function BotaoMenu({ abrir }: { abrir: () => void }) {
  return (
    <Dica rotulo="Mostrar a barra lateral" atalho="barra-lateral" lado="bottom">
      <button
        type="button"
        onClick={abrir}
        aria-label="Abrir menu"
        className="pressiona -ml-2 grid size-10 flex-none cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hover md:hidden md:group-data-[barra=oculta]/shell:grid"
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M3 5.5h12M3 12.5h12" />
        </svg>
      </button>
    </Dica>
  );
}
