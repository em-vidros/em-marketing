/**
 * Contratos dos quatro papéis de modelo do PRD §3.1 e das portas de efeito.
 *
 * Este diretório é o único da árvore com permissão de importar SDK de modelo ou de
 * dar fetch em host de modelo, e `scripts/verificar/fronteira.ts` confere isso. Uma
 * chave de API que chega ou que quebra custa um arquivo aqui, nunca o sistema.
 */

import type { DirecaoVisual, Formato, Pedido } from "../modelos/tipos";

export interface ContextoMarca {
  brandVersionId: string;
  brandbook: string;
  voz: string;
  tokens: unknown;
  estilos: Record<string, string>;
}

export interface Violacao {
  criterio: string;
  problema: string;
}

export interface Veredito {
  aprovada: boolean;
  score: number;
  violacoes: Violacao[];
}

export interface Artigo {
  titulo: string;
  markdown: string;
  tituloSeo: string;
  descricaoSeo: string;
  slug: string;
  pendencias: string[];
}

export interface DiretorCriativo {
  /** Exatamente três, e `excluir` carrega as direções já recusadas nas rodadas anteriores. */
  direcoes(e: {
    pedido: Pedido;
    marca: ContextoMarca;
    rodada: number;
    excluir?: readonly string[];
  }): Promise<readonly DirecaoVisual[]>;
}

export interface Redator {
  /** `anterior` e `ajuste` chegam quando o Ricardo pede mudança só na legenda (US-6). */
  legenda(e: {
    pedido: Pedido;
    direcao: DirecaoVisual;
    marca: ContextoMarca;
    anterior?: string;
    ajuste?: string;
  }): Promise<string>;
  angulos(e: { tema: string; marca: ContextoMarca }): Promise<readonly { titulo: string; angulo: string }[]>;
  artigo(e: {
    titulo: string;
    angulo: string;
    marca: ContextoMarca;
    fontes: readonly string[];
    ajuste?: string;
  }): Promise<Artigo>;
}

export interface Designer {
  gerar(e: { direcao: DirecaoVisual; formato: Formato; logo: Buffer }): Promise<{ png: Buffer; modelo: string; refId?: string }>;
  /** Edição dirigida: preserva o que a instrução não citou (PRD US-3, §5.2). */
  editar(e: {
    base: Buffer;
    instrucao: string;
    formato: Formato;
    logo: Buffer;
    refId?: string;
  }): Promise<{ png: Buffer; modelo: string; refId?: string }>;
}

export interface DiretorDeArte {
  revisar(e: {
    png: Buffer;
    formato: Formato;
    direcao: DirecaoVisual;
    tema: string;
  }): Promise<Veredito>;
}

export interface PortaTelegram {
  enviarMensagem(chatId: number, texto: string, extra?: Record<string, unknown>): Promise<{ message_id: number }>;
  enviarAlbum(chatId: number, jpegs: readonly Buffer[], caption?: string): Promise<{ message_ids: number[] }>;
  enviarFoto(chatId: number, jpeg: Buffer, extra?: Record<string, unknown>): Promise<{ message_id: number }>;
  /** Mestre sai por aqui e nunca por enviarFoto: foto o Telegram recomprime (US-5). */
  enviarDocumento(
    chatId: number,
    arquivo: Buffer,
    nome: string,
    extra?: Record<string, unknown>,
  ): Promise<{ message_id: number; file_id: string }>;
  obterArquivo(fileId: string): Promise<{ file_path: string }>;
  baixarArquivo(filePath: string): Promise<Buffer>;
  responderCallback(callbackId: string, texto?: string): Promise<void>;
}

export interface PortaLinear {
  criarIssue(e: { titulo: string; descricao: string }): Promise<{ id: string; url: string }>;
  comentar(issueId: string, corpo: string): Promise<void>;
  anexar(issueId: string, bytes: Buffer, nome: string, mediaTipo: string): Promise<{ url: string }>;
  moverEstado(issueId: string, estado: string): Promise<void>;
}

export interface Adaptadores {
  criativo: DiretorCriativo;
  redator: Redator;
  designer: Designer;
  arte: DiretorDeArte;
  telegram: PortaTelegram;
  linear: PortaLinear;
}
