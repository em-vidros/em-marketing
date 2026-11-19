import { FORMATOS, PROPORCAO_DO_LOGO, transformacaoDa, type Camada, type Formato } from "../../../v2/camadas";

/** A caixa sem giro de uma camada, em px da arte. A altura de um texto só o palco sabe, depois de medir as linhas. */
export interface Caixa {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export type Destino = "frente" | "tras" | "topo" | "fundo";

export type Borda = "esquerda" | "centro" | "direita" | "topo" | "meio" | "base";

export const MAXIMO_DE_CAMADAS = 30;

export const novoId = () => crypto.randomUUID().slice(0, 8);

export const substituir = (camadas: Camada[], nova: Camada) => camadas.map((c) => (c.id === nova.id ? nova : c));

/** Faixas entram logo acima da cena, para não cobrir o texto; o resto entra por cima de tudo. */
export const acrescentar = (camadas: Camada[], nova: Camada) => (nova.tipo === "forma" ? [nova, ...camadas] : [...camadas, nova]);

/** A cópia sai deslocada da original, para as duas não se confundirem, e destravada. */
export function copiaDe(original: Camada, id: string): Camada {
  const DESLOCAMENTO = 24;
  return { ...original, id, x: original.x + DESLOCAMENTO, y: original.y + DESLOCAMENTO, bloqueada: undefined };
}

export function duplicar(camadas: Camada[], copia: Camada, idDaOriginal: string): Camada[] {
  const indice = camadas.findIndex((c) => c.id === idDaOriginal);
  return [...camadas.slice(0, indice + 1), copia, ...camadas.slice(indice + 1)];
}

export function moverNaPilha(camadas: Camada[], id: string, destino: Destino): Camada[] {
  const de = camadas.findIndex((c) => c.id === id);
  const para = { frente: de + 1, tras: de - 1, topo: camadas.length - 1, fundo: 0 }[destino];

  return reordenar(camadas, de, para);
}

export function reordenar(camadas: Camada[], de: number, para: number): Camada[] {
  const movida = camadas[de];
  const limite = Math.min(camadas.length - 1, Math.max(0, para));
  if (!movida || limite === de) return camadas;

  const sem = camadas.filter((_, i) => i !== de);

  return [...sem.slice(0, limite), movida, ...sem.slice(limite)];
}

/** Encosta a caixa girada na borda da arte; x e y seguem sendo o canto da caixa sem giro. */
export function alinharNaPagina(camada: Camada, caixa: Caixa, formato: Formato, borda: Borda): Camada {
  const { largura, altura } = FORMATOS[formato];
  const raio = (transformacaoDa(camada).rotacao * Math.PI) / 180;
  const metadeX = (Math.abs(caixa.largura * Math.cos(raio)) + Math.abs(caixa.altura * Math.sin(raio))) / 2;
  const metadeY = (Math.abs(caixa.largura * Math.sin(raio)) + Math.abs(caixa.altura * Math.cos(raio))) / 2;

  const x = (centro: number) => ({ x: Math.round(centro - caixa.largura / 2) });
  const y = (centro: number) => ({ y: Math.round(centro - caixa.altura / 2) });
  const posicao = {
    esquerda: x(metadeX),
    centro: x(largura / 2),
    direita: x(largura - metadeX),
    topo: y(metadeY),
    meio: y(altura / 2),
    base: y(altura - metadeY),
  }[borda];

  return { ...camada, ...posicao };
}

export function empurrar(camada: Camada, dx: number, dy: number): Camada {
  return { ...camada, x: camada.x + dx, y: camada.y + dy };
}

export type PresetDeTexto = "titulo" | "subtitulo" | "corpo" | "display";

const PRESETS: Record<PresetDeTexto, Pick<Extract<Camada, { tipo: "texto" }>, "texto" | "fonte" | "peso" | "tamanho" | "entrelinha" | "cor">> = {
  titulo: { texto: "Adicione um título", fonte: "Poppins", peso: 600, tamanho: 76, entrelinha: 1.1, cor: "#2F646A" },
  subtitulo: { texto: "Adicione um subtítulo", fonte: "Poppins", peso: 500, tamanho: 48, entrelinha: 1.2, cor: "#414141" },
  corpo: { texto: "Adicione um pouco de texto", fonte: "Poppins", peso: 400, tamanho: 34, entrelinha: 1.35, cor: "#414141" },
  display: { texto: "Título de destaque", fonte: "Playfair Display", peso: 500, tamanho: 104, entrelinha: 1.05, cor: "#2F646A" },
};

export function novoTexto(formato: Formato, preset: PresetDeTexto): Camada {
  const { largura, altura } = FORMATOS[formato];
  const MARGEM = 80;

  return { id: novoId(), tipo: "texto", alinhamento: "esquerda", x: MARGEM, y: Math.round(altura * 0.4), largura: largura - 2 * MARGEM, ...PRESETS[preset] };
}

export type ElementoNovo = "faixa" | "retangulo" | "logo-cor" | "logo-branca";

export function novoElemento(formato: Formato, elemento: ElementoNovo): Camada {
  const { largura, altura } = FORMATOS[formato];
  const LARGURA_DO_LOGO = 200;
  const LADO = 400;
  const logo = (variante: "cor" | "branca"): Camada => ({
    id: novoId(),
    tipo: "logo",
    variante,
    x: largura - 64 - LARGURA_DO_LOGO,
    y: Math.round(altura - (formato === "story" ? 360 : 64) - LARGURA_DO_LOGO * PROPORCAO_DO_LOGO),
    largura: LARGURA_DO_LOGO,
  });

  switch (elemento) {
    case "faixa":
      return { id: novoId(), tipo: "forma", cor: "#2F646A", x: 0, y: altura - 320, largura, altura: 320, raio: 0 };
    case "retangulo":
      return { id: novoId(), tipo: "forma", cor: "#63B5AF", x: (largura - LADO) / 2, y: Math.round((altura - LADO) / 2), largura: LADO, altura: LADO, raio: 12 };
    case "logo-cor":
      return logo("cor");
    case "logo-branca":
      return logo("branca");
  }
}
