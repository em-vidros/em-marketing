import { Layers01Icon, ShapesIcon, SlidersHorizontalIcon, TextIcon, Upload04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";
import type { Painel } from "./useEditor";

const ABAS: { painel: Painel; rotulo: string; icone: IconSvgElement }[] = [
  { painel: "elementos", rotulo: "Elementos", icone: ShapesIcon },
  { painel: "texto", rotulo: "Texto", icone: TextIcon },
  { painel: "uploads", rotulo: "Uploads", icone: Upload04Icon },
  { painel: "camadas", rotulo: "Camadas", icone: Layers01Icon },
  { painel: "cena", rotulo: "Cena", icone: SlidersHorizontalIcon },
];

export const TITULO_DO_PAINEL: Record<Painel, string> = {
  elementos: "Elementos",
  texto: "Texto",
  uploads: "Uploads",
  camadas: "Camadas",
  cena: "Ajustes da cena",
  posicao: "Posição",
};

export function Trilho({ aberto, abrir }: { aberto: Painel | null; abrir: (painel: Painel | null) => void }) {
  return (
    <nav aria-label="Painéis do editor" className="flex flex-none gap-1 border-linha bg-superficie p-2 max-lg:order-2 max-lg:overflow-x-auto max-lg:border-t lg:w-[76px] lg:flex-col lg:border-r">
      {ABAS.map(({ painel, rotulo, icone }) => (
        <button
          key={painel}
          type="button"
          aria-pressed={aberto === painel}
          onClick={() => abrir(aberto === painel ? null : painel)}
          className="pressiona flex min-w-15 flex-none cursor-pointer flex-col items-center gap-1 rounded-item px-1 py-2 text-[11px] text-tinta-2 hover:bg-hover hover:text-tinta aria-pressed:bg-ativo aria-pressed:font-medium aria-pressed:text-tinta"
        >
          <HugeiconsIcon icon={icone} size={22} strokeWidth={1.5} />
          {rotulo}
        </button>
      ))}
    </nav>
  );
}

export function Gaveta({ painel, fechar, children }: { painel: Painel; fechar: () => void; children: ReactNode }) {
  return (
    <aside aria-label={TITULO_DO_PAINEL[painel]} className="flex min-h-0 flex-none flex-col border-linha bg-superficie max-lg:order-3 max-lg:border-t lg:w-[320px] lg:border-r">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-[15px] font-semibold">{TITULO_DO_PAINEL[painel]}</h2>
        <button type="button" aria-label="Fechar painel" onClick={fechar} className="pressiona -mr-2 grid size-9 cursor-pointer place-items-center rounded-full text-tinta-3 hover:bg-hover hover:text-tinta">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-2 pb-5">{children}</div>
    </aside>
  );
}
