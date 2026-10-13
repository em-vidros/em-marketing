import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ConfigBot } from "../agent/config";
import { BOT_IDS, BOTS, type BotId } from "./bots";
import type { ApiConversas } from "./componentes/menu/conversas";
import { navegar } from "./rota";
import type { Conversa } from "./tipos";

export class ErroDeApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

async function pedir(caminho: string, init: RequestInit): Promise<Response> {
  const res = await fetch(caminho, { ...init, headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  if (res.status === 401) navegar("/entrar", { substituir: true });
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroDeApi(res.status, corpo?.erro ?? `Erro ${res.status}`);
  }
  return res;
}

/** GET numa rota do nosso servidor. 401 manda para /entrar; os tipos vêm do servidor, então não reparseia. */
export async function pegar<T>(caminho: string, sinal?: AbortSignal): Promise<T> {
  return (await pedir(caminho, { signal: sinal })).json() as Promise<T>;
}

/** As rotas de gestão de conversa (PATCH, DELETE, restaurar). */
export const apiConversas: ApiConversas = {
  listar: (arquivadas) => pegar<Conversa[]>(arquivadas ? "/api/conversas?arquivadas=1" : "/api/conversas"),
  mudar: async (id, mudanca) =>
    (await pedir(`/api/conversas/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(mudanca) })).json() as Promise<Conversa>,
  apagar: async (id) => void (await pedir(`/api/conversas/${encodeURIComponent(id)}`, { method: "DELETE" })),
  restaurar: async (id) => (await pedir(`/api/conversas/${encodeURIComponent(id)}/restaurar`, { method: "POST" })).json() as Promise<Conversa>,
};

export type Carga<T> = { estado: "carregando" } | { estado: "pronto"; dados: T } | { estado: "erro"; erro: ErroDeApi | Error };

/**
 * Lê uma rota e, com `intervalo`, relê enquanto a aba está visível. `recarregar` relê na hora.
 * Uma releitura que falha mantém os últimos dados na tela.
 */
export function useApi<T>(caminho: string | null, intervalo?: number) {
  const [carga, setCarga] = useState<Carga<T>>({ estado: "carregando" });
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    if (!caminho) return;
    // Tentar de novo depois de um erro mostra o carregando outra vez.
    setCarga((c) => (c.estado === "erro" ? { estado: "carregando" } : c));
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const buscar = () =>
      pegar<T>(caminho, ctl.signal)
        .then((dados) => setCarga({ estado: "pronto", dados }))
        .catch((erro: Error) => {
          if (erro.name !== "AbortError") setCarga((c) => (c.estado === "pronto" ? c : { estado: "erro", erro }));
        })
        .finally(agendar);
    const agendar = () => {
      if (intervalo && !ctl.signal.aborted) timer = setTimeout(() => (document.hidden ? agendar() : buscar()), intervalo);
    };
    buscar();
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [caminho, intervalo, versao]);

  return [carga, recarregar] as const;
}

/** Nome e descrição em vigor de cada bot. O usuário pode trocá-los; a forma e a cor ficam no código. */
export type NomesDosBots = Record<BotId, { nome: string; descricao: string }>;

const PADRAO = Object.fromEntries(BOT_IDS.map((id) => [id, { nome: BOTS[id].nome, descricao: BOTS[id].papel }])) as NomesDosBots;

let nomes: NomesDosBots = PADRAO;
let pedido: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

/** Relê GET /api/bots. Quem grava a config de um bot chama isto para a barra e a paleta mostrarem o nome novo. */
export function recarregarBots(): Promise<void> {
  pedido = pegar<ConfigBot[]>("/api/bots")
    .then((lista) => {
      nomes = { ...PADRAO, ...Object.fromEntries(lista.map((b) => [b.id, { nome: b.nome, descricao: b.descricao }])) };
      for (const o of ouvintes) o();
    })
    .catch(() => {});
  return pedido;
}

export function useNomesDosBots(): NomesDosBots {
  useEffect(() => void (pedido ?? recarregarBots()), []);
  return useSyncExternalStore(
    (o) => (ouvintes.add(o), () => ouvintes.delete(o)),
    () => nomes,
  );
}
