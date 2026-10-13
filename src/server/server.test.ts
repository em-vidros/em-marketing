import { afterAll, describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { abrirConversaDoUsuario } from "../agent/conversas";
import { db } from "../db";
import { rotas } from "./rotas";

/** Modelo que falha o teste se for chamado: nenhuma destas rotas deve chegar ao bot. */
const semModelo = new MockLanguageModelV4({
  doStream: async () => {
    throw new Error("o modelo não deveria rodar");
  },
});

const server = Bun.serve({ port: 0, routes: rotas({ resolverModelo: () => semModelo }) });
afterAll(() => server.stop(true));

const ORIGEM = process.env.BETTER_AUTH_URL!;
const url = (caminho: string) => new URL(caminho, server.url);

async function cadastrar(email: string) {
  return fetch(url("/api/auth/sign-up/email"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGEM },
    body: JSON.stringify({ email, password: "senha-longa-123", name: email.split("@")[0] }),
  });
}

async function entrar(email: string): Promise<string> {
  const res = await cadastrar(email);
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const pedidoDeChat = (id: string) =>
  JSON.stringify({ id, botId: "chefe", trigger: "submit-message", messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Oi" }] }] });

describe("servidor", () => {
  test("cadastro com e-mail fora de ALLOWED_EMAILS é recusado e não cria usuário", async () => {
    const res = await cadastrar("intruso@gmail.com");

    expect(res.status).toBe(403);
    expect(db.query("SELECT 1 FROM user WHERE email = ?").get("intruso@gmail.com")).toBeNull();
  });

  test("POST /api/chat sem sessão devolve 401", async () => {
    const res = await fetch(url("/api/chat"), { method: "POST", headers: { "content-type": "application/json" }, body: pedidoDeChat("c-anon") });

    expect(res.status).toBe(401);
  });

  test("um usuário não lê nem continua a conversa de outro", async () => {
    await entrar("ana@emvidros.com.br");
    const deBia = await entrar("bia@emvidros.com.br");
    const ana = db.query("SELECT id FROM user WHERE email = ?").get("ana@emvidros.com.br") as { id: string };
    abrirConversaDoUsuario(ana.id, "conversa-da-ana", "chefe", "Post do Dia do Vidraceiro");

    const leitura = await fetch(url("/api/conversas/conversa-da-ana"), { headers: { cookie: deBia } });
    const chat = await fetch(url("/api/chat"), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deBia },
      body: pedidoDeChat("conversa-da-ana"),
    });

    expect([leitura.status, chat.status]).toEqual([404, 404]);
    const dono = db.query("SELECT user_id, mensagens FROM conversas WHERE id = ?").get("conversa-da-ana");
    expect(dono).toEqual({ user_id: ana.id, mensagens: "[]" });
  });
});
