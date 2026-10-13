import { isStepCount, streamText, type ModelMessage } from "ai";
import { BOTS, type BotId } from "./bots";
import { modelo } from "./models";
import { abrirConversa, postDaConversa, resumoDoPost } from "./post";
import { APROVACAO, catalogo } from "./tools";

/** Um turno de um bot numa conversa. O estado do post entra nas instruções a cada turno. */
export function executar(botId: BotId, conversaId: string, messages: ModelMessage[]) {
  const bot = BOTS[botId];
  abrirConversa(conversaId, botId);
  return streamText({
    model: modelo(bot.modelo),
    instructions: `${bot.instrucoes()}\n\n--- ESTADO DO POST DESTA CONVERSA ---\n${resumoDoPost(postDaConversa(conversaId))}`,
    messages,
    tools: catalogo(conversaId),
    activeTools: [...bot.tools],
    toolApproval: APROVACAO,
    stopWhen: isStepCount(8),
  });
}
