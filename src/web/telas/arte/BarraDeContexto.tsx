import {
  Copy01Icon,
  Delete02Icon,
  MinusSignIcon,
  Move01Icon,
  ParagraphSpacingIcon,
  PlusSignIcon,
  SquareLock02Icon,
  SquareUnlock02Icon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TransparencyIcon
} from "@hugeicons/core-free-icons";
import { Popover } from "@base-ui/react/popover";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";
import { FONTES, transformacaoDa, type Camada, type Fonte } from "../../../v2/camadas";
import { Segmentado } from "../../componentes/Segmentado";
import { Dica } from "../../componentes/menu/Teclas";
import type { AtalhoId } from "../../teclado/atalhos";
import { Cor, Deslizante, Numero } from "./Campos";
import { TIPO } from "./textos";
import type { AcoesDoEditor } from "./useEditor";

type Texto = Extract<Camada, { tipo: "texto" }>;

const NOME_DO_PESO: Record<number, string> = { 400: "Regular", 500: "Médio", 600: "Seminegrito" };

const PROXIMO_ALINHAMENTO = { esquerda: "centro", centro: "direita", direita: "esquerda" } as const;

const ALINHAMENTO = {
  esquerda: { icone: TextAlignLeftIcon, rotulo: "à esquerda" },
  centro: { icone: TextAlignCenterIcon, rotulo: "no centro" },
  direita: { icone: TextAlignRightIcon, rotulo: "à direita" },
} as const;

const porcento = (v: number) => `${Math.round(v * 100)}%`;

export function BarraDeContexto(props: { camada: Camada | null; acoes: AcoesDoEditor; cheia: boolean; posicaoAberta: boolean; alternarPosicao: () => void; aoAgir: () => void }) {
  const { camada: c, acoes } = props;

  return (
    <div role="toolbar" aria-label={c ? `Editar ${TIPO[c.tipo].toLowerCase()}` : "Edição"} className="flex h-14 flex-none items-center gap-1 overflow-x-auto border-b border-linha bg-superficie px-3">
      {!c && <p className="px-1 text-[13px] text-tinta-3">Clique num elemento da arte para editar. Dois cliques num texto editam direto na arte.</p>}
      {c && !c.bloqueada && <ControlesDoTipo camada={c} acoes={acoes} />}
      {c && (
        <div className="ml-auto flex flex-none items-center gap-1 pl-2">
          {!c.bloqueada && <ControlesComuns camada={c} acoes={acoes} posicaoAberta={props.posicaoAberta} alternarPosicao={props.alternarPosicao} />}
          <BotaoDeIcone
            rotulo={c.bloqueada ? "Destravar" : "Travar"}
            icone={c.bloqueada ? SquareLock02Icon : SquareUnlock02Icon}
            pressionado={!!c.bloqueada}
            onClick={() => acoes.alternarBloqueio(c)}
          />
          <BotaoDeIcone rotulo="Duplicar" atalho="arte-duplicar" icone={Copy01Icon} disabled={props.cheia} onClick={() => (acoes.duplicar(c), props.aoAgir())} />
          {!c.bloqueada && <BotaoDeIcone rotulo="Apagar" atalho="arte-apagar" icone={Delete02Icon} onClick={() => (acoes.remover(c), props.aoAgir())} />}
        </div>
      )}
    </div>
  );
}

function ControlesDoTipo({ camada: c, acoes }: { camada: Camada; acoes: AcoesDoEditor }) {
  switch (c.tipo) {
    case "texto":
      return <ControlesDeTexto camada={c} acoes={acoes} />;
    case "forma":
      return (
        <>
          <Amostra cor={c.cor} aoMudar={(cor) => acoes.mudar({ ...c, cor }, "cor")} />
          <Saliencia rotulo="Arredondamento" gatilho="Cantos">
            <Deslizante rotulo="Arredondamento" valor={c.raio} min={0} max={12} passo={1} formatar={String} aoMudar={(raio, gesto) => acoes.mudar({ ...c, raio }, "raio", gesto)} />
          </Saliencia>
        </>
      );
    case "logo":
      return (
        <Segmentado
          tipo="alternar"
          rotulo="Versão do logo"
          opcoes={[
            { valor: "cor", rotulo: "Colorido" },
            { valor: "branca", rotulo: "Branco" },
          ]}
          valor={c.variante}
          aoMudar={(variante) => acoes.mudar({ ...c, variante })}
        />
      );
    case "imagem":
      return null;
  }
}

function ControlesDeTexto({ camada: c, acoes }: { camada: Texto; acoes: AcoesDoEditor }) {
  const pesos = Object.keys(FONTES[c.fonte]).map(Number);
  const tamanho = (novo: number) => acoes.mudar({ ...c, tamanho: Math.min(400, Math.max(12, novo)) }, "tamanho");
  const proximo = PROXIMO_ALINHAMENTO[c.alinhamento];

  return (
    <div className="flex flex-none items-center gap-1">
      <select
        aria-label="Fonte"
        value={c.fonte}
        onChange={(e) => {
          const fonte = e.target.value as Fonte;
          acoes.mudar({ ...c, fonte, peso: Number(Object.keys(FONTES[fonte])[0]) });
        }}
        className="h-9 w-40 cursor-pointer rounded-lg border border-linha-forte bg-transparent px-2.5 text-sm hover:bg-hover"
        style={{ fontFamily: c.fonte }}
      >
        {Object.keys(FONTES).map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
      <select
        aria-label="Peso"
        value={c.peso}
        disabled={pesos.length < 2}
        onChange={(e) => acoes.mudar({ ...c, peso: Number(e.target.value) })}
        className="h-9 cursor-pointer rounded-lg border border-linha-forte bg-transparent px-2 text-sm hover:bg-hover disabled:cursor-default disabled:opacity-60"
      >
        {pesos.map((p) => (
          <option key={p} value={p}>
            {NOME_DO_PESO[p] ?? p}
          </option>
        ))}
      </select>
      <Separador />
      <div role="group" aria-label="Tamanho da fonte" className="flex items-center rounded-lg border border-linha-forte">
        <BotaoDeIcone rotulo="Diminuir a fonte" icone={MinusSignIcon} pequeno onClick={() => tamanho(c.tamanho - 1)} />
        <div className="w-12 [&_label]:sr-only [&_input]:h-8 [&_input]:rounded-none [&_input]:border-0 [&_input]:px-0 [&_input]:text-center">
          <Numero rotulo="Tamanho da fonte" valor={c.tamanho} min={12} max={400} aoMudar={tamanho} />
        </div>
        <BotaoDeIcone rotulo="Aumentar a fonte" icone={PlusSignIcon} pequeno onClick={() => tamanho(c.tamanho + 1)} />
      </div>
      <Separador />
      <Amostra cor={c.cor} aoMudar={(cor) => acoes.mudar({ ...c, cor }, "cor")} />
      <BotaoDeIcone
        rotulo={`Alinhado ${ALINHAMENTO[c.alinhamento].rotulo}. Clique para alinhar ${ALINHAMENTO[proximo].rotulo}`}
        icone={ALINHAMENTO[c.alinhamento].icone}
        onClick={() => acoes.mudar({ ...c, alinhamento: proximo })}
      />
      <Saliencia rotulo="Espaçamento entre linhas" gatilho={<HugeiconsIcon icon={ParagraphSpacingIcon} size={18} strokeWidth={1.6} />}>
        <Deslizante rotulo="Entrelinha" valor={c.entrelinha} min={0.8} max={2.5} passo={0.05} formatar={(v) => v.toFixed(2)} aoMudar={(entrelinha, gesto) => acoes.mudar({ ...c, entrelinha }, "entrelinha", gesto)} />
      </Saliencia>
    </div>
  );
}

function ControlesComuns(props: { camada: Camada; acoes: AcoesDoEditor; posicaoAberta: boolean; alternarPosicao: () => void }) {
  const { camada: c, acoes } = props;
  const { opacidade } = transformacaoDa(c);

  return (
    <>
      <Saliencia rotulo="Transparência" gatilho={<HugeiconsIcon icon={TransparencyIcon} size={18} strokeWidth={1.6} />}>
        <Deslizante rotulo="Transparência" valor={opacidade} min={0} max={1} passo={0.01} formatar={porcento} aoMudar={(v, gesto) => acoes.mudar({ ...c, opacidade: v }, "opacidade", gesto)} />
      </Saliencia>
      <button
        type="button"
        aria-pressed={props.posicaoAberta}
        onClick={props.alternarPosicao}
        className="pressiona flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm text-tinta-2 hover:bg-hover hover:text-tinta aria-pressed:bg-ativo aria-pressed:text-tinta"
      >
        <HugeiconsIcon icon={Move01Icon} size={17} strokeWidth={1.6} />
        Posição
      </button>
      <Separador />
    </>
  );
}

function Amostra({ cor, aoMudar }: { cor: string; aoMudar: (cor: string) => void }) {
  return (
    <Saliencia rotulo={`Cor ${cor.toUpperCase()}`} largura="w-[300px]" gatilho={<span className="size-6 rounded-full outline-1 -outline-offset-1 outline-[rgb(0_0_0/0.18)]" style={{ backgroundColor: cor }} />}>
      <Cor valor={cor} aoMudar={aoMudar} />
    </Saliencia>
  );
}

/** Um controle que abre num balão sob a barra, para a barra caber numa linha. */
function Saliencia({ rotulo, gatilho, largura = "w-64", children }: { rotulo: string; gatilho: ReactNode; largura?: string; children: ReactNode }) {
  const emTexto = typeof gatilho === "string";
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={emTexto ? undefined : rotulo}
        title={rotulo}
        className={`pressiona grid h-9 flex-none cursor-pointer place-items-center rounded-lg text-sm text-tinta-2 hover:bg-hover hover:text-tinta data-[popup-open]:bg-ativo data-[popup-open]:text-tinta ${emTexto ? "px-2.5" : "w-9"}`}
      >
        {gatilho}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} className="z-50">
          <Popover.Popup
            aria-label={rotulo}
            className={`${largura} origin-(--transform-origin) rounded-cartao border border-linha bg-superficie p-4 shadow-[0_12px_32px_rgb(15_13_10/0.12)] outline-none transition-[opacity,scale] duration-150 ease-(--ease-saida) data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0`}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BotaoDeIcone(props: {
  rotulo: string;
  icone: IconSvgElement;
  onClick?: () => void;
  atalho?: AtalhoId;
  pressionado?: boolean;
  disabled?: boolean;
  pequeno?: boolean;
}) {
  const { rotulo, icone, atalho, pressionado, pequeno, ...resto } = props;
  return (
    <Dica rotulo={rotulo} atalho={atalho} lado="bottom">
      <button
        type="button"
        aria-label={rotulo}
        aria-pressed={pressionado}
        {...resto}
        className={`pressiona grid flex-none cursor-pointer place-items-center rounded-lg text-tinta-2 hover:bg-hover hover:text-tinta disabled:cursor-default disabled:opacity-40 aria-pressed:bg-ativo aria-pressed:text-tinta ${pequeno ? "size-8" : "size-9"}`}
      >
        <HugeiconsIcon icon={icone} size={pequeno ? 15 : 18} strokeWidth={1.6} />
      </button>
    </Dica>
  );
}

const Separador = () => <span aria-hidden="true" className="mx-1 h-6 w-px flex-none bg-linha-forte" />;
