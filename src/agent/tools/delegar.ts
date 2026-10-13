import { isToolUIPart, readUIMessageStream, toUIMessageStream, tool, type TextStreamPart, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import { BOTS, type Especialista } from "../bots";
import { configDoBot } from "../config";
import { explicarErro } from "../erros";
import { avancarTarefa, criarTarefa, type Tarefa } from "../tarefas";
import { toolsDePost } from "./post";

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
  | { tarefaId: string; status: "na_fila" }
  | { tarefaId: string; status: "trabalhando"; mensagem: UIMessage | null }
  | { tarefaId: string; status: "concluida"; resumo: string }
  | { tarefaId: string; status: "falhou"; erro: string };

const ultimoTexto = (m: UIMessage | null) => m?.parts.findLast((p) => p.type === "text")?.text.trim() || "Terminei sem resumo.";

const TOOLS_DE_POST: ReadonlySet<string> = new Set(Object.keys(toolsDePost("")));

/** Especialistas que leem e gravam o post da conversa. Dois deles ao mesmo tempo sobrescreveriam o post um do outro. */
const mexeNoPost = (botId: Especialista) => BOTS[botId].tools.some((t) => TOOLS_DE_POST.has(t));

/**
 * Uma fila por conversa para as delegações que mexem no post. O Chefe pode chamar
 * delegar_post duas vezes no mesmo passo; a segunda espera a primeira terminar e
 * começa do post que ela deixou.
 */
const filas = new Map<string, Promise<void>>();

async function entrarNaFila(conversaId: string): Promise<() => void> {
  const anterior = filas.get(conversaId) ?? Promise.resolve();
  let sair!: () => void;
  const vez = new Promise<void>((r) => (sair = r));
  const cauda = anterior.then(() => vez);
  filas.set(conversaId, cauda);
  await anterior;
  return () => {
    sair();
    if (filas.get(conversaId) === cauda) filas.delete(conversaId);
  };
}

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

function delegar(conversaId: string, botId: Especialista, rodar: RodarEspecialista) {
  const bot = configDoBot(botId);
  const serializar = mexeNoPost(botId);
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
      // O erro do stream chega ao catch já como texto; a explicação é feita aqui, com o erro original.
      let explicado: string | null = null;
      yield { tarefaId: tarefa.id, status: "na_fila" };
      const sair = serializar ? await entrarNaFila(conversaId) : () => {};
      try {
        tarefa = avancarTarefa(tarefa, { status: "trabalhando" });
        yield { tarefaId: tarefa.id, status: "trabalhando", mensagem: null };
        const { stream } = rodar(botId, pedido, abortSignal);
        for await (const m of readUIMessageStream({ stream: toUIMessageStream({ stream, onError: (e) => (explicado = explicarErro(e)) }), terminateOnError: true })) {
          const avancou = marcos(m) !== marcos(resposta);
          resposta = m;
          if (avancou) tarefa = avancarTarefa(tarefa, { status: "trabalhando", mensagens: mensagens() });
          yield { tarefaId: tarefa.id, status: "trabalhando", mensagem: m };
        }
        const resumo = ultimoTexto(resposta);
        tarefa = avancarTarefa(tarefa, { status: "concluida", resumo, mensagens: mensagens() });
        yield { tarefaId: tarefa.id, status: "concluida", resumo };
      } catch (e) {
        const erro = explicado ?? explicarErro(e);
        tarefa = avancarTarefa(tarefa, { status: "falhou", erro, mensagens: mensagens() });
        yield { tarefaId: tarefa.id, status: "falhou", erro };
      } finally {
        sair();
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
