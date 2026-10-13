import { useCallback, useEffect, useState } from "react";
import { navegar } from "./rota";

export class ErroDeApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** GET numa rota do nosso servidor. 401 manda para /entrar; os tipos vêm do servidor, então não reparseia. */
export async function pegar<T>(caminho: string, sinal?: AbortSignal): Promise<T> {
  const res = await fetch(caminho, { signal: sinal, headers: { accept: "application/json" } });
  if (res.status === 401) navegar("/entrar", { substituir: true });
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroDeApi(res.status, corpo?.erro ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

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
