import type { Ajustes } from "../../../v2/camadas";
import { Deslizante } from "./Campos";

const porcento = (v: number) => `${Math.round(v * 100)}%`;

export function ControlesDaCena({ ajustes, mudar }: { ajustes: Ajustes; mudar: (a: Ajustes, campo: keyof Ajustes, gesto?: string) => void }) {
  return (
    <section aria-label="Cena" className="flex flex-col gap-4">
      <h3 className="text-xs text-tinta-3">Enquadramento</h3>
      <Deslizante rotulo="Zoom" valor={ajustes.zoom} min={1} max={3} passo={0.01} formatar={porcento} aoMudar={(zoom, gesto) => mudar({ ...ajustes, zoom }, "zoom", gesto)} />
      <div className="grid grid-cols-2 gap-3">
        <Deslizante rotulo="Horizontal" valor={ajustes.focoX} min={0} max={1} passo={0.01} formatar={porcento} aoMudar={(focoX, gesto) => mudar({ ...ajustes, focoX }, "focoX", gesto)} />
        <Deslizante rotulo="Vertical" valor={ajustes.focoY} min={0} max={1} passo={0.01} formatar={porcento} aoMudar={(focoY, gesto) => mudar({ ...ajustes, focoY }, "focoY", gesto)} />
      </div>
      <h3 className="pt-1 text-xs text-tinta-3">Tratamento</h3>
      <Deslizante rotulo="Brilho" valor={ajustes.brilho} min={0.5} max={1.5} passo={0.01} formatar={porcento} aoMudar={(brilho, gesto) => mudar({ ...ajustes, brilho }, "brilho", gesto)} />
      <Deslizante rotulo="Contraste" valor={ajustes.contraste} min={0.5} max={1.5} passo={0.01} formatar={porcento} aoMudar={(contraste, gesto) => mudar({ ...ajustes, contraste }, "contraste", gesto)} />
      <Deslizante rotulo="Saturação" valor={ajustes.saturacao} min={0} max={2} passo={0.01} formatar={porcento} aoMudar={(saturacao, gesto) => mudar({ ...ajustes, saturacao }, "saturacao", gesto)} />
      <Deslizante rotulo="Desfoque" valor={ajustes.desfoque} min={0} max={30} passo={1} formatar={(v) => `${v} px`} aoMudar={(desfoque, gesto) => mudar({ ...ajustes, desfoque }, "desfoque", gesto)} />
    </section>
  );
}
