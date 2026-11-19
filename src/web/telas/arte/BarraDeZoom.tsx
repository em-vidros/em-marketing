import { FitToScreenIcon, RulerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Dica } from "../../componentes/menu/Teclas";

const MINIMO = 0.1;
const MAXIMO = 4;

export function BarraDeZoom(props: { escala: number; zoomPara: (escala: number) => void; encaixar: () => void; reguas: boolean; alternarReguas: () => void }) {
  const porcento = Math.round(props.escala * 100);

  return (
    <div className="flex h-11 flex-none items-center gap-2 border-t border-linha bg-superficie px-3">
      <Dica rotulo={props.reguas ? "Esconder réguas e guias" : "Mostrar réguas e guias"} atalho="arte-reguas" lado="top">
        <button
          type="button"
          aria-pressed={props.reguas}
          aria-label="Réguas e guias"
          onClick={props.alternarReguas}
          className="pressiona grid size-8 cursor-pointer place-items-center rounded-lg text-tinta-2 hover:bg-hover aria-pressed:bg-ativo aria-pressed:text-tinta"
        >
          <HugeiconsIcon icon={RulerIcon} size={18} strokeWidth={1.6} />
        </button>
      </Dica>
      <input
        type="range"
        aria-label="Zoom"
        min={MINIMO * 100}
        max={MAXIMO * 100}
        step={1}
        value={porcento}
        onChange={(e) => props.zoomPara(e.target.valueAsNumber / 100)}
        className="ml-auto w-28 cursor-pointer accent-[#2F646A] sm:w-36"
      />
      <output aria-label="Zoom atual" className="w-11 text-right text-[13px] text-tinta-2 tabular">
        {porcento}%
      </output>
      <Dica rotulo="Ajustar à tela" lado="top">
        <button type="button" aria-label="Ajustar à tela" onClick={props.encaixar} className="pressiona grid size-8 cursor-pointer place-items-center rounded-lg text-tinta-2 hover:bg-hover hover:text-tinta">
          <HugeiconsIcon icon={FitToScreenIcon} size={18} strokeWidth={1.6} />
        </button>
      </Dica>
    </div>
  );
}
