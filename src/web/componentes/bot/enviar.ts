import { ErroDeApi } from "../../api";
import { navegar } from "../../rota";

/** PUT ou POST com JSON. O erro traz o {erro} do servidor, já em português. */
export async function enviar<T>(caminho: string, metodo: "PUT" | "POST", corpo?: unknown): Promise<T> {
  const res = await fetch(caminho, {
    method: metodo,
    headers: { accept: "application/json", ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (res.status === 401) navegar("/entrar", { substituir: true });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroDeApi(res.status, json?.erro ?? `O servidor respondeu ${res.status}. Tente de novo.`);
  }
  return res.json() as Promise<T>;
}
