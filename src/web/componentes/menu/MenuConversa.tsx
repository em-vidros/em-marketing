import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import { type ReactElement, useRef, useState } from "react";
import { acorde, ATALHOS, type AtalhoId, ehMac, sequencia } from "../../teclado/atalhos";
import type { Conversa } from "../../tipos";
import { Teclas } from "./Teclas";

export interface AcoesConversa {
  renomear: (id: string) => void;
  arquivar: (id: string, arquivar: boolean) => void;
  excluir: (id: string) => void;
}

interface Item {
  atalho: AtalhoId;
  rotulo: string;
  fazer: () => void;
  perigo?: true;
}

/** Os itens do "…" e do clique direito são os mesmos, com a mesma tecla que o atalho da lista. */
const itensDe = (c: Conversa, acoes: AcoesConversa): Item[] => [
  { atalho: "conversa-renomear", rotulo: "Renomear", fazer: () => acoes.renomear(c.id) },
  { atalho: "conversa-arquivar", rotulo: c.arquivadaEm === null ? "Arquivar" : "Desarquivar", fazer: () => acoes.arquivar(c.id, c.arquivadaEm === null) },
  { atalho: "conversa-excluir", rotulo: "Excluir", fazer: () => acoes.excluir(c.id), perigo: true },
];

/**
 * O conteúdo do menu. Apertar a tecla de um item com o menu aberto roda o item, como no
 * Linear; sem isto a busca por letra do menu só destacaria o item.
 */
function Itens({ itens, rodar, focoFinal }: { itens: Item[]; rodar: (i: Item) => void; focoFinal: () => boolean }) {
  return (
    <Menu.Popup
      data-teclado="isolado"
      finalFocus={focoFinal}
      onKeyDownCapture={(e) => {
        const c = acorde(e, ehMac);
        const item = itens.find((i) => ATALHOS[i.atalho].teclas.some((t) => sequencia(t).join(" ") === c));
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        rodar(item);
      }}
      className="menu-popup min-w-52 rounded-cartao border border-linha bg-superficie p-1.5 shadow-[0_8px_28px_rgb(15_13_10/0.12),0_1px_3px_rgb(15_13_10/0.06)] outline-none"
    >
      {itens.map((i) => (
        <Menu.Item
          key={i.atalho}
          onClick={() => rodar(i)}
          className={`flex h-9 cursor-pointer items-center gap-3 rounded-[10px] px-2.5 outline-none select-none data-highlighted:bg-hover ${i.perigo ? "text-erro" : "text-tinta"}`}
        >
          <span className="flex-1">{i.rotulo}</span>
          <Teclas atalho={i.atalho} />
        </Menu.Item>
      ))}
    </Menu.Popup>
  );
}

/** Abre e fecha o menu; quem roda um item cuida do foco, então o menu não devolve o foco ao gatilho. */
function useMenu(itens: Item[]) {
  const [aberto, setAberto] = useState(false);
  const rodou = useRef(false);
  const rodar = (i: Item) => {
    rodou.current = true;
    setAberto(false);
    i.fazer();
  };
  const aoMudar = (a: boolean) => {
    if (a) rodou.current = false;
    setAberto(a);
  };
  return { aberto, aoMudar, rodar, focoFinal: () => !rodou.current, itens };
}

/** O botão "…" da linha. */
export function BotaoAcoes({ conversa, acoes }: { conversa: Conversa; acoes: AcoesConversa }) {
  const m = useMenu(itensDe(conversa, acoes));
  return (
    <Menu.Root open={m.aberto} onOpenChange={m.aoMudar}>
      <Menu.Trigger
        aria-label={`Ações de ${conversa.titulo}`}
        tabIndex={-1}
        className="acoes-linha grid size-8 flex-none cursor-pointer place-items-center rounded-[9px] text-tinta-3 hover:bg-ativo hover:text-tinta data-popup-open:bg-ativo data-popup-open:text-tinta"
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3.5" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.5" cy="8" r="1.25" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-[60]">
          <Itens itens={m.itens} rodar={m.rodar} focoFinal={m.focoFinal} />
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Clique direito (ou toque longo) na linha abre o mesmo menu, no ponteiro. */
export function MenuDeContexto({ conversa, acoes, children }: { conversa: Conversa; acoes: AcoesConversa; children: ReactElement }) {
  const m = useMenu(itensDe(conversa, acoes));
  return (
    <ContextMenu.Root open={m.aberto} onOpenChange={m.aoMudar}>
      <ContextMenu.Trigger render={children} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-[60]">
          <Itens itens={m.itens} rodar={m.rodar} focoFinal={m.focoFinal} />
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
