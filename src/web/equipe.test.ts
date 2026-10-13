import { expect, test } from "bun:test";
import { estadosDaEquipe } from "./equipe";
import type { Mensagem, Parte } from "./tipos";

const delegacaoEmAndamento = {
  type: "tool-delegar_post",
  toolCallId: "d1",
  state: "output-available",
  preliminary: true,
  input: { pedido: "Gere as 3 artes." },
  output: { tarefaId: "t1", status: "trabalhando", mensagem: null },
} as Parte;

const aprovacaoPendente = {
  type: "tool-agendar_publicacao",
  toolCallId: "a1",
  state: "approval-requested",
  input: { publish_at: "2026-10-15T18:00:00-03:00", media_type: "IMAGE" },
  approval: { id: "ap1" },
} as Parte;

const doChefe = (...parts: Parte[]): Mensagem[] => [{ id: "m1", role: "assistant", parts }];

/** O ponto âmbar do avatar sai de tipo "esperando"; ele quer dizer só "esperando você". */
test.each([
  { caso: "esperando um especialista", parts: [delegacaoEmAndamento], ponto: false, texto: "Esperando o Post" },
  { caso: "com aprovação pendente", parts: [delegacaoEmAndamento, aprovacaoPendente], ponto: true, texto: "Esperando você" },
])("o Chefe $caso", ({ parts, ponto, texto }) => {
  const { chefe } = estadosDaEquipe([], doChefe(...parts), true);

  expect({ ponto: chefe.tipo === "esperando", texto: chefe.texto }).toEqual({ ponto, texto });
});
