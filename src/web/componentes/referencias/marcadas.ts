import { useSyncExternalStore } from "react";
import { MAXIMO_MARCADAS } from "../../../agent/limitesDoPedido";
import { apiReferencias, type ReferenciaDaApi } from "../../api";
import { mostrarAviso } from "../menu/Avisos";
import { recarregarBiblioteca } from "./biblioteca";

/**
 * As referências marcadas para o próximo pedido. Moram fora da conversa: marcar na Biblioteca vale no composer
 * do próximo pedido, e a marca fica até a pessoa tirar ou enviar.
 */
let lista: readonly ReferenciaDaApi[] = [];
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((o) => o());

/** Marca ou desmarca; passando de MAXIMO_MARCADAS, a lista volta igual. */
export function alternada(marcadas: readonly ReferenciaDaApi[], r: ReferenciaDaApi): readonly ReferenciaDaApi[] {
  if (marcadas.some((x) => x.id === r.id)) return marcadas.filter((x) => x.id !== r.id);
  return marcadas.length < MAXIMO_MARCADAS ? [...marcadas, r] : marcadas;
}

export function alternarMarcada(r: ReferenciaDaApi) {
  const nova = alternada(lista, r);
  if (nova === lista) return mostrarAviso({ tipo: "erro", texto: `Só ${MAXIMO_MARCADAS} referências por pedido. Tire uma para trocar.` });
  lista = nova;
  avisar();
}

export function limparMarcadas() {
  if (!lista.length) return;
  lista = [];
  avisar();
}

export function useMarcadas(): readonly ReferenciaDaApi[] {
  return useSyncExternalStore(
    (o) => (ouvintes.add(o), () => void ouvintes.delete(o)),
    () => lista,
  );
}

/** Uma imagem da Biblioteca que ainda não é referência vira uma na primeira vez; as próximas só marcam. */
const jaVirou = new Map<string, ReferenciaDaApi>();

export async function usarComoReferencia(url: string, nome: string): Promise<boolean> {
  const antes = jaVirou.get(url);
  if (antes) return alternarMarcada(antes), true;
  try {
    const resposta = await fetch(url);
    if (!resposta.ok) throw new Error("Não deu para abrir a imagem.");
    const blob = await resposta.blob();
    const arquivo = new File([blob], nome, { type: blob.type || "image/png" });
    const criada = await apiReferencias.enviar(arquivo);
    jaVirou.set(url, criada);
    void recarregarBiblioteca();
    alternarMarcada(criada);
    return true;
  } catch (e) {
    mostrarAviso({ tipo: "erro", texto: e instanceof Error ? e.message : "Não deu para usar como referência." });
    return false;
  }
}
