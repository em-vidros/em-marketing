import { useEffect, useSyncExternalStore } from "react";
import type { BotFixo, BotId, Forma } from "../agent/bots";
import type { ConfigBot } from "../agent/config";
import type { ToolName } from "../agent/tools";
import { pegar } from "./api";

export type { BotFixo, BotId, Forma };

/** Dois olhos em pílula, iguais, girados no próprio centro. Coordenadas no viewBox 100x100. */
interface Olhos {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  largura: number;
  altura: number;
  giro: number;
}

export interface Visual {
  /** Contorno do corpo, viewBox 100x100. */
  corpo: string;
  cor: string;
  giroDoCorpo: number;
  olhos: Olhos;
}

const olhos = (x1: number, y1: number, x2: number, y2: number, largura: number, altura: number, giro: number): Olhos => ({
  x1,
  y1,
  x2,
  y2,
  largura,
  altura,
  giro,
});

/** Cada forma com os olhos que um bot criado ganha nela: no centro de massa, sem giro. */
export const FORMAS: Record<Forma, { rotulo: string; corpo: string; olhos: Olhos }> = {
  circulo: { rotulo: "Círculo", corpo: "M50 6 A44 44 0 1 1 49.99 6 Z", olhos: olhos(33, 36, 55, 36, 11, 24, 0) },
  squircle: {
    rotulo: "Quadrado",
    corpo: "M50 8 C84 8 92 16 92 50 C92 84 84 92 50 92 C16 92 8 84 8 50 C8 16 16 8 50 8 Z",
    olhos: olhos(33, 38, 55, 38, 11, 26, 0),
  },
  nuvem: {
    rotulo: "Nuvem",
    corpo: "M28 90 C12 90 4 78 9 66 C1 56 8 41 22 43 C21 28 37 21 48 29 C55 15 77 18 79 34 C93 35 99 51 90 61 C100 72 91 90 76 90 Z",
    olhos: olhos(36, 48, 54, 48, 10, 22, 0),
  },
  triangulo: {
    rotulo: "Triângulo",
    corpo: "M50 10 C56 10 60 16 64 24 L91 77 C97 89 89 94 77 94 L23 94 C11 94 3 89 9 77 L36 24 C40 16 44 10 50 10 Z",
    olhos: olhos(37, 56, 54, 56, 8, 15, 0),
  },
};

/** As cores oferecidas ao criar um bot: as dos bots fixos e mais quatro. */
export const CORES = ["#0a0a0a", "#1AAE9F", "#9558FF", "#1689FF", "#FF9500", "#FF2D95", "#E5484D", "#30A46C", "#F5B400", "#6E56CF"] as const;

const { circulo, squircle, nuvem, triangulo } = FORMAS;

/** Os personagens do canvas (Bots.dc.html), com nome e descrição do código até GET /api/bots responder. A ordem é a da barra lateral. */
export const BOTS: Record<BotFixo, Visual & { nome: string; papel: string }> = {
  chefe: { nome: "Chefe", papel: "Recebe o pedido e divide o trabalho", corpo: circulo.corpo, cor: "#0a0a0a", giroDoCorpo: 0, olhos: olhos(32, 26, 54, 22, 9, 22, -28) },
  post: { nome: "Post", papel: "Brief, headline, artes e legenda", corpo: squircle.corpo, cor: "#1AAE9F", giroDoCorpo: 4, olhos: olhos(33, 38, 55, 38, 11, 26, 0) },
  legenda: {
    nome: "Legenda",
    papel: "Escreve e revisa contra o capítulo 16",
    corpo: squircle.corpo,
    cor: "#9558FF",
    giroDoCorpo: -14,
    olhos: olhos(36, 50, 53, 46, 8, 16, -28),
  },
  agenda: { nome: "Agenda", papel: "Fila, calendário e cota de pilares", corpo: squircle.corpo, cor: "#1689FF", giroDoCorpo: 12, olhos: olhos(28, 42, 52, 42, 18, 18, 0) },
  fotos: { nome: "Fotos", papel: "Banco de fotos reais da EM Vidros", corpo: nuvem.corpo, cor: "#FF9500", giroDoCorpo: 0, olhos: olhos(36, 48, 54, 48, 10, 22, 8) },
  reels: { nome: "Reels", papel: "Pauta e roteiro de vídeo vertical", corpo: triangulo.corpo, cor: "#FF2D95", giroDoCorpo: 0, olhos: olhos(37, 56, 54, 56, 8, 15, -25) },
};

export const BOT_IDS = Object.keys(BOTS) as BotFixo[];

export const ehBotFixo = (id: string): id is BotFixo => Object.hasOwn(BOTS, id);

export const visualCriado = (forma: Forma, cor: string): Visual => ({ corpo: FORMAS[forma].corpo, cor, giroDoCorpo: 0, olhos: FORMAS[forma].olhos });

/** Um bot como a barra, a paleta e as conversas mostram. */
export interface BotDaEquipe {
  id: BotId;
  nome: string;
  descricao: string;
  setor: string;
  visual: Visual;
  /** Gera artes, direto ou pelo Post: o composer dele aceita referências e imagens do pedido. */
  geraArtes: boolean;
}

/** Os bots de GET /api/bots. `de` acha qualquer id, inclusive o de um bot apagado que ainda tem conversa. */
export interface Equipe {
  lista: readonly BotDaEquipe[];
  de: (id: BotId) => BotDaEquipe;
}

const SETOR_PADRAO = "Marketing";

const GERAM_ARTES: readonly ToolName[] = ["produzir_post", "gerar_3_artes", "delegar_post"];

const doFixo = (id: BotFixo): BotDaEquipe => ({
  id,
  nome: BOTS[id].nome,
  descricao: BOTS[id].papel,
  setor: SETOR_PADRAO,
  visual: BOTS[id],
  geraArtes: id === "chefe" || id === "post",
});

const daApi = (b: ConfigBot): BotDaEquipe => ({
  id: b.id,
  nome: b.nome,
  descricao: b.descricao,
  setor: b.setor,
  visual: b.criado ? visualCriado(b.criado.forma, b.criado.cor) : ehBotFixo(b.id) ? BOTS[b.id] : visualCriado("circulo", CORES[0]),
  geraArtes: b.tools.some((t) => GERAM_ARTES.includes(t)),
});

const APAGADO = (id: BotId): BotDaEquipe => ({
  id,
  nome: "Bot apagado",
  descricao: "Este bot foi apagado.",
  setor: "",
  visual: visualCriado("circulo", "#a8a29e"),
  geraArtes: false,
});

function montar(lista: readonly BotDaEquipe[]): Equipe {
  const porId = new Map(lista.map((b) => [b.id, b]));
  return { lista, de: (id) => porId.get(id) ?? (ehBotFixo(id) ? doFixo(id) : APAGADO(id)) };
}

let equipe = montar(BOT_IDS.map(doFixo));
let pedido: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

/** Relê GET /api/bots. Quem cria, apaga ou grava a config de um bot chama isto para a barra e a paleta mudarem. */
export function recarregarBots(): Promise<void> {
  pedido = pegar<ConfigBot[]>("/api/bots")
    .then((lista) => {
      equipe = montar(lista.map(daApi));
      for (const o of ouvintes) o();
    })
    .catch(() => {});
  return pedido;
}

export function useEquipe(): Equipe {
  useEffect(() => void (pedido ?? recarregarBots()), []);
  return useSyncExternalStore(
    (o) => (ouvintes.add(o), () => ouvintes.delete(o)),
    () => equipe,
  );
}

/** Os setores na ordem em que aparecem, cada um com os bots dele. */
export function porSetor(lista: readonly BotDaEquipe[]): [string, BotDaEquipe[]][] {
  const grupos = new Map<string, BotDaEquipe[]>();
  for (const b of lista) grupos.set(b.setor, [...(grupos.get(b.setor) ?? []), b]);
  return [...grupos];
}
