import { ErroDeApi } from "../../api";
import { navegar } from "../../rota";

/** PUT, POST ou DELETE com JSON. O erro traz o {erro} do servidor, já em português. Um 204 devolve undefined. */
export async function enviar<T>(caminho: string, metodo: "PUT" | "POST" | "DELETE", corpo?: unknown): Promise<T> {
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
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}
