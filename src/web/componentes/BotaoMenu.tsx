/** Abre a barra lateral no celular; some a partir de md, onde a barra fica fixa. */
export function BotaoMenu({ abrir }: { abrir: () => void }) {
  return (
    <button
      type="button"
      onClick={abrir}
      aria-label="Abrir menu"
      className="pressiona -ml-2 grid size-10 flex-none cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hover md:hidden"
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
  );
}
