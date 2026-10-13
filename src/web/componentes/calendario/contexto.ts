import { createContext, useContext, type PointerEvent } from "react";
import type { Leitura } from "./agenda";
import type { Fonte } from "./arrasto";
import type { Dia } from "./datas";
import type { Chave, Lugar } from "./itens";

export type Visao = "dia" | "semana" | "mes";

/** O que as setas movem. Um item selecionado leva o dia junto, para as setas saberem de onde partir. */
export type Selecao = { tipo: "dia"; dia: Dia } | { tipo: "item"; chave: Chave; dia: Dia } | { tipo: "mais"; dia: Dia } | null;

/** O bloco que ainda não existe no servidor: a pauta nova ou o post pronto esperando a confirmação. */
export interface Provisorio {
  lugar: Lugar;
  titulo: string;
}

/** A chave do bloco provisório na tela; o popover e a mola do arrasto se ancoram nele. */
export const PROVISORIO = "provisorio";

export interface Calendario {
  leitura: Leitura;
  /** epoch ms, atualizado a cada minuto */
  agora: number;
  selecao: Selecao;
  selecionar: (s: Selecao) => void;
  abrirItem: (chave: Chave) => void;
  abrirDia: (dia: Dia) => void;
  criar: (lugar: Lugar) => void;
  irParaDia: (dia: Dia) => void;
  descer: (e: PointerEvent<HTMLElement>, fonte: Fonte) => void;
  /** O original esmaece enquanto o fantasma anda. */
  arrastada: Chave | null;
  /** O destino fica invisível até o fantasma assentar nele. */
  assentando: string | null;
  /** O lugar sob o ponteiro durante o arrasto. */
  alvo: Lugar | null;
  provisorio: Provisorio | null;
  /** Abaixo de 640px: mês com pontos, popover vira folha. */
  compacto: boolean;
}

export const ContextoCalendario = createContext<Calendario | null>(null);

export function useCalendario(): Calendario {
  const c = useContext(ContextoCalendario);
  if (!c) throw new Error("useCalendario fora do Calendário.");
  return c;
}
