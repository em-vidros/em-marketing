import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from "react";
import { textoDaHora } from "./datas";
import { PROVISORIO, useCalendario } from "./contexto";
import { chaveDe, ehMovel, lugarDe, pilarDe, rotuloDe, tituloDe, type ItemCalendario } from "./itens";

const Icone = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
    {children}
  </svg>
);

export const Relogio = () => (
  <Icone>
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
const Estrela = () => (
  <Icone>
    <path d="m6 1.6 1.3 2.8 3 .3-2.3 2 .7 3L6 8.2 3.3 9.7l.7-3-2.3-2 3-.3z" />
  </Icone>
);

/** O ícone que diz o estado sem depender da cor. */
function IconeDo({ item }: { item: ItemCalendario }) {
  if (item.tipo === "agendado") return item.status === "failed" ? <Alerta /> : <Relogio />;
  if (item.tipo === "publicado") return <Visto />;
  if (item.tipo === "data") return <Estrela />;
  return null;
}

/** Tom do item: o pilar dá a cor; falha, publicado e data editorial têm o próprio. */
const tomDe = (i: ItemCalendario) =>
  i.tipo === "data" ? "data" : i.tipo === "publicado" ? "publicado" : i.tipo === "agendado" && i.status === "failed" ? "falha" : (pilarDe(i) ?? "nenhum");

type Variante = "linha" | "bloco" | "pilula";

/**
 * Um item do calendário como botão: clique seleciona, clique duplo (ou toque) abre o detalhe,
 * e pauta e agendado pendente começam a arrastar no ponteiro. A forma muda com o lugar: linha
 * no mês, bloco na grade de horas, pílula na faixa de dia inteiro.
 */
export function Item({ item, variante, estilo }: { item: ItemCalendario; variante: Variante; estilo?: CSSProperties }) {
  const c = useCalendario();
  const chave = chaveDe(item);
  const { minutos } = lugarDe(item);
  const selecionado = c.selecao?.tipo === "item" && c.selecao.chave === chave;
  const movel = ehMovel(item);
  const hora = minutos === null ? null : textoDaHora(minutos);

  function aoDescer(e: PointerEvent<HTMLElement>) {
    if (movel && e.pointerType !== "touch") c.descer(e, { tipo: "item", item });
  }
  function aoClicar(e: MouseEvent<HTMLElement>) {
    e.stopPropagation();
    c.selecionar({ tipo: "item", chave, dia: lugarDe(item).dia });
    if ((e.nativeEvent as globalThis.PointerEvent).pointerType === "touch") c.abrirItem(chave);
  }

  return (
    <button
      type="button"
      data-chave={chave}
      data-tom={tomDe(item)}
      data-selecionado={selecionado || undefined}
      data-movel={movel || undefined}
      data-estado={c.assentando === chave ? "assentando" : c.arrastada === chave ? "arrastada" : undefined}
      tabIndex={selecionado ? 0 : -1}
      aria-label={rotuloDe(item)}
      onPointerDown={aoDescer}
      onClick={aoClicar}
      onDoubleClick={(e) => (e.stopPropagation(), c.abrirItem(chave))}
      style={estilo}
      className={`cal-item cal-${variante}`}
    >
      {variante === "bloco" ? (
        <Bloco item={item} hora={hora} />
      ) : (
        <>
          <IconeDo item={item} />
          <span className="min-w-0 flex-1 truncate">{tituloDe(item)}</span>
          {variante === "linha" && hora && <span className="cal-hora tabular">{hora}</span>}
        </>
      )}
    </button>
  );
}

/** Meia hora são 28px: uma linha só, com o ícone do estado, o título, a hora e a capa. */
function Bloco({ item, hora }: { item: ItemCalendario; hora: string | null }) {
  const capa = item.tipo === "agendado" || item.tipo === "publicado" ? item.capa : null;
  return (
    <>
      <IconeDo item={item} />
      <span className="min-w-0 flex-1 truncate font-semibold">{tituloDe(item)}</span>
      <span className="cal-hora tabular">{hora}</span>
      {capa && <img src={capa} alt="" loading="lazy" decoding="async" draggable={false} className="cal-capa" />}
    </>
  );
}

/** O bloco que ainda não existe: a pauta sendo criada ou o post pronto esperando a confirmação. */
export function BlocoProvisorio({ variante, estilo }: { variante: Variante; estilo?: CSSProperties }) {
  const c = useCalendario();
  const p = c.provisorio;
  if (!p) return null;
  const hora = p.lugar.minutos === null ? null : textoDaHora(p.lugar.minutos);
  return (
    <div
      data-chave={PROVISORIO}
      data-tom="nenhum"
      data-estado={c.assentando === PROVISORIO ? "assentando" : undefined}
      aria-hidden="true"
      style={estilo}
      className={`cal-item cal-${variante} cal-provisorio`}
    >
      <span className={`min-w-0 flex-1 truncate ${variante === "bloco" ? "font-semibold" : ""}`}>{p.titulo}</span>
      {variante !== "pilula" && hora && <span className="cal-hora tabular">{hora}</span>}
    </div>
  );
}

/** No mês compacto do celular, um ponto por item, na cor do tom. */
export const Ponto = ({ item }: { item: ItemCalendario }) => <span aria-hidden="true" data-tom={tomDe(item)} className="cal-ponto" />;
