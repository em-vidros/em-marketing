import { expect, test } from "bun:test";
import type { Mensagem, Parte } from "../tipos";
import { aprovacoesPendentes } from "./CartaoAprovacao";

const aprovacao = (id: string, state: string, extra: object = {}) =>
  ({
    type: "tool-publicar_agora",
    toolCallId: `c-${id}`,
    state,
    input: { media_type: "IMAGE" },
    approval: { id },
    ...extra,
  }) as Parte;

const conversa: Mensagem[] = [
  {
    id: "m1",
    role: "assistant",
    parts: [
      aprovacao("recusada", "output-denied", { approval: { id: "recusada", approved: false } }),
      aprovacao("respondida", "approval-responded", { approval: { id: "respondida", approved: true } }),
      aprovacao("clicada", "approval-requested"),
      aprovacao("aberta", "approval-requested"),
    ],
  },
];

/** A e R só agem num pedido aberto: um segundo A não publica de novo, e o já respondido deixa a tecla passar. */
test("só o pedido sem resposta, do servidor ou desta tela, aceita A ou R", () => {
  expect(aprovacoesPendentes(conversa, new Set(["clicada"]))).toEqual(["aberta"]);
  expect(aprovacoesPendentes(conversa, new Set(["clicada", "aberta"]))).toEqual([]);
});
