import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "meta-"));
process.env.IG_CREDENCIAIS_ARQUIVO = join(dir, "instagram.json");
const { concluirLogin, urlDeLogin } = await import("./meta-login");

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.META_APP_ID = "123";
  process.env.META_APP_SECRET = "segredo";
  process.env.META_CONFIG_ID = "456";
  delete process.env.PUBLIC_BASE_URL;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("o link de login leva app, configuração, callback e state", () => {
  const url = new URL(urlDeLogin("http://localhost:3000", "abc"));
  expect(url.origin + url.pathname).toBe("https://www.facebook.com/v23.0/dialog/oauth");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    client_id: "123",
    config_id: "456",
    redirect_uri: "http://localhost:3000/auth/meta/callback",
    response_type: "code",
    state: "abc",
  });
});

test("o login grava o Page token da página que tem Instagram", async () => {
  globalThis.fetch = (async (entrada: string | URL | Request) => {
    const url = new URL(String(entrada));
    const corpo =
      url.pathname.endsWith("/oauth/access_token")
        ? { access_token: url.searchParams.get("fb_exchange_token") ? "longo" : "curto" }
        : {
            data: [
              { name: "Outra página", access_token: "x" },
              { name: "EM Vidros", access_token: "page-token", instagram_business_account: { id: "ig-1" } },
            ],
          };
    return Response.json(corpo);
  }) as typeof fetch;

  const salvas = await concluirLogin("codigo", "http://localhost:3000");
  expect(salvas).toEqual({ igUserId: "ig-1", pageToken: "page-token", pagina: "EM Vidros" });
  expect(JSON.parse(readFileSync(process.env.IG_CREDENCIAIS_ARQUIVO!, "utf8"))).toEqual(salvas);
});

test("sem página com Instagram, o login falha com a causa", async () => {
  globalThis.fetch = (async (entrada: string | URL | Request) =>
    Response.json(String(entrada).includes("me/accounts") ? { data: [{ name: "Só página", access_token: "x" }] } : { access_token: "t" })) as typeof fetch;
  await expect(concluirLogin("codigo", "http://localhost:3000")).rejects.toThrow("Nenhuma página com Instagram");
});
