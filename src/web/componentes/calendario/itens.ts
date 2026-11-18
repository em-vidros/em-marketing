import type { ItemAgendado, ItemCalendario, ItemPauta } from "../../../agent/calendario";
import { diaDe, epochDe, minutosDaHora, minutosDe, textoDaHora, type Dia } from "./datas";

export type { ItemAgendado, ItemCalendario, ItemPauta };

/** A identidade de um item na tela, estável entre releituras. */
export type Chave = `pauta:${number}` | `fila:${number}` | `pub:${number}` | `data:${string}`;

/** Onde um item mora na grade. `minutos` null é o dia inteiro. */
export interface Lugar {
  dia: Dia;
  minutos: number | null;
}

export function chaveDe(i: ItemCalendario): Chave {
  switch (i.tipo) {
    case "pauta":
      return `pauta:${i.id}`;
    case "agendado":
      return `fila:${i.filaId}`;
    case "publicado":
      return `pub:${i.publicacaoId}`;
    case "data":
      return `data:${i.dia}:${i.nome}`;
  }
}

export function lugarDe(i: ItemCalendario): Lugar {
  switch (i.tipo) {
    case "pauta":
      return { dia: i.dia, minutos: i.hora === null ? null : minutosDaHora(i.hora) };
    case "agendado":
      return { dia: diaDe(i.publicaEm), minutos: minutosDe(i.publicaEm) };
    case "publicado":
      return { dia: diaDe(i.publicadoEm), minutos: minutosDe(i.publicadoEm) };
    case "data":
      return { dia: i.dia, minutos: null };
  }
}

/** O que pode mudar de lugar: pauta sempre, agendado só enquanto pendente. */
export type AgendadoPendente = ItemAgendado & { status: "pending" };
export type Movel = ItemPauta | AgendadoPendente;

/** Um agendado não tem dia inteiro: no dia inteiro ele leva a hora que já tinha. */
export function noLugar<I extends Movel>(i: I, lugar: Lugar): I {
  if (i.tipo === "pauta") return { ...i, dia: lugar.dia, hora: lugar.minutos === null ? null : textoDaHora(lugar.minutos) };
  const minutos = lugar.minutos ?? minutosDe(i.publicaEm);
  return { ...i, publicaEm: epochDe(lugar.dia, minutos) };
}

export const mesmoLugar = (a: Lugar, b: Lugar) => a.dia === b.dia && a.minutos === b.minutos;

/** O instante de um lugar; o dia inteiro conta como o fim do dia, para hoje ainda valer. */
export const instanteDe = (l: Lugar) => epochDe(l.dia, l.minutos ?? 1439);

const PESO: Record<ItemCalendario["tipo"], number> = { data: 0, pauta: 1, agendado: 2, publicado: 2 };

/** Dia inteiro antes (data editorial, depois pauta sem hora), o resto pela hora. */
export function ordem(a: ItemCalendario, b: ItemCalendario): number {
  const la = lugarDe(a);
  const lb = lugarDe(b);
  if ((la.minutos === null) !== (lb.minutos === null)) return la.minutos === null ? -1 : 1;
  return (la.minutos ?? 0) - (lb.minutos ?? 0) || PESO[a.tipo] - PESO[b.tipo] || tituloDe(a).localeCompare(tituloDe(b), "pt-BR", { numeric: true });
}

export function tituloDe(i: ItemCalendario): string {
  switch (i.tipo) {
    case "pauta":
      return i.titulo;
    case "agendado":
    case "publicado":
      return i.titulo;
    case "data":
      return i.nome;
  }
}

/** Na grade de horas um item ocupa meia hora: post e pauta têm hora, não duração. */
export const DURACAO = 30;

