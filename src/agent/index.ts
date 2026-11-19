import { isStepCount, streamText, type LanguageModel, type ModelMessage } from "ai";
import type { BotId } from "./bots";
import { detalheDoBot, instrucoesDe, type ConfigBot } from "./config";
import { modelo } from "./models";
import { registrarUso } from "../domain/uso";
import { abrirConversa, postDaConversa, resumoDoPost } from "./post";
import { APROVACAO, catalogo, type Inspiracoes, type RodarEspecialista } from "./tools";

export type ResolverModelo = (bot: ConfigBot) => LanguageModel;

export interface Opcoes {
  /** Os testes trocam o registry por modelos falsos. */
  resolverModelo?: ResolverModelo;
  abortSignal?: AbortSignal;
  /** O bot roda uma tarefa do Chefe, não uma conversa direta com o usuário. */
  delegada?: boolean;
  /** Assina cada pedido de aprovação; uma aprovação forjada pelo cliente não executa a tool. */
  segredoAprovacao?: string;
  inspiracoes?: Inspiracoes;
}

const doRegistry: ResolverModelo = (bot) => modelo(bot.modelo);

const SO_COM_O_USUARIO = new Set(["mostrar_artes", "escolher_arte"]);

/**
 * Um turno de um bot numa conversa. A config, a memória do bot e o estado do post são lidos a cada turno:
 * uma edição do bot vale no turno seguinte, sem reiniciar o servidor.
 * O especialista de uma tarefa roda na conversa do Chefe, então lê e grava o mesmo post.
 */
export async function executar(botId: BotId, conversaId: string, messages: ModelMessage[], opcoes: Opcoes = {}) {
  const { resolverModelo = doRegistry, abortSignal, delegada = false, segredoAprovacao, inspiracoes } = opcoes;
  const bot = await detalheDoBot(botId);
  await abrirConversa(conversaId, botId);
  const rodar: RodarEspecialista = (especialista, pedido, sinal) =>
    executar(especialista, conversaId, [{ role: "user", content: pedido }], { resolverModelo, abortSignal: sinal, delegada: true, inspiracoes });
  return streamText({
    model: resolverModelo(bot),
    instructions: instrucoesDe(bot, { delegada, estadoDoPost: resumoDoPost(await postDaConversa(conversaId)) }),
    messages,
    tools: await catalogo(conversaId, botId, rodar, inspiracoes),
    // Numa tarefa delegada ninguém vê a conversa: mostrar e escolher as artes só acontecem num turno com o usuário.
    activeTools: [...bot.tools, "lembrar" as const].filter((t) => !(delegada && SO_COM_O_USUARIO.has(t))),
    toolApproval: APROVACAO,
    experimental_toolApprovalSecret: segredoAprovacao,
    // O post no formato ambos passa por 7 tools antes do resumo; 8 cortava o fluxo no fim.
    stopWhen: isStepCount(12),
    abortSignal,
    onFinish: ({ totalUsage }) =>
      registrarUso({ origem: `Bot ${bot.nome}`, modelo: bot.modelo.slice(bot.modelo.indexOf(":") + 1), entrada: totalUsage.inputTokens ?? 0, saida: totalUsage.outputTokens ?? 0, imagens: 0 }),
  });
}
