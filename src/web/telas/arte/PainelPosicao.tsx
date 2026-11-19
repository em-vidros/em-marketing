import {
  AlignBottomIcon,
  AlignHorizontalCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  LayerBringForwardIcon,
  LayerBringToFrontIcon,
  LayerSendBackwardIcon,
  LayerSendToBackIcon
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { transformacaoDa, type Camada } from "../../../v2/camadas";
import { Numero } from "./Campos";
import type { Borda, Caixa, Destino } from "./operacoes";
import type { AcoesDoEditor } from "./useEditor";

const ORGANIZAR: { destino: Destino; rotulo: string; icone: IconSvgElement }[] = [
  { destino: "frente", rotulo: "Avançar", icone: LayerBringForwardIcon },
  { destino: "tras", rotulo: "Recuar", icone: LayerSendBackwardIcon },
  { destino: "topo", rotulo: "Trazer para frente", icone: LayerBringToFrontIcon },
  { destino: "fundo", rotulo: "Enviar para trás", icone: LayerSendToBackIcon },
];

const ALINHAR: { borda: Borda; rotulo: string; icone: IconSvgElement }[] = [
  { borda: "topo", rotulo: "Topo", icone: AlignTopIcon },
  { borda: "esquerda", rotulo: "Esquerda", icone: AlignLeftIcon },
  { borda: "meio", rotulo: "Meio", icone: AlignVerticalCenterIcon },
  { borda: "centro", rotulo: "Centro", icone: AlignHorizontalCenterIcon },
  { borda: "base", rotulo: "Base", icone: AlignBottomIcon },
  { borda: "direita", rotulo: "Direita", icone: AlignRightIcon },
];

export function PainelPosicao(props: { camada: Camada | null; acoes: AcoesDoEditor; total: number; indice: number; medir: (id: string) => Caixa | null }) {
  const { camada: c, acoes } = props;
  if (!c) return <p className="text-sm text-tinta-3">Selecione um elemento da arte para ver a posição dele.</p>;
  if (c.bloqueada) return <p className="text-sm text-tinta-3">Este elemento está travado. Destrave na barra de cima para mexer na posição.</p>;

  const { rotacao } = transformacaoDa(c);
  const naFrente = props.indice === props.total - 1;
  const noFundo = props.indice === 0;
  const desabilitado: Record<Destino, boolean> = { frente: naFrente, topo: naFrente, tras: noFundo, fundo: noFundo };

  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs text-tinta-3">Organizar</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {ORGANIZAR.map(({ destino, rotulo, icone }) => (
            <Botao key={destino} rotulo={rotulo} icone={icone} disabled={desabilitado[destino]} onClick={() => acoes.moverNaPilha(c, destino)} />
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs text-tinta-3">Alinhar à página</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {ALINHAR.map(({ borda, rotulo, icone }) => (
            <Botao
              key={borda}
              rotulo={rotulo}
              icone={icone}
              onClick={() => {
                const caixa = props.medir(c.id);
                if (caixa) acoes.alinhar(c, caixa, borda);
              }}
            />
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs text-tinta-3">Medidas, em px da arte</h3>
        <div className="grid grid-cols-2 gap-2">
          <Numero rotulo="X" valor={c.x} min={-2000} max={4000} aoMudar={(x) => acoes.mudar({ ...c, x }, "x")} />
          <Numero rotulo="Y" valor={c.y} min={-2000} max={4000} aoMudar={(y) => acoes.mudar({ ...c, y }, "y")} />
          <Numero rotulo="Largura" valor={c.largura} min={20} max={4000} aoMudar={(largura) => acoes.mudar({ ...c, largura }, "largura")} />
          {c.tipo === "forma" && <Numero rotulo="Altura" valor={c.altura} min={1} max={4000} aoMudar={(altura) => acoes.mudar({ ...c, altura }, "altura")} />}
          <Numero rotulo="Rotação (graus)" valor={rotacao} min={-180} max={180} passo={0.1} aoMudar={(v) => acoes.mudar({ ...c, rotacao: v }, "rotacao")} />
        </div>
      </section>
    </>
  );
}

function Botao({ rotulo, icone, ...resto }: { rotulo: string; icone: IconSvgElement; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      {...resto}
      className="pressiona flex h-10 cursor-pointer items-center gap-2 rounded-item px-2.5 text-left text-[13px] text-tinta-2 hover:bg-hover hover:text-tinta disabled:cursor-default disabled:opacity-40"
    >
      <HugeiconsIcon icon={icone} size={18} strokeWidth={1.6} className="flex-none" />
      {rotulo}
    </button>
  );
}
