import { useEffect, useSyncExternalStore } from "react";
import { pegar, type Carga, type ReferenciaDaApi } from "../../api";

/**
 * As referências ativas da Biblioteca, lidas uma vez para a conversa inteira: o seletor lista, cada imagem do pedido
 * sabe se já está guardada, e a imagem aberta sabe se ainda dá para ver na Biblioteca. Quem muda a Biblioteca relê.
 */
let carga: Carga<ReferenciaDaApi[]> = { estado: "carregando" };
let pedido: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

const avisar = () => ouvintes.forEach((o) => o());

/** O servidor sem resposta em 15 s vira falha com Tentar de novo, em vez de esqueleto para sempre. */
const ESPERA = 15_000;

export function recarregarBiblioteca(): Promise<void> {
  if (carga.estado === "erro") {
    carga = { estado: "carregando" };
    avisar();
  }
  pedido = pegar<ReferenciaDaApi[]>("/api/referencias", AbortSignal.timeout(ESPERA))
    .then((dados) => void (carga = { estado: "pronto", dados }))
    .catch((erro: Error) => {
      const demorou = erro.name === "TimeoutError" ? new Error("O servidor demorou mais de 15 segundos para responder.") : erro;
      if (carga.estado !== "pronto") carga = { estado: "erro", erro: demorou };
    })
    .finally(avisar);
  return pedido;
}

export function useBiblioteca(): Carga<ReferenciaDaApi[]> {
  useEffect(() => void (pedido ?? recarregarBiblioteca()), []);
  return useSyncExternalStore(
    (o) => (ouvintes.add(o), () => ouvintes.delete(o)),
    () => carga,
  );
}

/** A referência ativa que guarda este arquivo: a imagem do pedido que alguém já guardou. */
export const naBiblioteca = (c: Carga<ReferenciaDaApi[]>, arquivo: string) => (c.estado === "pronto" ? c.dados.find((r) => r.arquivo === arquivo) : undefined);
