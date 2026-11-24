import { createPublicKey, verify } from "node:crypto";

/** Quem chama pelo EM Hub. O Hub assina cada chamada em nome de uma pessoa (tokenDoApp.ts no em-hub). */
export interface Chamador {
  app: string;
  pessoa: string;
  cargo: string;
  admin: boolean;
  exp: number;
}

/** O id com que o EM Hub registra este App. Token emitido para outro App não entra. */
export const ID_NO_HUB = "em-marketing";

/**
 * O token é `corpo.assinatura`, os dois em base64url, assinado com Ed25519. `chavePublica` é o SPKI DER em base64.
 * O `prefixo` entra só na assinatura e separa os usos da mesma chave do Hub: o token do MCP vai sem prefixo.
 */
export function corpoAssinadoPeloHub(token: string, chavePublica: string, prefixo = ""): unknown {
  const [corpo, assinatura, sobra] = token.split(".");
  if (!corpo || !assinatura || sobra !== undefined) return null;
  try {
    const chave = createPublicKey({ key: Buffer.from(chavePublica, "base64"), format: "der", type: "spki" });
    if (!verify(null, Buffer.from(prefixo + corpo), chave, Buffer.from(assinatura, "base64url"))) return null;
    return JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function lerToken(token: string, chavePublica: string, agora = Date.now()): Chamador | null {
  const chamador = corpoAssinadoPeloHub(token, chavePublica) as Chamador | null;
  return chamador?.app === ID_NO_HUB && chamador.exp * 1000 > agora ? chamador : null;
}

/** Sem HUB_CHAVE_PUBLICA ninguém entra: o MCP não abre por engano. */
export function chamadorDe(pedido: Request): Chamador | null {
  const chave = process.env.HUB_CHAVE_PUBLICA;
  const token = pedido.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token || !chave) return null;
  return lerToken(token, chave);
}
