import type { BotId } from "./tipos";

export type { BotId };

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

export interface VisualBot {
  nome: string;
  papel: string;
  /** Contorno do corpo, viewBox 100x100. */
  corpo: string;
  cor: string;
  giroDoCorpo: number;
  olhos: Olhos;
}

const CIRCULO = "M50 6 A44 44 0 1 1 49.99 6 Z";
const SQUIRCLE = "M50 8 C84 8 92 16 92 50 C92 84 84 92 50 92 C16 92 8 84 8 50 C8 16 16 8 50 8 Z";
const NUVEM = "M28 90 C12 90 4 78 9 66 C1 56 8 41 22 43 C21 28 37 21 48 29 C55 15 77 18 79 34 C93 35 99 51 90 61 C100 72 91 90 76 90 Z";
const TRIANGULO = "M50 10 C56 10 60 16 64 24 L91 77 C97 89 89 94 77 94 L23 94 C11 94 3 89 9 77 L36 24 C40 16 44 10 50 10 Z";

const olhos = (x1: number, y1: number, x2: number, y2: number, largura: number, altura: number, giro: number): Olhos => ({
  x1,
  y1,
  x2,
  y2,
  largura,
  altura,
  giro,
});

/** Os personagens do canvas (Bots.dc.html). A ordem é a da barra lateral. */
export const BOTS: Record<BotId, VisualBot> = {
  chefe: {
    nome: "Chefe",
    papel: "Recebe o pedido e divide o trabalho",
    corpo: CIRCULO,
    cor: "#0a0a0a",
    giroDoCorpo: 0,
    olhos: olhos(32, 26, 54, 22, 9, 22, -28),
  },
  post: {
    nome: "Post",
    papel: "Brief, headline, artes e legenda",
    corpo: SQUIRCLE,
    cor: "#1AAE9F",
    giroDoCorpo: 4,
    olhos: olhos(33, 38, 55, 38, 11, 26, 0),
  },
  legenda: {
    nome: "Legenda",
    papel: "Escreve e revisa contra o capítulo 16",
    corpo: SQUIRCLE,
    cor: "#9558FF",
    giroDoCorpo: -14,
    olhos: olhos(36, 50, 53, 46, 8, 16, -28),
  },
  agenda: {
    nome: "Agenda",
    papel: "Fila, calendário e cota de pilares",
    corpo: SQUIRCLE,
    cor: "#1689FF",
    giroDoCorpo: 12,
    olhos: olhos(28, 42, 52, 42, 18, 18, 0),
  },
  fotos: {
    nome: "Fotos",
    papel: "Banco de fotos reais da EM Vidros",
    corpo: NUVEM,
    cor: "#FF9500",
    giroDoCorpo: 0,
    olhos: olhos(36, 48, 54, 48, 10, 22, 8),
  },
  reels: {
    nome: "Reels",
    papel: "Pauta e roteiro de vídeo vertical",
    corpo: TRIANGULO,
    cor: "#FF2D95",
    giroDoCorpo: 0,
    olhos: olhos(37, 56, 54, 56, 8, 15, -25),
  },
};

export const BOT_IDS = Object.keys(BOTS) as BotId[];
