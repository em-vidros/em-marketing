import type { Ajustes } from "../../../v2/camadas";
import { Deslizante } from "./Campos";

const porcento = (v: number) => `${Math.round(v * 100)}%`;

export function ControlesDaCena({ ajustes, mudar }: { ajustes: Ajustes; mudar: (a: Ajustes) => void }) {
  return (
    <section aria-label="Cena" className="flex flex-col gap-4 border-t border-linha pt-4">
      <h2 className="text-xs text-tinta-3">Cena</h2>
      <Deslizante rotulo="Zoom" valor={ajustes.zoom} min={1} max={3} passo={0.01} formatar={porcento} aoMudar={(zoom) => mudar({ ...ajustes, zoom })} />
      <div className="grid grid-cols-2 gap-3">
        <Deslizante rotulo="Horizontal" valor={ajustes.focoX} min={0} max={1} passo={0.01} formatar={porcento} aoMudar={(focoX) => mudar({ ...ajustes, focoX })} />
        <Deslizante rotulo="Vertical" valor={ajustes.focoY} min={0} max={1} passo={0.01} formatar={porcento} aoMudar={(focoY) => mudar({ ...ajustes, focoY })} />
      </div>
      <Deslizante rotulo="Brilho" valor={ajustes.brilho} min={0.5} max={1.5} passo={0.01} formatar={porcento} aoMudar={(brilho) => mudar({ ...ajustes, brilho })} />
      <Deslizante rotulo="Contraste" valor={ajustes.contraste} min={0.5} max={1.5} passo={0.01} formatar={porcento} aoMudar={(contraste) => mudar({ ...ajustes, contraste })} />
      <Deslizante rotulo="Saturação" valor={ajustes.saturacao} min={0} max={2} passo={0.01} formatar={porcento} aoMudar={(saturacao) => mudar({ ...ajustes, saturacao })} />
      <Deslizante rotulo="Desfoque" valor={ajustes.desfoque} min={0} max={30} passo={1} formatar={(v) => `${v} px`} aoMudar={(desfoque) => mudar({ ...ajustes, desfoque })} />
    </section>
  );
}
