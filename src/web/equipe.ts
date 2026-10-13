import { BOT_IDS, BOTS, type BotId } from "./bots";
import { ehAprovacao, ehDelegacao, especialistaDa, passosDe, type Mensagem, type ParteDelegacao, type ResumoTarefa } from "./tipos";

export type EstadoBot =
  | { tipo: "parado"; texto: string }
  | { tipo: "trabalhando"; texto: string }
  /** Esperando alguém: você (aprovação) ou outro bot. Ponto âmbar no avatar. */
  | { tipo: "esperando"; texto: string };

export type EstadosDaEquipe = Record<BotId, EstadoBot>;

/** O passo em andamento de uma delegação, a partir da prévia da mensagem do especialista. */
export function passoAtual(p: ParteDelegacao): string | null {
  if (p.state !== "output-available") return p.state === "input-streaming" || p.state === "input-available" ? "Na fila" : null;
  const s = p.output;
  if (s.status === "na_fila") return "Na fila";
  if (s.status !== "trabalhando") return null;
  return passosDe(s.mensagem).findLast((x) => x.estado === "fazendo")?.rotulo ?? "Pensando";
}

/**
 * O estado de cada bot, juntando as tarefas ativas do usuário (todas as conversas) com o
 * que está ao vivo na conversa aberta, que tem o passo atual e manda quando os dois falam.
 */
export function estadosDaEquipe(atividade: readonly ResumoTarefa[], mensagens: readonly Mensagem[], respondendo: boolean): EstadosDaEquipe {
  const estados = Object.fromEntries(BOT_IDS.map((id) => [id, { tipo: "parado", texto: "Parado" }])) as EstadosDaEquipe;

  for (const t of [...atividade].reverse()) {
    if (t.status === "trabalhando") estados[t.botId] = { tipo: "trabalhando", texto: "Trabalhando" };
    else if (estados[t.botId].tipo === "parado") estados[t.botId] = { tipo: "parado", texto: "Na fila" };
  }

  const ultima = mensagens.findLast((m) => m.role === "assistant");
  for (const p of ultima?.parts ?? []) {
    if (!ehDelegacao(p)) continue;
    const passo = passoAtual(p);
    if (passo) estados[especialistaDa(p)] = passo === "Na fila" ? { tipo: "parado", texto: passo } : { tipo: "trabalhando", texto: passo };
  }

  const trabalhando = BOT_IDS.find((id) => id !== "chefe" && estados[id].tipo === "trabalhando");
  if (ultima?.parts.some((p) => ehAprovacao(p) && p.state === "approval-requested"))
    estados.chefe = { tipo: "esperando", texto: "Esperando você" };
  else if (trabalhando) estados.chefe = { tipo: "esperando", texto: `Esperando o ${BOTS[trabalhando].nome}` };
  else if (respondendo) estados.chefe = { tipo: "trabalhando", texto: "Respondendo" };

  return estados;
}
