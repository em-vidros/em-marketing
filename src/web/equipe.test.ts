import { expect, test } from "bun:test";
import { BOT_IDS, BOTS } from "./bots";
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

/** O Post renomeado: o texto do Chefe usa o nome em vigor, não o do código. */
const NOMES = { ...Object.fromEntries(BOT_IDS.map((id) => [id, { nome: BOTS[id].nome }])), post: { nome: "Designer" } } as Record<(typeof BOT_IDS)[number], { nome: string }>;

const doChefe = (...parts: Parte[]): Mensagem[] => [{ id: "m1", role: "assistant", parts }];

/** O ponto âmbar do avatar sai de tipo "esperando"; ele quer dizer só "esperando você". */
test.each([
  { caso: "esperando um especialista", parts: [delegacaoEmAndamento], ponto: false, texto: "Esperando Designer" },
  { caso: "com aprovação pendente", parts: [delegacaoEmAndamento, aprovacaoPendente], ponto: true, texto: "Esperando você" },
])("o Chefe $caso", ({ parts, ponto, texto }) => {
  const { chefe } = estadosDaEquipe([], doChefe(...parts), true, NOMES);

  expect({ ponto: chefe.tipo === "esperando", texto: chefe.texto }).toEqual({ ponto, texto });
});

const doUsuario: Mensagem = { id: "u1", role: "user", parts: [{ type: "text", text: "O que está agendado?" }] };
const respostaAnterior: Mensagem = { id: "m0", role: "assistant", parts: [{ type: "text", text: "Pronto.", state: "done" }] };

/** O texto do Chefe acompanha o stream: pensando antes da primeira parte, escrevendo, usando uma tool. */
test.each([
  { caso: "logo depois do envio, com uma resposta anterior na conversa", mensagens: [respostaAnterior, doUsuario], texto: "Pensando" },
  {
    caso: "raciocinando",
    mensagens: [doUsuario, ...doChefe({ type: "reasoning", text: "A agenda", state: "streaming" } as Parte)],
    texto: "Pensando",
  },
  { caso: "escrevendo", mensagens: [doUsuario, ...doChefe({ type: "text", text: "Tem", state: "streaming" } as Parte)], texto: "Escrevendo" },
  {
    caso: "usando uma tool",
    mensagens: [doUsuario, ...doChefe({ type: "tool-listar_agenda", toolCallId: "l1", state: "input-available", input: {} } as Parte)],
    texto: "Lendo a agenda",
  },
  {
    caso: "entre um passo e outro",
    mensagens: [
      doUsuario,
      ...doChefe({ type: "tool-listar_agenda", toolCallId: "l1", state: "output-available", input: {}, output: { fila: [] } } as Parte),
    ],
    texto: "Pensando",
  },
])("o Chefe no ar, $caso", ({ mensagens, texto }) => {
  const { chefe } = estadosDaEquipe([], mensagens, true, NOMES);

  expect(chefe).toEqual({ tipo: "trabalhando", texto });
});
