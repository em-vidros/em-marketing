import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { lerToken } from "../mcp/permissao";
import { usuarioDa } from "./auth";
import { confirmarEntrada, iniciarEntrada, lerBilhete, voltaSegura, type Hub } from "./entradaPeloHub";

const doHub = generateKeyPairSync("ed25519");
const deOutro = generateKeyPairSync("ed25519");
const hub: Hub = { url: "https://hub.exemplo", app: "em-marketing", chavePublica: doHub.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
const ESTADO = "estado-guardado-na-ida";
const agora = Date.now();

/** Como o Hub assina: Ed25519 sobre o prefixo de uso mais o corpo. */
function bilhete({ app = hub.app, email = "carla@emvidros.com.br", admin = false, estado = ESTADO, exp = Math.floor(agora / 1000) + 3600, chave = doHub.privateKey as KeyObject, prefixo = "em-hub/entrada." } = {}) {
  const corpo = Buffer.from(JSON.stringify({ app, pessoa: "p-1", nome: "Carla", email, cargo: "Marketing", admin, estado, exp })).toString("base64url");
  return `${corpo}.${sign(null, Buffer.from(prefixo + corpo), chave).toString("base64url")}`;
}

const esperado = { chavePublica: hub.chavePublica, app: hub.app, estado: ESTADO };

describe("lerBilhete", () => {
  test("aceita o bilhete do Hub para este App, dentro da validade e com o estado da ida", () => {
    expect(lerBilhete(bilhete(), esperado, agora)).toMatchObject({ ok: true, bilhete: { email: "carla@emvidros.com.br" } });
  });

  test.each([
    ["assinado com outra chave", bilhete({ chave: deOutro.privateKey }), "invalido"],
    ["o token Bearer que o Hub manda ao /api/mcp", bilhete({ prefixo: "" }), "invalido"],
    ["emitido para outro App", bilhete({ app: "atend" }), "outro-app"],
    ["vencido", bilhete({ exp: Math.floor(agora / 1000) - 1 }), "vencido"],
    ["de outra ida ao Hub", bilhete({ estado: "estado-de-outra-pessoa" }), "outro-estado"],
  ])("recusa o bilhete %s", (_, token, motivo) => {
    expect(lerBilhete(token, esperado, agora)).toEqual({ ok: false, motivo: motivo as never });
  });

  test("o bilhete não abre o /api/mcp como token Bearer", () => {
    expect(lerToken(bilhete(), hub.chavePublica, agora)).toBeNull();
  });
});

describe("voltaSegura", () => {
  test.each([
    ["//mal.exemplo/x", "/"],
    ["/\\mal.exemplo/x", "/"],
    ["/\t/mal.exemplo/x", "/"],
    ["https://mal.exemplo/x", "/"],
    [null, "/"],
    ["/c/abc?aba=config", "/c/abc?aba=config"],
  ])("%p volta para %p", (volta, destino) => {
    expect(voltaSegura(volta)).toBe(destino);
  });
});

const cookies = (res: Response, ...antes: string[]) => [...antes, ...res.headers.getSetCookie().map((c) => c.split(";")[0]!)].filter((c) => !c.endsWith("=")).join("; ");

/** O fluxo inteiro com Request reais: GET inicia, o Hub devolve o bilhete por POST e a sessão abre a rota protegida. */
async function entrarPeloHub(email: string, admin: boolean) {
  const ida = iniciarEntrada(new Request("https://mkt.exemplo/api/entrar?volta=/biblioteca"), hub);
  const destino = new URL(ida.headers.get("location")!);
  expect(destino.origin + destino.pathname).toBe("https://hub.exemplo/api/apps/em-marketing/entrar");
  const estado = destino.searchParams.get("estado")!;

  const form = new URLSearchParams({ token: bilhete({ email, admin, estado }), estado });
  const volta = await confirmarEntrada(new Request("https://mkt.exemplo/api/entrar", { method: "POST", headers: { cookie: cookies(ida) }, body: form }), hub);
  expect([volta.status, volta.headers.get("location")]).toEqual([303, "/biblioteca"]);
  return usuarioDa(new Request("https://mkt.exemplo/api/eu", { headers: { cookie: cookies(volta) } }));
}

describe("entrada pelo EM Hub", () => {
  test.each([
    ["carla@emvidros.com.br", true, false],
    ["ricardo@emvidros.com.br", false, true],
  ])("%s entra, e Admin vem de ADMIN_EMAILS, nunca do campo admin do bilhete (bilhete diz %p)", async (email, adminNoBilhete, admin) => {
    expect(await entrarPeloHub(email, adminNoBilhete)).toMatchObject({ email, admin });
  });

  test("sem o cookie da ida, o bilhete não abre sessão e a pessoa cai no login com Google", async () => {
    const form = new URLSearchParams({ token: bilhete(), estado: ESTADO });
    const res = await confirmarEntrada(new Request("https://mkt.exemplo/api/entrar", { method: "POST", body: form }), hub);
    expect([res.status, res.headers.get("location")]).toEqual([303, "/entrar/google?error=hub"]);
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false);
  });
});
