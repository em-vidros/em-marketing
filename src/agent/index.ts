import { isStepCount, streamText, type LanguageModel, type ModelMessage } from "ai";
import { BOTS, type Bot, type BotId } from "./bots";
import { modelo } from "./models";
import { abrirConversa, postDaConversa, resumoDoPost } from "./post";
import { APROVACAO, catalogo, type RodarEspecialista } from "./tools";

export type ResolverModelo = (bot: Bot) => LanguageModel;

export interface Opcoes {
  /** Os testes trocam o registry por modelos falsos. */
  resolverModelo?: ResolverModelo;
  abortSignal?: AbortSignal;
  /** O bot roda uma tarefa do Chefe, não uma conversa direta com o usuário. */
  delegada?: boolean;
  /** Assina cada pedido de aprovação; uma aprovação forjada pelo cliente não executa a tool. */
  segredoAprovacao?: string;
}

const doRegistry: ResolverModelo = (bot) => modelo(bot.modelo);

const DELEGADA =
  "Você está numa tarefa delegada pelo Chefe, não falando com o usuário. Não faça perguntas: decida com o que tem e siga o fluxo até onde o pedido manda. Termine com um resumo curto do que fez e do que ficou pendente; só ele volta para o Chefe.";

/**
 * Um turno de um bot numa conversa. O estado do post entra nas instruções a cada turno.
 * O especialista de uma tarefa roda na conversa do Chefe, então lê e grava o mesmo post.
 */
export function executar(botId: BotId, conversaId: string, messages: ModelMessage[], opcoes: Opcoes = {}) {
  const { resolverModelo = doRegistry, abortSignal, delegada = false, segredoAprovacao } = opcoes;
  const bot = BOTS[botId];
  abrirConversa(conversaId, botId);
  const instrucoes = [bot.instrucoes(), ...(delegada ? [DELEGADA] : [])].join("\n\n");
  const rodar: RodarEspecialista = (especialista, pedido, sinal) =>
    executar(especialista, conversaId, [{ role: "user", content: pedido }], { resolverModelo, abortSignal: sinal, delegada: true });
  return streamText({
    model: resolverModelo(bot),
    instructions: `${instrucoes}\n\n--- ESTADO DO POST DESTA CONVERSA ---\n${resumoDoPost(postDaConversa(conversaId))}`,
    messages,
    tools: catalogo(conversaId, rodar),
    activeTools: [...bot.tools],
    toolApproval: APROVACAO,
    experimental_toolApprovalSecret: segredoAprovacao,
    stopWhen: isStepCount(8),
    abortSignal,
  });
}
