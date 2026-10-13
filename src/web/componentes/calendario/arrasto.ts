import type { PostPronto } from "../../../agent/fila";
import { chaveDe, instanteDe, lugarDe, mesmoLugar, type Lugar, type Movel } from "./itens";

/**
 * O arrasto de um item ou de um post pronto, como máquina de estados. O hook da tela traduz o
 * ponteiro em eventos e o lugar sob ele em `alvo`; aqui ficam as regras: o limiar antes de
 * levantar, a velocidade na hora de soltar e o que cada soltura vira.
 */

export type Fonte = { tipo: "item"; item: Movel } | { tipo: "pronto"; post: PostPronto };

export interface Ponto {
  x: number;
  y: number;
  /** ms, do performance.now() */
  t: number;
}

/** O retângulo de onde o arrasto saiu, para voltar a ele. */
export interface Caixa {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export type Soltura =
  | { tipo: "mover"; lugar: Lugar }
  /** Agendado e post pronto mudam o que sai no Instagram: pedem confirmação antes de gravar. */
  | { tipo: "confirmar"; lugar: Lugar }
  | { tipo: "voltar"; motivo: string | null };

interface Base {
  fonte: Fonte;
  /** Onde o ponteiro pegou o item, medido do canto de cima à esquerda. */
  pegada: { x: number; y: number };
  caixa: Caixa;
}

export type Arrasto =
  | { fase: "parado" }
  | (Base & { fase: "pressionado"; inicio: Ponto })
  | (Base & { fase: "arrastando"; pontos: Ponto[]; alvo: Lugar | null })
  | (Base & { fase: "soltando"; ponto: Ponto; soltura: Soltura; velocidade: { x: number; y: number } });

export type Evento =
  | { tipo: "descer"; fonte: Fonte; ponto: Ponto; pegada: Base["pegada"]; caixa: Caixa }
  | { tipo: "mover"; ponto: Ponto; alvo: Lugar | null }
  | { tipo: "soltar"; ponto: Ponto; agora: number }
  | { tipo: "cancelar" }
  /** A mola terminou, ou a confirmação fechou. */
  | { tipo: "assentou" };

export const PARADO: Arrasto = { fase: "parado" };

/** Menos que isto é um clique; o item só levanta depois. */
export const LIMIAR = 4;

/** A velocidade de soltar vem dos últimos 80 ms; parar antes de soltar zera a herança. */
const JANELA = 80;

export const PASSADO = "Esse horário já passou. Escolha um horário no futuro.";

export function velocidade(pontos: readonly Ponto[]): { x: number; y: number } {
  const ultimo = pontos.at(-1);
  if (!ultimo) return { x: 0, y: 0 };
  const primeiro = pontos.find((p) => ultimo.t - p.t <= JANELA) ?? ultimo;
  const dt = (ultimo.t - primeiro.t) / 1000;
  return dt > 0 ? { x: (ultimo.x - primeiro.x) / dt, y: (ultimo.y - primeiro.y) / dt } : { x: 0, y: 0 };
}

export function decidir(fonte: Fonte, alvo: Lugar | null, agora: number): Soltura {
  if (!alvo) return { tipo: "voltar", motivo: null };
  if (fonte.tipo === "item" && mesmoLugar(lugarDe(fonte.item), alvo)) return { tipo: "voltar", motivo: null };
  if (instanteDe(alvo) <= agora) return { tipo: "voltar", motivo: PASSADO };
  return fonte.tipo === "item" && fonte.item.tipo === "pauta" ? { tipo: "mover", lugar: alvo } : { tipo: "confirmar", lugar: alvo };
}

export function reduzir(a: Arrasto, e: Evento): Arrasto {
  switch (e.tipo) {
    case "descer":
      return a.fase === "parado" ? { fase: "pressionado", fonte: e.fonte, pegada: e.pegada, caixa: e.caixa, inicio: e.ponto } : a;
    case "mover":
      if (a.fase === "pressionado") {
        if (Math.hypot(e.ponto.x - a.inicio.x, e.ponto.y - a.inicio.y) < LIMIAR) return a;
        return { fase: "arrastando", fonte: a.fonte, pegada: a.pegada, caixa: a.caixa, pontos: [a.inicio, e.ponto], alvo: e.alvo };
      }
      if (a.fase === "arrastando") return { ...a, pontos: [...a.pontos.filter((p) => e.ponto.t - p.t <= JANELA * 2), e.ponto], alvo: e.alvo };
      return a;
    case "soltar":
      if (a.fase !== "arrastando") return PARADO;
      return {
        fase: "soltando",
        fonte: a.fonte,
        pegada: a.pegada,
        caixa: a.caixa,
        ponto: e.ponto,
        soltura: decidir(a.fonte, a.alvo, e.agora),
        velocidade: velocidade([...a.pontos, e.ponto]),
      };
    case "cancelar":
      return a.fase === "arrastando" ? { fase: "soltando", fonte: a.fonte, pegada: a.pegada, caixa: a.caixa, ponto: a.pontos.at(-1)!, soltura: { tipo: "voltar", motivo: null }, velocidade: { x: 0, y: 0 } } : PARADO;
    case "assentou":
      return PARADO;
  }
}

/** A chave do item que está sendo arrastado, para a tela esmaecer o original. */
export const chaveArrastada = (a: Arrasto) => (a.fase !== "parado" && a.fase !== "pressionado" && a.fonte.tipo === "item" ? chaveDe(a.fonte.item) : null);
