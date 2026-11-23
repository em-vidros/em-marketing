import { isStepCount, streamText, type LanguageModel, type ModelMessage } from "ai";
import type { BotId } from "./bots";
import { botsParaDelegar, detalheDoBot, instrucoesDe, type ConfigBot } from "./config";
import { modelo } from "./models";
import { registrarUso } from "../domain/uso";
import { abrirConversa, postDaConversa, resumoDoPost } from "./post";
import { APROVACAO, catalogo, type RodarDelegado } from "./tools";
import type { ReferenciasDoTurno } from "./pedido";

export type ResolverModelo = (bot: ConfigBot) => LanguageModel | Promise<LanguageModel>;

export interface Opcoes {
  /** Os testes trocam o registry por modelos falsos. */
  resolverModelo?: ResolverModelo;
  abortSignal?: AbortSignal;
  /** O bot roda uma tarefa do Chefe, não uma conversa direta com o usuário. */
  delegada?: boolean;
  /** Assina cada pedido de aprovação; uma aprovação forjada pelo cliente não executa a tool. */
  segredoAprovacao?: string;
  /** As âncoras da geração deste turno, com a escolha que a pessoa mandou no pedido. */
  referencias?: ReferenciasDoTurno;
  /** O e-mail de quem está na conversa; sem sessão (testes, scripts), o próprio Chefe assina. */
  autor?: string;
}

const doRegistry: ResolverModelo = (bot) => modelo(bot.modelo);

const SO_COM_O_USUARIO = new Set(["mostrar_artes", "escolher_arte"]);

/**
 * Um turno de um bot numa conversa. A config, a memória do bot e o estado do post são lidos a cada turno:
 * uma edição do bot vale no turno seguinte, sem reiniciar o servidor.
 * O especialista de uma tarefa roda na conversa do Chefe, então lê e grava o mesmo post.
 */
export async function executar(botId: BotId, conversaId: string, messages: ModelMessage[], opcoes: Opcoes = {}) {
  const { resolverModelo = doRegistry, abortSignal, delegada = false, segredoAprovacao, referencias, autor = "Chefe" } = opcoes;
  const bot = await detalheDoBot(botId);
  await abrirConversa(conversaId, botId);
  const rodar: RodarDelegado = (delegado, pedido, sinal) =>
    executar(delegado, conversaId, [{ role: "user", content: pedido }], { resolverModelo, abortSignal: sinal, delegada: true, referencias, autor });
  return streamText({
    model: await resolverModelo(bot),
    instructions: instrucoesDe(bot, { delegada, estadoDoPost: resumoDoPost(await postDaConversa(conversaId)), equipe: await botsParaDelegar(bot) }),
    messages,
    tools: await catalogo({ conversaId, botId, autor, rodar, referencias }),
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
