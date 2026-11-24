import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { corpoAssinadoPeloHub } from "../mcp/permissao";
import { auth, ehDaEmpresa } from "./auth";

/** O prefixo entra só na assinatura: o bilhete não vale como o token Bearer do MCP, nem o token como bilhete. */
const USO_DO_BILHETE = "em-hub/entrada.";
const COOKIE_DO_ESTADO = "hub_estado";
const VALIDADE_DO_ESTADO_S = 600;

export interface Hub {
  url: string;
  app: string;
  chavePublica: string;
}

/** O interruptor do login pelo EM Hub. Faltando qualquer uma das três, a tela de entrar é a de sempre. */
export function hubDoAmbiente(env: Record<string, string | undefined> = process.env): Hub | null {
  const { HUB_URL: url, HUB_APP_ID: app, HUB_CHAVE_PUBLICA: chavePublica } = env;
  return url && app && chavePublica ? { url, app, chavePublica } : null;
}

const Bilhete = z.object({ app: z.string(), email: z.string(), nome: z.string(), estado: z.string(), exp: z.number() });
export type Bilhete = z.infer<typeof Bilhete>;

export type Leitura = { ok: true; bilhete: Bilhete } | { ok: false; motivo: "invalido" | "outro-app" | "vencido" | "outro-estado" };

export function lerBilhete(token: string, esperado: { chavePublica: string; app: string; estado: string }, agora = Date.now()): Leitura {
  const lido = Bilhete.safeParse(corpoAssinadoPeloHub(token, esperado.chavePublica, USO_DO_BILHETE));
  if (!lido.success) return { ok: false, motivo: "invalido" };
  const bilhete = lido.data;
  if (bilhete.app !== esperado.app) return { ok: false, motivo: "outro-app" };
  if (bilhete.exp * 1000 <= agora) return { ok: false, motivo: "vencido" };
  if (!iguais(bilhete.estado, esperado.estado)) return { ok: false, motivo: "outro-estado" };
  return { ok: true, bilhete };
}

const iguais = (a: string, b: string) => a.length > 0 && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Só caminho deste site. O parser de URL é o mesmo do navegador, então `//`, `/\` e tab no meio não escapam. */
export function voltaSegura(volta: string | null | undefined): string {
  if (!volta?.startsWith("/")) return "/";
  const base = "http://em-marketing.invalid";
  const url = new URL(volta, base);
  return url.origin === base ? url.pathname + url.search + url.hash : "/";
}

/** GET /api/entrar: guarda o estado e a volta e manda a pessoa ao Hub, que devolve o bilhete por POST. */
export function iniciarEntrada(req: Request, hub = hubDoAmbiente()): Response {
  if (!hub) return redirecionar("/entrar");
  const estado = randomBytes(32).toString("base64url");
  const volta = voltaSegura(new URL(req.url).searchParams.get("volta"));
  const destino = new URL(`/api/apps/${encodeURIComponent(hub.app)}/entrar`, hub.url);
  destino.searchParams.set("estado", estado);
  return redirecionar(destino.href, [cookieDoEstado(`${estado}.${Buffer.from(volta).toString("base64url")}`, VALIDADE_DO_ESTADO_S)]);
}

/** POST /api/entrar: o Hub manda `token` num formulário. A sessão aberta é a do better-auth, a mesma do login com Google. */
export async function confirmarEntrada(req: Request, hub = hubDoAmbiente()): Promise<Response> {
  const guardado = estadoGuardado(req);
  const token = (await req.formData().catch(() => null))?.get("token");
  if (!hub || !guardado || typeof token !== "string") return recusar("sem-pedido");

  const leitura = lerBilhete(token, { chavePublica: hub.chavePublica, app: hub.app, estado: guardado.estado });
  if (!leitura.ok) return recusar(leitura.motivo);
  const { email, nome } = leitura.bilhete;
  if (!ehDaEmpresa(email)) return recusar("fora-da-empresa");

  const aberta = await auth.api.abrirSessaoPeloHub({ body: { email, nome }, returnHeaders: true }).catch((erro: unknown) => erro as Error);
  if (aberta instanceof Error) return recusar(`sessao: ${aberta.message}`);
  return redirecionar(voltaSegura(guardado.volta), [cookieDoEstado("", 0), ...aberta.headers.getSetCookie()]);
}

function estadoGuardado(req: Request) {
  const valor = new Bun.CookieMap(req.headers.get("cookie") ?? "").get(COOKIE_DO_ESTADO);
  const [estado, volta] = valor?.split(".") ?? [];
  return estado ? { estado, volta: Buffer.from(volta ?? "", "base64url").toString("utf8") } : null;
}

// SameSite=None porque a volta é um POST vindo do site do Hub, e cookie Lax não viaja nele.
const cookieDoEstado = (valor: string, maxAge: number) =>
  `${COOKIE_DO_ESTADO}=${valor}; Path=/api/entrar; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;

function redirecionar(destino: string, cookies: string[] = []) {
  const headers = new Headers({ location: destino, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** Volta para a tela de entrar com o Google, que não redireciona ao Hub: um bilhete ruim não vira laço. */
function recusar(motivo: string) {
  console.warn(`entrada pelo EM Hub recusada: ${motivo}`);
  return redirecionar("/entrar/google?error=hub", [cookieDoEstado("", 0)]);
}
