import { isStepCount, streamText, type LanguageModel, type ModelMessage } from "ai";
import { BOTS, type BotId } from "./bots";
import { configDoBot, instrucoesDe, type ConfigBot } from "./config";
import { contextoDeData } from "./hoje";
import { modelo } from "./models";
import { registrarUso } from "../domain/uso";
import { abrirConversa, postDaConversa, resumoDoPost } from "./post";
import { APROVACAO, catalogo, type Inspiracoes, type RodarEspecialista } from "./tools";

export type ResolverModelo = (bot: ConfigBot) => LanguageModel | Promise<LanguageModel>;

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

const DELEGADA =
  "Você está numa tarefa delegada pelo Chefe, não falando com o usuário. Não faça perguntas: decida com o que tem e siga o fluxo até onde o pedido manda. Termine com um resumo curto do que fez e do que ficou pendente; só ele volta para o Chefe.";

/**
 * Um turno de um bot numa conversa. A config do bot e o estado do post são lidos a cada turno:
 * uma edição do bot vale no turno seguinte, sem reiniciar o servidor.
 * O especialista de uma tarefa roda na conversa do Chefe, então lê e grava o mesmo post.
 */
export async function executar(botId: BotId, conversaId: string, messages: ModelMessage[], opcoes: Opcoes = {}) {
  const { resolverModelo = doRegistry, abortSignal, delegada = false, segredoAprovacao, inspiracoes } = opcoes;
  const bot = await configDoBot(botId);
  await abrirConversa(conversaId, botId);
  const instrucoes = [instrucoesDe(bot), contextoDeData(), ...(delegada ? [DELEGADA] : [])].join("\n\n");
  const rodar: RodarEspecialista = (especialista, pedido, sinal) =>
    executar(especialista, conversaId, [{ role: "user", content: pedido }], { resolverModelo, abortSignal: sinal, delegada: true, inspiracoes });
  return streamText({
    model: await resolverModelo(bot),
    instructions: `${instrucoes}\n\n--- ESTADO DO POST DESTA CONVERSA ---\n${resumoDoPost(await postDaConversa(conversaId))}`,
    messages,
    tools: await catalogo(conversaId, rodar, inspiracoes),
    // Numa tarefa delegada ninguém vê a conversa: mostrar e escolher as artes só acontecem num turno com o usuário.
    activeTools: BOTS[botId].tools.filter((t) => !(delegada && SO_COM_O_USUARIO.has(t))),
    toolApproval: APROVACAO,
    experimental_toolApprovalSecret: segredoAprovacao,
    // O post no formato ambos passa por 7 tools antes do resumo; 8 cortava o fluxo no fim.
    stopWhen: isStepCount(12),
    abortSignal,
    onFinish: ({ totalUsage }) =>
      registrarUso({ origem: `Bot ${BOTS[botId].nome}`, modelo: bot.modelo.slice(bot.modelo.indexOf(":") + 1), entrada: totalUsage.inputTokens ?? 0, saida: totalUsage.outputTokens ?? 0, imagens: 0 }),
  });
}
