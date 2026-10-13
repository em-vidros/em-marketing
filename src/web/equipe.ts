import { BOT_IDS, type BotId } from "./bots";
import { atividadeDe, textoDa } from "./componentes/ia/atividade";
import { ehAprovacao, ehDelegacao, especialistaDa, type Mensagem, type ParteDelegacao, type ResumoTarefa } from "./tipos";

export type EstadoBot =
  | { tipo: "parado"; texto: string }
  | { tipo: "trabalhando"; texto: string }
  /** Esperando você: há uma aprovação pendente. Só este estado ganha o ponto âmbar no avatar. */
  | { tipo: "esperando"; texto: string }
  /** O Chefe esperando um especialista. Sem ponto: quem tem de agir é o bot, não você. */
  | { tipo: "delegando"; texto: string };

export type EstadosDaEquipe = Record<BotId, EstadoBot>;

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
 * `nomes` são os nomes em vigor, que o usuário pode trocar na config do bot. `bot` é quem responde
 * a conversa aberta: numa conversa direta com um especialista, é ele que trabalha, não o Chefe.
 */
export function estadosDaEquipe(
  atividade: readonly ResumoTarefa[],
  mensagens: readonly Mensagem[],
  respondendo: boolean,
  nomes: Record<BotId, { nome: string }>,
  bot: BotId = "chefe",
): EstadosDaEquipe {
  const estados = Object.fromEntries(BOT_IDS.map((id) => [id, { tipo: "parado", texto: "Parado" }])) as EstadosDaEquipe;

  for (const t of [...atividade].reverse()) {
    if (t.status === "trabalhando") estados[t.botId] = { tipo: "trabalhando", texto: "Trabalhando" };
    else if (estados[t.botId].tipo === "parado") estados[t.botId] = { tipo: "parado", texto: "Na fila" };
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
    if (passo) estados[especialistaDa(p)] = passo === "Na fila" ? { tipo: "parado", texto: passo } : { tipo: "trabalhando", texto: passo };
  }

  const trabalhando = BOT_IDS.find((id) => id !== "chefe" && estados[id].tipo === "trabalhando");
  if (ultima?.parts.some((p) => ehAprovacao(p) && p.state === "approval-requested"))
    estados.chefe = { tipo: "esperando", texto: "Esperando você" };
  else if (trabalhando) estados.chefe = { tipo: "delegando", texto: `Esperando ${nomes[trabalhando].nome}` };
  else if (respondendo) estados.chefe = { tipo: "trabalhando", texto: textoDa(atividadeDe(ultima, true)) };

  return estados;
}
