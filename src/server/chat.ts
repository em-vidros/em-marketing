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
import { ehBotId } from "../agent/bots";
import { configDoBot } from "../agent/config";
import { explicarErro } from "../agent/erros";
import {
  AINDA_RESPONDENDO,
  abrirConversaDoUsuario,
  comecarTurno,
  gravarMensagens,
  mensagensDaConversa,
  terminarTurno,
} from "../agent/conversas";
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

type Juntada = { ok: true; historico: UIMessage[] } | { ok: false; status: 400 | 409; erro: string };

/**
 * O histórico salvo manda; do cliente só entra a última mensagem.
 * Do usuário com id novo, entra no fim. Do usuário com id que já existe, é a edição (ou o regenerar)
 * do useChat: troca o texto e descarta o que vinha depois, e o bot responde de novo.
 * Do bot, só pode ser uma que está salva, e dela só vale a resposta aos pedidos de aprovação em aberto;
 * o resto fica como foi salvo. Uma tool que o servidor já fechou não volta a rodar, e uma mensagem
 * apagada não tem mais o que aprovar.
 */
function juntar(salvas: UIMessage[], ultima: UIMessage): Juntada {
  const i = salvas.findIndex((m) => m.id === ultima.id);
  if (i === -1) return ultima.role === "user" ? { ok: true, historico: [...salvas, ultima] } : { ok: false, status: 409, erro: "Esta mensagem não está mais na conversa." };
  const salva = salvas[i]!;
  if (salva.role !== ultima.role) return { ok: false, status: 400, erro: "Só dá para editar as suas mensagens." };
  if (ultima.role === "user") return { ok: true, historico: [...salvas.slice(0, i), ultima] };
  const respostas = new Map(
    ultima.parts.filter(isToolUIPart).flatMap((p) => (p.state === "approval-responded" ? [[p.toolCallId, p.approval] as const] : [])),
  );
  const parts = salva.parts.map((p) => {
    if (!isToolUIPart(p) || p.state !== "approval-requested") return p;
    const resposta = respostas.get(p.toolCallId);
    if (resposta?.id !== p.approval.id) return p;
    return { ...p, state: "approval-responded" as const, approval: { ...p.approval, approved: resposta.approved, reason: resposta.reason } };
  });
  return { ok: true, historico: [...salvas.slice(0, i), { ...salva, parts }] };
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
    if (conversa.botId !== botId) return erro(400, `Esta conversa é do bot ${configDoBot(conversa.botId).nome}.`);

    if (!comecarTurno(conversa.id)) return erro(409, AINDA_RESPONDENDO);
    try {
      const juntada = juntar(mensagensDaConversa(conversa.id), ultima);
      if (!juntada.ok) {
        terminarTurno(conversa.id);
        return erro(juntada.status, juntada.erro);
      }
      const { historico } = juntada;
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
          // Roda também quando a aba fecha no meio (cancel do stream), então solta a conversa nos dois casos.
          onEnd: ({ messages }) => {
            try {
              gravarMensagens(conversa.id, messages.filter((m) => m.parts.length > 0));
            } finally {
              terminarTurno(conversa.id);
            }
          },
        }),
      });
    } catch (e) {
      terminarTurno(conversa.id);
      throw e;
    }
  };
}
