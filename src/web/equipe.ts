import type { BotId } from "./bots";
import { atividadeDe, textoDa } from "./componentes/ia/atividade";
import { botDaDelegacao, ehAprovacao, ehDelegacao, type Mensagem, type ParteDelegacao, type ResumoTarefa } from "./tipos";

export type EstadoBot =
  | { tipo: "parado"; texto: string }
  | { tipo: "trabalhando"; texto: string }
  /** Esperando você: há uma aprovação pendente. Só este estado ganha o ponto âmbar no avatar. */
  | { tipo: "esperando"; texto: string }
  /** O Chefe esperando um especialista. Sem ponto: quem tem de agir é o bot, não você. */
  | { tipo: "delegando"; texto: string };

/** Por id. Um bot sem entrada está parado. */
export type EstadosDaEquipe = Record<BotId, EstadoBot>;

const PARADO: EstadoBot = { tipo: "parado", texto: "Parado" };

export const estadoDe = (estados: EstadosDaEquipe, id: BotId): EstadoBot => estados[id] ?? PARADO;

/** O nome em vigor de um bot, que o usuário pode trocar na config. */
type NomeDe = (id: BotId) => { nome: string };

/** O que o especialista de uma delegação faz agora, a partir da prévia da mensagem dele. */
export function passoAtual(p: ParteDelegacao): string | null {
  if (p.state !== "output-available") return p.state === "input-streaming" || p.state === "input-available" ? "Na fila" : null;
  const s = p.output;
  if (s.status === "na_fila") return "Na fila";
  if (s.status !== "trabalhando") return null;
  return textoDa(atividadeDe(s.mensagem, true));
}

/**
 * O estado de cada bot, juntando as tarefas ativas do usuário (todas as conversas) com o
 * que está ao vivo na conversa aberta, que tem o passo atual e manda quando os dois falam.
 * `bot` é quem responde a conversa aberta: numa conversa direta com um especialista ou com um bot
 * criado pela equipe, é ele que trabalha, não o Chefe.
 */
export function estadosDaEquipe(
  atividade: readonly ResumoTarefa[],
  mensagens: readonly Mensagem[],
  respondendo: boolean,
  nomeDe: NomeDe,
  bot: BotId = "chefe",
): EstadosDaEquipe {
  const estados: EstadosDaEquipe = {};

  for (const t of [...atividade].reverse()) {
    if (t.status === "trabalhando") estados[t.botId] = { tipo: "trabalhando", texto: "Trabalhando" };
    else if (estadoDe(estados, t.botId).tipo === "parado") estados[t.botId] = { tipo: "parado", texto: "Na fila" };
  }

  // Só a resposta do turno corrente: logo depois do envio, a última mensagem é a do usuário.
  const ultima = mensagens.at(-1)?.role === "assistant" ? mensagens.at(-1) : undefined;
  if (bot !== "chefe") {
    if (respondendo) estados[bot] = { tipo: "trabalhando", texto: textoDa(atividadeDe(ultima, true)) };
    return estados;
  }
  for (const p of ultima?.parts ?? []) {
    if (!ehDelegacao(p)) continue;
    const passo = passoAtual(p);
    const quem = botDaDelegacao(p);
    if (passo && quem) estados[quem] = passo === "Na fila" ? { tipo: "parado", texto: passo } : { tipo: "trabalhando", texto: passo };
  }

  const trabalhando = Object.keys(estados).find((id) => id !== "chefe" && estadoDe(estados, id).tipo === "trabalhando");
  if (ultima?.parts.some((p) => ehAprovacao(p) && p.state === "approval-requested"))
    estados.chefe = { tipo: "esperando", texto: "Esperando você" };
  else if (trabalhando) estados.chefe = { tipo: "delegando", texto: `Esperando ${nomeDe(trabalhando).nome}` };
  else if (respondendo) estados.chefe = { tipo: "trabalhando", texto: textoDa(atividadeDe(ultima, true)) };

  return estados;
}

/** O que a barra lateral mostra embaixo do título de uma conversa em andamento. */
export interface AgoraDaConversa {
  texto: string;
  /** Com brilho: um bot está trabalhando. Sem brilho: esperando você ou na fila. */
  trabalhando: boolean;
}

/**
 * O que cada conversa está fazendo agora, por id. A aberta vem do stream ao vivo e traz o passo exato;
 * as outras vêm das tarefas ativas do servidor, que só dizem qual especialista trabalha.
 */
export function agoraDasConversas(
  atividade: readonly ResumoTarefa[],
  aberta: { id: string; bot: BotId; estados: EstadosDaEquipe; respondendo: boolean } | null,
  nomeDe: NomeDe,
): Record<string, AgoraDaConversa> {
  const agora: Record<string, AgoraDaConversa> = {};
  for (const t of [...atividade].reverse())
    agora[t.conversaId] = t.status === "trabalhando" ? { texto: `${nomeDe(t.botId).nome} trabalhando`, trabalhando: true } : { texto: "Na fila", trabalhando: false };

  if (!aberta) return agora;
  const { id, bot, estados, respondendo } = aberta;
  const estado = estadoDe(estados, bot);
  if (estado.tipo === "esperando") agora[id] = { texto: estado.texto, trabalhando: false };
  else if (estado.tipo === "delegando") {
    const especialista = Object.keys(estados).find((b) => b !== "chefe" && estadoDe(estados, b).tipo === "trabalhando");
    agora[id] = { texto: especialista ? `${nomeDe(especialista).nome}: ${estadoDe(estados, especialista).texto}` : estado.texto, trabalhando: true };
  } else if (respondendo && estado.tipo === "trabalhando") agora[id] = { texto: estado.texto, trabalhando: true };
  else if (!respondendo) delete agora[id];
  return agora;
}
