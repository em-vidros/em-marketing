import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  getToolName,
  isToolUIPart,
  safeValidateUIMessages,
  toUIMessageStream,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { executar, type ResolverModelo } from "../agent";
import { BOTS, ehBotId } from "../agent/bots";
import { explicarErro } from "../agent/erros";
import { abrirConversaDoUsuario, gravarMensagens, mensagensDaConversa } from "../agent/conversas";
import type { Usuario } from "./auth";

export interface OpcoesChat {
  resolverModelo?: ResolverModelo;
  segredoAprovacao?: string;
}

/** O corpo do DefaultChatTransport do useChat, mais o botId que o front manda em `body`. */
const Corpo = z.object({
  id: z.string().min(1).max(100),
  botId: z.string().refine(ehBotId, "bot desconhecido"),
  messages: z.array(z.unknown()).min(1),
});

const erro = (status: number, mensagem: string) => Response.json({ erro: mensagem }, { status });

const tituloDe = (m: UIMessage) =>
  m.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join(" ")
    .trim()
    .slice(0, 80) || "Conversa nova";

const fechada = (p: { state: string }) => p.state === "output-available" || p.state === "output-error" || p.state === "output-denied";

/**
 * O histórico salvo manda; do cliente só entra a última mensagem. Se ela já existe
 * (resposta de aprovação na última mensagem do assistente, ou regenerar a partir de
 * uma mensagem do usuário), substitui essa e descarta o que vinha depois. Uma tool que
 * o servidor já fechou continua como foi salva: reenviar a mesma aprovação não a executa de novo.
 */
function juntar(salvas: UIMessage[], ultima: UIMessage): UIMessage[] {
  const i = salvas.findIndex((m) => m.id === ultima.id);
  if (i === -1) return [...salvas, ultima];
  const fechadas = new Map(salvas[i]!.parts.filter(isToolUIPart).filter(fechada).map((p) => [p.toolCallId, p]));
  const parts = ultima.parts.map((p) => (isToolUIPart(p) && fechadas.get(p.toolCallId)) || p);
  return [...salvas.slice(0, i), { ...ultima, parts }];
}

/**
 * Se o turno falha antes de executar uma tool aprovada (a assinatura não confere, por
 * exemplo), o AI SDK só emite o erro, e a parte ficaria salva em approval-responded, que o
 * card lê como "Aprovado. Agendando…". Antes do erro, cada aprovação sem resultado vira erro da tool, com o mesmo erro.
 */
function fecharAprovacoesNoErro(ultima: UIMessage) {
  const pendentes = new Map(
    ultima.parts.filter(isToolUIPart).flatMap((p) => (p.state === "approval-responded" && p.approval.approved ? [[p.toolCallId, p] as const] : [])),
  );
  return new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
    transform(part, ctl) {
      if (part.type === "tool-result" || part.type === "tool-error") pendentes.delete(part.toolCallId);
      if (part.type === "error") {
        for (const [toolCallId, p] of pendentes)
          ctl.enqueue({ type: "tool-error", toolCallId, toolName: getToolName(p), input: p.input, error: part.error });
        pendentes.clear();
      }
      ctl.enqueue(part);
    },
  });
}

export function rotaDeChat({ resolverModelo, segredoAprovacao }: OpcoesChat) {
  return async (req: Request, usuario: Usuario): Promise<Response> => {
    const corpo = Corpo.safeParse(await req.json().catch(() => null));
    if (!corpo.success) return erro(400, z.prettifyError(corpo.error));
    const { id, botId, messages } = corpo.data;

    const validada = await safeValidateUIMessages({ messages: messages.slice(-1) });
    if (!validada.success) return erro(400, validada.error.message);
    const [ultima] = validada.data as [UIMessage];

    const conversa = abrirConversaDoUsuario(usuario.id, id, botId, tituloDe(ultima));
    if (!conversa) return erro(404, "Conversa não encontrada.");
    if (conversa.botId !== botId) return erro(400, `Esta conversa é do bot ${BOTS[conversa.botId].nome}.`);

    const historico = juntar(mensagensDaConversa(conversa.id), ultima);
    const result = executar(conversa.botId, conversa.id, await convertToModelMessages(historico), { resolverModelo, segredoAprovacao });
    // Sem backpressure do cliente: o turno termina e é salvo mesmo se a aba fechar no meio.
    result.consumeStream();

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream.pipeThrough(fecharAprovacoesNoErro(historico.at(-1)!)),
        originalMessages: historico,
        generateMessageId: () => crypto.randomUUID(),
        onError: explicarErro,
        // Um turno que falhou antes da primeira parte deixa uma mensagem do assistente vazia; ela não entra no histórico.
        onEnd: ({ messages }) => gravarMensagens(conversa.id, messages.filter((m) => m.parts.length > 0)),
      }),
    });
  };
}
