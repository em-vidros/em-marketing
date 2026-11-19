import type { StatusAgendado } from "../../../agent/calendario";
import type { Pilar } from "../../../db";
import type { CalendarEvent, EventColor } from "../../shadcn/calendar-types";
import type { Dia } from "./datas";
import { chaveDe, DURACAO, ehDaEquipe, instanteDe, lugarDe, mesmoLugar, tituloDe, type ItemAgendado, type ItemCalendario, type ItemDataDaEquipe, type ItemPauta, type Lugar, type Movel } from "./itens";

/** Por onde o detalhe do rascunho começa: a escolha entre ideia e agendamento, ou direto na ideia. */
export type AberturaDoRascunho = "escolha" | "ideia";

/** O bloco que ainda não existe no servidor: o espaço vazio clicado, esperando virar pauta ou agendamento. */
export interface Rascunho {
  tipo: "rascunho";
  lugar: Lugar;
  abreEm: AberturaDoRascunho;
}

export type ItemNaTela = ItemCalendario | Rascunho;

export type EventoDoCalendario = CalendarEvent & { item: ItemNaTela };

/** O que Delete e o menu de contexto fazem com cada item, já com o item no tipo que a agenda pede. */
export type Remocao =
  | { acao: "apagar-pauta"; pauta: ItemPauta }
  | { acao: "cancelar"; agendado: ItemAgendado }
  | { acao: "dispensar"; agendado: ItemAgendado }
  | { acao: "apagar-data"; data: ItemDataDaEquipe };

/** O que um arrasto ou um ⌥ com seta vira na agenda. */
export type Mudanca = { tipo: "nada" } | { tipo: "recusar"; motivo: string } | { tipo: "mover"; item: Movel; lugar: Lugar };

export const RASCUNHO = "rascunho";

export const PASSADO = "Esse horário já passou. Escolha um horário no futuro.";

export const ROTULO_DA_REMOCAO: Record<Remocao["acao"], string> = {
  "apagar-pauta": "Apagar pauta",
  cancelar: "Cancelar agendamento",
  dispensar: "Dispensar falha",
  "apagar-data": "Apagar data",
};

interface Regra<I extends ItemNaTela> {
  movel: (i: I) => boolean;
  remocao: (i: I) => Remocao | null;
  cor: (i: I) => EventColor;
  /** Ideia ainda não é post: o bloco fica tracejado e mais claro. */
  ideia: boolean;
}

const COR_DO_PILAR: Record<Pilar, EventColor> = { PROVA: "green", AUTORIDADE: "purple", GENTE: "blue", MARCA: "orange" };

/** Publicando já está com a Meta: não dá para tirar do calendário. */
const REMOCAO_DO_AGENDADO = { pending: "cancelar", failed: "dispensar", publishing: null } as const satisfies Record<StatusAgendado, Remocao["acao"] | null>;

const corDoPilar = (pilar: Pilar | null): EventColor => (pilar ? COR_DO_PILAR[pilar] : "gray");

/** As regras de cada tipo de item num lugar só: o que arrasta, o que sai do calendário e a cor. */
const REGRAS: { [T in ItemNaTela["tipo"]]: Regra<Extract<ItemNaTela, { tipo: T }>> } = {
  pauta: {
    movel: () => true,
    remocao: (pauta) => ({ acao: "apagar-pauta", pauta }),
    cor: (p) => corDoPilar(p.pilar),
    ideia: true,
  },
  agendado: {
    movel: (a) => a.status === "pending",
    remocao: (agendado) => {
      const acao = REMOCAO_DO_AGENDADO[agendado.status];
      return acao && { acao, agendado };
    },
    cor: (a) => (a.status === "failed" ? "red" : corDoPilar(a.pilar)),
    ideia: false,
  },
  publicado: { movel: () => false, remocao: () => null, cor: (p) => corDoPilar(p.pilar), ideia: false },
  data: { movel: () => false, remocao: (data) => (ehDaEquipe(data) ? { acao: "apagar-data", data } : null), cor: () => "yellow", ideia: false },
  rascunho: { movel: () => false, remocao: () => null, cor: () => "gray", ideia: false },
};

const regraDe = <I extends ItemNaTela>(i: I) => REGRAS[i.tipo] as Regra<I>;

/** Pauta sempre; agendado só enquanto pendente. */
export const ehMovel = (i: ItemNaTela): i is Movel => regraDe(i).movel(i);

export const remocaoDe = (i: ItemNaTela) => regraDe(i).remocao(i);

export const ehIdeia = (i: ItemNaTela) => regraDe(i).ideia;

/**
 * O CalendarCN desenha no fuso de quem abre a tela, e os dias do app são de São Paulo. Os
 * eventos levam um Date "de parede", com os campos locais iguais à hora de São Paulo, para a
 * grade mostrar a hora de São Paulo em qualquer fuso; a volta lê os mesmos campos.
 */
export const paraParede = (dia: Dia, minutos: number) => new Date(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8)), 0, minutos);

export function lugarDaParede(data: Date, diaInteiro: boolean): Lugar {
  const dia = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}` as Dia;
  return { dia, minutos: diaInteiro ? null : data.getHours() * 60 + data.getMinutes() };
}

export const idDe = (i: ItemNaTela) => (i.tipo === "rascunho" ? RASCUNHO : chaveDe(i));

export function eventoDe(item: ItemNaTela): EventoDoCalendario {
  const { dia, minutos } = item.tipo === "rascunho" ? item.lugar : lugarDe(item);
  const regra = regraDe(item);
  const base = {
    id: idDe(item),
    title: item.tipo === "rascunho" ? "Novo" : tituloDe(item),
    color: regra.cor(item),
    draggable: regra.movel(item),
    resizable: false,
    item,
  };
  if (minutos === null) return { ...base, start: paraParede(dia, 0), end: paraParede(dia, 1439), isAllDay: true };

  return { ...base, start: paraParede(dia, minutos), end: paraParede(dia, Math.min(minutos + DURACAO, 1440)) };
}

/**
 * A mudança que o CalendarCN pede para um evento, traduzida para a agenda. O evento chega com
 * o horário novo e o item ainda no lugar antigo.
 */
export function mudancaDe(evento: EventoDoCalendario, agora: number): Mudanca {
  const { item } = evento;
  if (!ehMovel(item)) return { tipo: "nada" };

  const lugar = lugarDaParede(evento.start, Boolean(evento.isAllDay));
  if (mesmoLugar(lugarDe(item), lugar)) return { tipo: "nada" };
  if (instanteDe(lugar) <= agora) return { tipo: "recusar", motivo: PASSADO };

  return { tipo: "mover", item, lugar };
}

/** O espaço vazio clicado vira rascunho; no passado, a recusa. */
export function rascunhoEm(lugar: Lugar, agora: number, abreEm: AberturaDoRascunho = "escolha"): Rascunho | { recusa: string } {
  if (instanteDe(lugar) <= agora) return { recusa: PASSADO };

  return { tipo: "rascunho", lugar, abreEm };
}
