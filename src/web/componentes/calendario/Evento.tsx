import { useEffect, useRef, type ReactNode } from "react";
import type { EventColor, EventContentProps } from "@/shadcn/calendar-types";
import type { EventoDoCalendario, ItemNaTela } from "./eventos";
import { ehIdeia, remocaoDe, ROTULO_DA_REMOCAO } from "./eventos";

/** Texto sobre o fundo claro de cada cor; selecionado, o fundo vira a cor cheia e o texto, branco. */
const TEXTO: Record<EventColor, string> = {
  red: "text-event-red",
  orange: "text-event-orange",
  yellow: "text-event-yellow",
  green: "text-event-green",
  blue: "text-event-blue",
  purple: "text-event-purple",
  gray: "text-event-gray",
};

interface PropsDoIcone {
  tamanho?: number;
}

const Icone = ({ children, tamanho = 11 }: PropsDoIcone & { children: ReactNode }) => (
  <svg aria-hidden="true" width={tamanho} height={tamanho} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
    {children}
  </svg>
);

export const Relogio = ({ tamanho }: PropsDoIcone) => (
  <Icone tamanho={tamanho}>
    <circle cx="6" cy="6" r="4.6" />
    <path d="M6 3.6V6l1.6 1" />
  </Icone>
);

export const Visto = () => (
  <Icone>
    <path d="M2.5 6.3 5 8.6l4.5-5" />
  </Icone>
);

export const Alerta = () => (
  <Icone>
    <path d="M6 1.8 10.6 10H1.4z" />
    <path d="M6 5v2M6 8.6v.1" />
  </Icone>
);

export const Lampada = ({ tamanho }: PropsDoIcone) => (
  <Icone tamanho={tamanho}>
    <path d="M6 1.5a3.3 3.3 0 0 0-2 5.9c.4.3.6.7.6 1.1v.3h2.8v-.3c0-.4.2-.8.6-1.1A3.3 3.3 0 0 0 6 1.5z" />
    <path d="M4.8 10.6h2.4" />
  </Icone>
);

const Estrela = () => (
  <Icone>
    <path d="m6 1.6 1.3 2.8 3 .3-2.3 2 .7 3L6 8.2 3.3 9.7l.7-3-2.3-2 3-.3z" />
  </Icone>
);

/** O ícone diz o estado sem depender da cor: ideia, agendado, falhou, publicado ou data editorial. */
function IconeDoEstado({ item }: { item: ItemNaTela }) {
  switch (item.tipo) {
    case "agendado":
      return item.status === "failed" ? <Alerta /> : <Relogio />;
    case "publicado":
      return <Visto />;
    case "data":
      return <Estrela />;
    case "pauta":
      return <Lampada />;
    case "rascunho":
      return null;
  }
}

const capaDe = (i: ItemNaTela) => (i.tipo === "agendado" || i.tipo === "publicado" ? i.capa : null);

/** A linha do mês não tem fundo colorido, só a barra; os outros lugares pintam o fundo com a cor. */
function corDoTexto({ event, placement, isSelected }: EventContentProps<EventoDoCalendario>) {
  if (placement === "month-item") return "text-tinta";
  return isSelected ? "text-white" : TEXTO[event.color ?? "gray"];
}

/** O miolo de cada evento: ícone do estado, hora, título e, na grade de horas, a capa do post. */
export function ConteudoDoEvento(props: EventContentProps<EventoDoCalendario>) {
  const { event, placement, timeLabel } = props;
  const { item } = event;
  const naLinhaDoMes = placement === "month-item";
  const capa = placement === "time-grid" ? capaDe(item) : null;
  // A linha do mês não tem fundo nem borda para tracejar: lá a ideia se vê pela lâmpada.
  const tracejado = ehIdeia(item) && !naLinhaDoMes;

  return (
    <span data-cor={tracejado ? event.color : undefined} className={`flex h-full min-w-0 items-center gap-1 pr-1 text-[11px]/tight ${tracejado ? "cal-ideia" : ""} ${corDoTexto(props)}`}>
      <IconeDoEstado item={item} />
      {naLinhaDoMes && timeLabel && <span className="flex-none text-tinta-2 tabular">{timeLabel}</span>}
      <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
      {capa && <img src={capa} alt="" loading="lazy" decoding="async" draggable={false} className="h-[calc(100%-2px)] max-h-9 flex-none rounded-[3px] object-cover outline outline-1 -outline-offset-1 outline-black/10 aspect-[4/5]" />}
    </span>
  );
}

/** O menu do botão direito: o que a tabela de regras deixa fazer com o item, mais abrir o detalhe. */
export function MenuDoEvento({ evento, fechar, abrir, remover }: { evento: EventoDoCalendario; fechar: () => void; abrir: () => void; remover: () => void }) {
  const primeiro = useRef<HTMLButtonElement>(null);
  const remocao = remocaoDe(evento.item);
  const link = evento.item.tipo === "publicado" ? evento.item.link : null;
  useEffect(() => primeiro.current?.focus(), []);

  const item = "flex h-8 w-full cursor-pointer items-center rounded-[8px] px-2.5 text-left text-[13px] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none";

  return (
    <div role="menu" aria-label={evento.title} data-teclado="isolado" className="min-w-[200px] rounded-item border border-linha bg-superficie p-1 shadow-[0_8px_24px_rgb(15_13_10/0.12)]">
      <button ref={primeiro} type="button" role="menuitem" onClick={() => (fechar(), abrir())} className={item}>
        Abrir detalhes
      </button>
      {link && (
        <a role="menuitem" href={link} target="_blank" rel="noreferrer" onClick={fechar} className={item}>
          Abrir no Instagram
        </a>
      )}
      {remocao && (
        <button type="button" role="menuitem" onClick={() => (fechar(), remover())} className={`${item} text-erro`}>
          {ROTULO_DA_REMOCAO[remocao.acao]}
        </button>
      )}
    </div>
  );
}
