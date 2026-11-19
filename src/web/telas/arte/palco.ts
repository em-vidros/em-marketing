import { Box, Canvas, Image, Rect, Text, type IGroup, type ITextAlign, type IUI, type IUIInputData } from "leafer-ui";
import { FORMATOS, PROPORCAO_DO_LOGO, recorteDaCena, transformacaoDa, type Ajustes, type Camada, type Formato } from "../../../v2/camadas";
import type { Guia } from "./reguas";
import { deslocamentoDaFonte } from "./recursos";

/**
 * A arte montada no Leafer: um quadro que corta o que sai da arte, a cena tratada no fundo e um nó por camada, em px da arte.
 * Cada guia vira uma linha invisível dentro do quadro, só para o ímã do arraste achar a guia como acha as bordas.
 */
export interface Montagem {
  quadro: Box;
  cena: Canvas;
  nos: Map<string, IUI>;
  guias: Rect[];
  formato: Formato;
}

const ALINHAMENTO: Record<Extract<Camada, { tipo: "texto" }>["alinhamento"], ITextAlign> = { esquerda: "left", centro: "center", direita: "right" };

const LOGO = { cor: "/logo/emvidros-oficial.svg", branca: "/logo/emvidros-branca.svg" } as const;

export function montar(alvo: IGroup, formato: Formato): Montagem {
  const { largura, altura } = FORMATOS[formato];
  const quadro = new Box({ width: largura, height: altura, overflow: "hide", fill: "#F0EFEA" });
  const cena = new Canvas({ width: largura, height: altura, pixelRatio: 1, hittable: false });

  quadro.add(cena);
  alvo.add(quadro);

  return { quadro, cena, nos: new Map(), guias: [], formato };
}

export function sincronizarGuias(montagem: Montagem, guias: Guia[]) {
  const { largura, altura } = FORMATOS[montagem.formato];
  for (const linha of montagem.guias) linha.destroy();
  montagem.guias = guias.map((guia) => {
    const vertical = guia.orientacao === "vertical";
    const linha = new Rect({ x: vertical ? guia.posicao : 0, y: vertical ? 0 : guia.posicao, width: vertical ? 0 : largura, height: vertical ? altura : 0, hittable: false });
    montagem.quadro.add(linha);

    return linha;
  });
}

export function sincronizar(montagem: Montagem, camadas: Camada[]) {
  const vivas = new Set(camadas.map((c) => c.id));
  for (const [id, no] of montagem.nos) {
    if (vivas.has(id)) continue;
    no.destroy();
    montagem.nos.delete(id);
  }

  camadas.forEach((camada, indice) => {
    const existente = montagem.nos.get(camada.id);
    const no = existente && existente.tag === TAG[camada.tipo] ? existente : trocarNo(montagem, camada, existente);
    no.set({ ...atributosDa(camada), zIndex: indice + 1 });
  });
}

/** Desenha a cena enquadrada e com os ajustes, com os mesmos filtros CSS que o render do servidor reproduz no sharp. */
export function desenharCena({ cena, formato }: Montagem, imagem: HTMLImageElement, ajustes: Ajustes) {
  const { largura, altura } = FORMATOS[formato];
  const margem = Math.ceil(ajustes.desfoque * 3);
  const enquadrada = enquadrar(imagem, ajustes, largura + 2 * margem, altura + 2 * margem, margem);
  const contexto = cena.context;

  contexto.save();
  contexto.clearRect(0, 0, largura, altura);
  contexto.filter = `brightness(${ajustes.brilho}) contrast(${ajustes.contraste}) saturate(${ajustes.saturacao}) blur(${ajustes.desfoque}px)`;
  contexto.drawImage(enquadrada, -margem, -margem);
  contexto.restore();

  cena.paint();
}

const TAG = { texto: "Text", logo: "Image", imagem: "Image", forma: "Rect" } as const;

function trocarNo(montagem: Montagem, camada: Camada, antigo: IUI | undefined): IUI {
  antigo?.destroy();
  const no = criarNo(camada);
  montagem.nos.set(camada.id, no);
  montagem.quadro.add(no);

  return no;
}

function criarNo(camada: Camada): IUI {
  const comum = { id: camada.id, origin: "center" as const, editable: true };
  switch (camada.tipo) {
    case "texto":
      return new Text(comum);
    case "logo":
    case "imagem":
      return new Image(comum);
    case "forma":
      return new Rect(comum);
  }
}

/** O giro é em torno do centro (origin "center"), então x e y seguem sendo o canto da caixa sem giro, como no CSS do render. */
function atributosDa(camada: Camada): IUIInputData {
  const { rotacao, opacidade } = transformacaoDa(camada);
  const solta = !camada.bloqueada;
  const editConfig = { lockRatio: camada.tipo === "logo" || camada.tipo === "imagem", moveable: solta, resizeable: solta, rotateable: solta, preventEditInner: !solta };

  return { x: camada.x, y: camada.y, rotation: rotacao, opacity: opacidade, scaleX: 1, scaleY: 1, editConfig, ...atributosDoTipo(camada) };
}

function atributosDoTipo(camada: Camada): IUIInputData {
  switch (camada.tipo) {
    case "texto":
      return {
        text: camada.texto,
        fontFamily: camada.fonte,
        fontWeight: camada.peso,
        fontSize: camada.tamanho,
        lineHeight: { type: "percent", value: camada.entrelinha },
        fill: camada.cor,
        textAlign: ALINHAMENTO[camada.alinhamento],
        width: camada.largura,
        height: undefined,
        padding: paddingDoTexto(camada),
      };
    case "logo":
      return { url: LOGO[camada.variante], width: camada.largura, height: camada.largura * PROPORCAO_DO_LOGO };
    case "imagem":
      return { url: `/api/arquivos/${camada.chave}`, width: camada.largura, height: camada.largura * camada.proporcao };
    case "forma":
      return { fill: camada.cor, width: camada.largura, height: camada.altura, cornerRadius: camada.raio };
  }
}

/**
 * O recorte da cena esticado sobre a arte, com `margem` de sobra em volta. O blur do canvas mistura a borda com
 * transparente e escurece os cantos, e o sharp repete o pixel da borda; esticar a imagem por baixo da margem faz o
 * canvas se comportar igual.
 */
function enquadrar(imagem: HTMLImageElement, ajustes: Ajustes, largura: number, altura: number, margem: number): HTMLCanvasElement {
  const tela = Object.assign(document.createElement("canvas"), { width: largura, height: altura });
  const contexto = tela.getContext("2d");
  if (!contexto) return tela;

  const { left, top, width, height } = recorteDaCena(ajustes, imagem.naturalWidth, imagem.naturalHeight);
  contexto.drawImage(imagem, left, top, width, height, 0, 0, largura, altura);
  contexto.drawImage(imagem, left, top, width, height, margem, margem, largura - 2 * margem, altura - 2 * margem);

  return tela;
}

/** Desce só as letras: o topo menos o mesmo embaixo deixa a caixa onde o render põe a dele. */
function paddingDoTexto(camada: Extract<Camada, { tipo: "texto" }>): [number, number, number, number] {
  const deslocamento = deslocamentoDaFonte(camada.fonte, camada.peso) * camada.tamanho;

  return [deslocamento, 0, -deslocamento, 0];
}

export function camadaDoNo(no: IUI, camada: Camada): Camada {
  const medida = (v: number | undefined, escala: number | undefined) => Math.round((v ?? 0) * (escala ?? 1));
  const largura = medida(no.width, no.scaleX);
  const lida = {
    x: Math.round(no.x ?? 0),
    y: Math.round(no.y ?? 0),
    rotacao: Math.round(normalizarGraus(no.rotation ?? 0) * 10) / 10,
    largura,
  };

  switch (camada.tipo) {
    case "texto":
      return { ...camada, ...lida, texto: no instanceof Text && String(no.text).trim() ? String(no.text) : camada.texto };
    case "forma":
      return { ...camada, ...lida, altura: medida(no.height, no.scaleY) };
    case "logo":
    case "imagem":
      return { ...camada, ...lida };
  }
}

const normalizarGraus = (graus: number) => ((((graus + 180) % 360) + 360) % 360) - 180;
