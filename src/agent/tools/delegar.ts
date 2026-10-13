import { readUIMessageStream, toUIMessageStream, tool, type TextStreamPart, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import { BOTS, type Especialista } from "../bots";
import { avancarTarefa, criarTarefa, type Tarefa } from "../tarefas";

/** Roda um especialista sobre o pedido do Chefe, na conversa do Chefe. */
export type RodarEspecialista = (
  botId: Especialista,
  pedido: string,
  abortSignal: AbortSignal | undefined,
) => { readonly stream: ReadableStream<TextStreamPart<ToolSet>> };

/**
 * As prévias levam a mensagem do especialista inteira, para a UI desenhar ao vivo.
 * O AI SDK nunca manda prévia ao modelo: o Chefe só vê a última saída, que não tem histórico.
 */
export type SaidaDelegacao =
  | { tarefaId: string; status: "trabalhando"; mensagem: UIMessage | null }
  | { tarefaId: string; status: "concluida"; resumo: string }
  | { tarefaId: string; status: "falhou"; erro: string };

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

const ultimoTexto = (m: UIMessage | null) => m?.parts.findLast((p) => p.type === "text")?.text.trim() || "Terminei sem resumo.";

function delegar(conversaId: string, botId: Especialista, rodar: RodarEspecialista) {
  const bot = BOTS[botId];
  return tool({
    description: `Delega ao ${bot.nome}: ${bot.descricao} Devolve só o resumo do que ele fez.`,
    inputSchema: z.object({
      pedido: z.string().describe("Instrução completa. O especialista não vê esta conversa, só o post dela."),
    }),
    execute: async function* ({ pedido }, { abortSignal }): AsyncGenerator<SaidaDelegacao> {
      const pergunta: UIMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: pedido }] };
      let tarefa: Tarefa = criarTarefa(conversaId, botId, pedido, [pergunta]);
      let resposta: UIMessage | null = null;
      const mensagens = () => (resposta ? [pergunta, resposta] : [pergunta]);
      try {
        tarefa = avancarTarefa(tarefa, { status: "trabalhando" });
        yield { tarefaId: tarefa.id, status: "trabalhando", mensagem: null };
        const { stream } = rodar(botId, pedido, abortSignal);
        for await (const m of readUIMessageStream({ stream: toUIMessageStream({ stream, onError: mensagemDe }), terminateOnError: true })) {
          resposta = m;
          yield { tarefaId: tarefa.id, status: "trabalhando", mensagem: m };
        }
        const resumo = ultimoTexto(resposta);
        tarefa = avancarTarefa(tarefa, { status: "concluida", resumo, mensagens: mensagens() });
        yield { tarefaId: tarefa.id, status: "concluida", resumo };
      } catch (e) {
        const erro = mensagemDe(e);
        tarefa = avancarTarefa(tarefa, { status: "falhou", erro, mensagens: mensagens() });
        yield { tarefaId: tarefa.id, status: "falhou", erro };
      }
    },
  });
}

export const toolsDeDelegacao = (conversaId: string, rodar: RodarEspecialista) => ({
  delegar_post: delegar(conversaId, "post", rodar),
  delegar_legenda: delegar(conversaId, "legenda", rodar),
  delegar_agenda: delegar(conversaId, "agenda", rodar),
  delegar_fotos: delegar(conversaId, "fotos", rodar),
  delegar_reels: delegar(conversaId, "reels", rodar),
});
