import type { ItemAgendado, ItemCalendario, ItemPauta } from "../../../agent/calendario";
import type { Pilar } from "../../../db";
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
export type Movel = ItemPauta | (ItemAgendado & { status: "pending" });

export const ehMovel = (i: ItemCalendario): i is Movel => i.tipo === "pauta" || (i.tipo === "agendado" && i.status === "pending");

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
  return (la.minutos ?? 0) - (lb.minutos ?? 0) || PESO[a.tipo] - PESO[b.tipo] || tituloDe(a).localeCompare(tituloDe(b), "pt-BR");
}

const SEM_TITULO = "Post sem headline";

export function tituloDe(i: ItemCalendario): string {
  switch (i.tipo) {
    case "pauta":
      return i.titulo;
    case "agendado":
    case "publicado":
      return i.headline ?? `${SEM_TITULO} (${i.postId})`;
    case "data":
      return i.nome;
  }
}

export const pilarDe = (i: ItemCalendario): Pilar | null => (i.tipo === "data" ? null : i.pilar);

const NOME_DO_TIPO = { pauta: "Pauta", agendado: "Agendado", publicado: "Publicado", data: "Data do calendário editorial" } as const;

/** O nome acessível: tipo, título, hora e o estado que a cor sozinha não diz. */
export function rotuloDe(i: ItemCalendario): string {
  const { minutos } = lugarDe(i);
  const partes = [`${NOME_DO_TIPO[i.tipo]}: ${tituloDe(i)}`, minutos === null ? "dia inteiro" : textoDaHora(minutos)];
  if (i.tipo === "agendado") partes.push(i.status === "failed" ? "falhou" : i.status === "publishing" ? "publicando agora" : i.midia === "STORIES" ? "stories" : "feed");
  const pilar = pilarDe(i);
  if (pilar) partes.push(`pilar ${pilar}`);
  return partes.join(", ");
}

/** Na grade de horas um item ocupa meia hora: post e pauta têm hora, não duração. */
export const DURACAO = 30;

/** Colunas lado a lado num grupo de itens que se cruzam; acima disso, o resto vira "+N". */
export const MAX_FAIXAS = 4;

export interface Faixa {
  faixa: number;
  faixas: number;
}

/**
 * Lado a lado, como no Calendário da Apple: cada grupo de itens que se cruzam divide a largura
 * em faixas, e cada item vai para a primeira faixa livre. A entrada vem em ordem de início.
 */
export function faixas(itens: readonly { chave: string; minutos: number }[]): Map<string, Faixa> {
  const saida = new Map<string, Faixa>();
  let grupo: { chave: string; faixa: number }[] = [];
  let fins: number[] = [];
  let fimDoGrupo = -1;
  const fechar = () => {
    for (const g of grupo) saida.set(g.chave, { faixa: g.faixa, faixas: fins.length });
    grupo = [];
    fins = [];
  };
  for (const { chave, minutos } of itens) {
    if (minutos >= fimDoGrupo) fechar();
    let faixa = fins.findIndex((fim) => fim <= minutos);
    if (faixa < 0) faixa = fins.push(0) - 1;
    fins[faixa] = minutos + DURACAO;
    fimDoGrupo = Math.max(fimDoGrupo, minutos + DURACAO);
    grupo.push({ chave, faixa });
  }
  fechar();
  return saida;
}
