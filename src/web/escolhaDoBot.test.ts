import { Chat } from "@ai-sdk/react";
import { afterEach, expect, test } from "bun:test";
import { criarEscolhaDoBot, criarTransporte } from "./escolhaDoBot";
import type { Mensagem } from "./tipos";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Responde cada POST com um turno vazio e guarda o corpo que o front mandou. */
function servidorFalso() {
  const corpos: { botId: string }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    corpos.push(JSON.parse(String(init?.body)));
    const sse = ['{"type":"start"}', '{"type":"finish"}'].map((d) => `data: ${d}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(sse, { headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
  }) as typeof fetch;
  return corpos;
}

test("a conversa nova vai para o bot escolhido, e a escolha trava na primeira mensagem", async () => {
  const corpos = servidorFalso();
  const escolha = criarEscolhaDoBot("chefe");
  escolha.escolher("post");
  const chat = new Chat<Mensagem>({ id: "c-nova", transport: criarTransporte(escolha) });

  await chat.sendMessage({ text: "Monta um post da fachada" });
  escolha.escolher("agenda");
  await chat.sendMessage({ text: "E a legenda?" });

  expect(corpos.map((c) => c.botId)).toEqual(["post", "post"]);
  expect(escolha.ler()).toBe("post");
});
