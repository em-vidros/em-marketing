import { useReducer, useRef } from "react";
import { MAXIMO_COLADAS, MAXIMO_MARCADAS } from "../../../agent/limitesDoPedido";
import type { DadosDaEscolha } from "../../../agent/pedido";
import { apiImagensDoPedido, type ReferenciaDaApi } from "../../api";
import { mostrarAviso } from "../menu/Avisos";

/** Os mesmos limites de POST /api/arquivos, checados antes para o aviso sair na hora. */
export const ACEITOS = ["image/png", "image/jpeg", "image/webp"];
const MAXIMO_BYTES = 10 * 1024 * 1024;

/** Uma imagem do pedido no composer. A mensagem só sai quando todas estão prontas. */
export type Colada = { id: number; arquivo: File; previa: string } & (
  | { estado: "subindo" }
  | { estado: "pronta"; chave: string }
  | { estado: "falhou"; erro: string }
);

/** O que a pessoa escolheu para a próxima mensagem: referências marcadas da Biblioteca e imagens do pedido. */
export interface Escolha {
  marcadas: readonly ReferenciaDaApi[];
  coladas: readonly Colada[];
}

type Acao =
  | { tipo: "alternar"; referencia: ReferenciaDaApi }
  | { tipo: "colar"; coladas: Colada[] }
  | { tipo: "subindo"; id: number }
  | { tipo: "subiu"; id: number; chave: string }
  | { tipo: "falhou"; id: number; erro: string }
  | { tipo: "tirar"; id: number }
  | { tipo: "limpar" };

const VAZIA: Escolha = { marcadas: [], coladas: [] };

function trocar(coladas: readonly Colada[], id: number, nova: (c: Colada) => Colada): Colada[] {
  return coladas.map((c) => (c.id === id ? nova(c) : c));
}

export function reduzir(e: Escolha, a: Acao): Escolha {
  switch (a.tipo) {
    case "alternar": {
      const marcada = e.marcadas.some((r) => r.id === a.referencia.id);
      if (marcada) return { ...e, marcadas: e.marcadas.filter((r) => r.id !== a.referencia.id) };
      return e.marcadas.length < MAXIMO_MARCADAS ? { ...e, marcadas: [...e.marcadas, a.referencia] } : e;
    }
    case "colar":
      return { ...e, coladas: [...e.coladas, ...a.coladas] };
    case "subindo":
      return { ...e, coladas: trocar(e.coladas, a.id, (c) => ({ id: c.id, arquivo: c.arquivo, previa: c.previa, estado: "subindo" })) };
    case "subiu":
      return { ...e, coladas: trocar(e.coladas, a.id, (c) => ({ id: c.id, arquivo: c.arquivo, previa: c.previa, estado: "pronta", chave: a.chave })) };
    case "falhou":
      return { ...e, coladas: trocar(e.coladas, a.id, (c) => ({ id: c.id, arquivo: c.arquivo, previa: c.previa, estado: "falhou", erro: a.erro })) };
    case "tirar":
      return { ...e, coladas: e.coladas.filter((c) => c.id !== a.id) };
    case "limpar":
      return VAZIA;
  }
}

/** Separa o que entra na fila do que fica de fora, com o aviso de cada recusa. Cabe quem chegou primeiro. */
export function triar(arquivos: readonly File[], vagas: number): { aceitos: File[]; avisos: string[] } {
  const aceitos: File[] = [];
  const avisos: string[] = [];
  let sobraram = 0;
  for (const arquivo of arquivos) {
    const nome = arquivo.name || "A imagem";
    if (!ACEITOS.includes(arquivo.type)) avisos.push(`${nome} não entrou: a imagem precisa ser PNG, JPEG ou WebP.`);
    else if (arquivo.size > MAXIMO_BYTES) avisos.push(`${nome} não entrou: passa de 10 MB.`);
    else if (aceitos.length < vagas) aceitos.push(arquivo);
    else sobraram++;
  }
  const quais = sobraram === 1 ? "A quarta não entrou" : `${sobraram} não entraram`;
  if (sobraram) avisos.push(`Só ${MAXIMO_COLADAS} imagens por pedido. ${quais}; tire uma da fila para trocar.`);
  return { aceitos, avisos };
}

/** Por que a mensagem ainda não sai: uma imagem subindo ou uma que não subiu. */
export type Espera = "subindo" | "falhou" | null;

export const esperaDe = (e: Escolha): Espera =>
  e.coladas.some((c) => c.estado === "falhou") ? "falhou" : e.coladas.some((c) => c.estado === "subindo") ? "subindo" : null;

/** A parte data-referencias da mensagem, ou null sem escolha. Só sai com todas as imagens prontas. */
export function dadosDa(e: Escolha): DadosDaEscolha | null {
  const coladas = e.coladas.flatMap((c) => (c.estado === "pronta" ? [c.chave] : []));
  if (!e.marcadas.length && !coladas.length) return null;
  return { marcadas: e.marcadas.map((r) => r.id), coladas };
}

/** A escolha do composer de uma conversa: marcar, colar, subir, tentar de novo, tirar e limpar depois de enviar. */
export function useEscolha() {
  const [escolha, despachar] = useReducer(reduzir, VAZIA);
  const proxima = useRef(0);
  const atual = useRef(escolha);
  atual.current = escolha;

  function subir(id: number, arquivo: File) {
    despachar({ tipo: "subindo", id });
    apiImagensDoPedido
      .subir(arquivo)
      .then(({ chave }) => despachar({ tipo: "subiu", id, chave }))
      .catch((e: Error) => despachar({ tipo: "falhou", id, erro: e.message }));
  }

  function colar(arquivos: readonly File[]) {
    const { aceitos, avisos } = triar(arquivos, MAXIMO_COLADAS - atual.current.coladas.length);
    for (const texto of avisos) mostrarAviso({ tipo: "erro", texto });
    const novas: Colada[] = aceitos.map((arquivo) => ({ id: proxima.current++, arquivo, previa: URL.createObjectURL(arquivo), estado: "subindo" }));
    if (!novas.length) return;
    despachar({ tipo: "colar", coladas: novas });
    for (const c of novas) subir(c.id, c.arquivo);
  }

  function tirar(id: number) {
    const c = atual.current.coladas.find((x) => x.id === id);
    if (c) URL.revokeObjectURL(c.previa);
    despachar({ tipo: "tirar", id });
  }

  function limpar() {
    for (const c of atual.current.coladas) URL.revokeObjectURL(c.previa);
    despachar({ tipo: "limpar" });
  }

  return {
    escolha,
    espera: esperaDe(escolha),
    alternar: (referencia: ReferenciaDaApi) => despachar({ tipo: "alternar", referencia }),
    colar,
    tirar,
    tentar: () => atual.current.coladas.forEach((c) => c.estado === "falhou" && subir(c.id, c.arquivo)),
    limpar,
  };
}

export type ControleDaEscolha = ReturnType<typeof useEscolha>;
