import { isToolUIPart, readUIMessageStream, toUIMessageStream, tool, type TextStreamPart, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import { ehBotFixo, type BotId, type Especialista } from "../bots";
import { configDoBot, situacaoDoBot, type ConfigBot } from "../config";
import { PARADO_PELO_USUARIO } from "../conversas";
import { explicarErro } from "../erros";
import { avancarTarefa, criarTarefa, type Tarefa } from "../tarefas";
import { entrarNaFila } from "../post";
import { toolsDePost } from "./post";

/** Roda um especialista, ou um bot criado, sobre o pedido do Chefe, na conversa do Chefe. */
export type RodarDelegado = (
  botId: BotId,
  pedido: string,
  abortSignal: AbortSignal | undefined,
) => Promise<{ readonly stream: ReadableStream<TextStreamPart<ToolSet>> }>;

/**
 * As prévias levam a mensagem do especialista inteira, para a UI desenhar ao vivo.
 * O AI SDK nunca manda prévia ao modelo: o Chefe só vê a última saída, que não tem histórico.
 */
export type SaidaDelegacao =
  | { tarefaId: string; status: "na_fila" }
  | { tarefaId: string; status: "trabalhando"; mensagem: UIMessage | null }
  | { tarefaId: string; status: "concluida"; resumo: string }
  | { tarefaId: string; status: "falhou"; erro: string };

const ultimoTexto = (m: UIMessage | null) => m?.parts.findLast((p) => p.type === "text")?.text.trim() || "Terminei sem resumo.";

const TOOLS_DE_POST: ReadonlySet<string> = new Set(Object.keys(toolsDePost("")));

/**
 * Bots que leem e gravam o post da conversa. Dois deles ao mesmo tempo sobrescreveriam o post um do outro.
 * Um bot criado tem as tools de post entre as livres, então também entra na fila.
 */
const mexeNoPost = (bot: ConfigBot) => bot.tools.some((t) => TOOLS_DE_POST.has(t));

/**
 * O estado de cada parte, sem o que muda a cada token (texto em streaming, entrada de
 * tool em streaming, prévia de tool). Muda quando uma parte começa, termina ou troca
 * de estado; é nesse ritmo que a tarefa é gravada, não a cada token.
 */
const marcos = (m: UIMessage | null) =>
  (m?.parts ?? [])
    .map((p) => {
      if (isToolUIPart(p)) return p.state === "input-streaming" || (p.state === "output-available" && p.preliminary) ? "" : p.state;
      return "state" in p && p.state === "done" ? "done" : "";
    })
    .join(",");

const Pedido = z.string().describe("Instrução completa. O bot não vê esta conversa, só o post dela.");

/** Uma tarefa do começo ao fim: grava cada marco e devolve as prévias para a UI. */
async function* rodarTarefa(
  conversaId: string,
  bot: ConfigBot,
  pedido: string,
  rodar: RodarDelegado,
  abortSignal: AbortSignal | undefined,
): AsyncGenerator<SaidaDelegacao> {
  const botId = bot.id;
  const serializar = mexeNoPost(bot);
  const pergunta: UIMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: pedido }] };
  let tarefa: Tarefa = await criarTarefa(conversaId, botId, pedido, [pergunta]);
  let resposta: UIMessage | null = null;
  const mensagens = () => (resposta ? [pergunta, resposta] : [pergunta]);
  // O erro do stream chega ao catch já como texto; a explicação é feita aqui, com o erro original.
  let explicado: string | null = null;
  yield { tarefaId: tarefa.id, status: "na_fila" };
  const sair = serializar ? await entrarNaFila(conversaId) : () => {};
  try {
    tarefa = await avancarTarefa(tarefa, { status: "trabalhando" });
    yield { tarefaId: tarefa.id, status: "trabalhando", mensagem: null };
    const { stream } = await rodar(botId, pedido, abortSignal);
    for await (const m of readUIMessageStream({ stream: toUIMessageStream({ stream, onError: (e) => (explicado = explicarErro(e)) }), terminateOnError: true })) {
      const avancou = marcos(m) !== marcos(resposta);
      resposta = m;
      if (avancou) tarefa = await avancarTarefa(tarefa, { status: "trabalhando", mensagens: mensagens() });
      yield { tarefaId: tarefa.id, status: "trabalhando", mensagem: m };
    }
    abortSignal?.throwIfAborted();
    const resumo = ultimoTexto(resposta);
    tarefa = await avancarTarefa(tarefa, { status: "concluida", resumo, mensagens: mensagens() });
    yield { tarefaId: tarefa.id, status: "concluida", resumo };
  } catch (e) {
    const erro = abortSignal?.aborted ? PARADO_PELO_USUARIO : (explicado ?? explicarErro(e));
    tarefa = await avancarTarefa(tarefa, { status: "falhou", erro, mensagens: mensagens() });
    yield { tarefaId: tarefa.id, status: "falhou", erro };
  } finally {
    sair();
  }
}

async function delegar(conversaId: string, botId: Especialista, rodar: RodarDelegado) {
  const bot = await configDoBot(botId);
  return tool({
    description: `Delega ao ${bot.nome}: ${bot.descricao} Devolve só o resumo do que ele fez.`,
    inputSchema: z.object({ pedido: Pedido }),
    execute: ({ pedido }, { abortSignal }) => rodarTarefa(conversaId, bot, pedido, rodar, abortSignal),
  });
}

/** Os especialistas têm uma tool cada; os bots criados pela equipe, esta, com o id. */
const delegarBot = (conversaId: string, rodar: RodarDelegado) =>
  tool({
    description: "Delega a um bot criado pela equipe, de qualquer setor. Os ids estão em BOTS DA EQUIPE nas suas instruções. Devolve só o resumo do que ele fez.",
    inputSchema: z.object({ botId: z.string().describe("O id do bot, como b-1a2b3c4d."), pedido: Pedido }),
    execute: async function* ({ botId, pedido }, { abortSignal }): AsyncGenerator<SaidaDelegacao> {
      if (ehBotFixo(botId)) throw new Error(`${botId} é um especialista: use a tool delegar_${botId}.`);
      if ((await situacaoDoBot(botId)) !== "ativo") throw new Error(`Não há bot ativo com o id ${botId}. Chame listar_bots para ver os ids.`);
      yield* rodarTarefa(conversaId, await configDoBot(botId), pedido, rodar, abortSignal);
    },
  });

export const toolsDeDelegacao = async (conversaId: string, rodar: RodarDelegado) => ({
  delegar_bot: delegarBot(conversaId, rodar),
  delegar_post: await delegar(conversaId, "post", rodar),
  delegar_legenda: await delegar(conversaId, "legenda", rodar),
  delegar_agenda: await delegar(conversaId, "agenda", rodar),
  delegar_fotos: await delegar(conversaId, "fotos", rodar),
  delegar_reels: await delegar(conversaId, "reels", rodar),
});
