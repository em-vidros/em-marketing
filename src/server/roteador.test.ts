import { describe, expect, test } from "bun:test";
import { roteador } from "./roteador";

const corpo = (r: Response | Promise<Response>) => Promise.resolve(r).then((x) => x.text());
const ok = (nome: string) => (req: Request) => new Response(`${nome} ${JSON.stringify((req as Request & { params?: object }).params ?? {})}`);

describe("roteador", () => {
  const rotear = roteador({
    "/api/*": ok("curinga"),
    "/api/conversas/:id": { GET: ok("conversa"), DELETE: ok("apagar") },
    "/api/conversas/:id/restaurar": { POST: ok("restaurar") },
    "/api/conversas": { GET: ok("lista") },
    "/logo/x.svg": Bun.file("package.json"),
  });
  const pedir = (caminho: string, method = "GET") => corpo(rotear(new Request(`http://x${caminho}`, { method })));

  test("o caminho exato vence o parâmetro, que vence o curinga, como no Bun.serve", async () => {
    expect(await pedir("/api/conversas")).toBe("lista {}");
    expect(await pedir("/api/conversas/abc")).toBe('conversa {"id":"abc"}');
    expect(await pedir("/api/conversas/abc/restaurar", "POST")).toBe('restaurar {"id":"abc"}');
    expect(await pedir("/api/outra")).toBe("curinga {}");
  });

  test("método sem manipulador dá 405 e caminho desconhecido dá 404", async () => {
    expect((await rotear(new Request("http://x/api/conversas/abc", { method: "PUT" }))).status).toBe(405);
    expect((await rotear(new Request("http://x/logo/x.svg"))).status).toBe(404);
  });
});
