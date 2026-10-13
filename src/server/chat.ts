import { convertToModelMessages, createUIMessageStreamResponse, safeValidateUIMessages, toUIMessageStream, type UIMessage } from "ai";
import { z } from "zod";
import { executar, type ResolverModelo } from "../agent";
import { BOTS, ehBotId } from "../agent/bots";
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

/**
 * O histórico salvo manda; do cliente só entra a última mensagem. Se ela já existe
 * (resposta de aprovação na última mensagem do assistente, ou regenerar a partir de
 * uma mensagem do usuário), substitui essa e descarta o que vinha depois.
 */
function juntar(salvas: UIMessage[], ultima: UIMessage): UIMessage[] {
  const i = salvas.findIndex((m) => m.id === ultima.id);
  return [...(i === -1 ? salvas : salvas.slice(0, i)), ultima];
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
        stream: result.stream,
        originalMessages: historico,
        generateMessageId: () => crypto.randomUUID(),
        onError: (e) => (e instanceof Error ? e.message : String(e)),
        // Um turno que falhou antes da primeira parte deixa uma mensagem do assistente vazia; ela não entra no histórico.
        onEnd: ({ messages }) => gravarMensagens(conversa.id, messages.filter((m) => m.parts.length > 0)),
      }),
    });
  };
}
