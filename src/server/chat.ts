import {
  consumeStream,
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
import type { CarregarReferencias } from "../v2/referencias";
import { configDoBot, situacaoDoBot } from "../agent/config";
import { explicarErro } from "../agent/erros";
import {
  AINDA_RESPONDENDO,
  PARADO_PELO_USUARIO,
  abrirConversa,
  comecarTurno,
  gravarMensagens,
  mensagensDaConversa,
} from "../agent/conversas";
import type { Usuario } from "./auth";

export interface OpcoesChat {
  resolverModelo?: ResolverModelo;
  segredoAprovacao?: string;
  carregarReferencias?: CarregarReferencias;
}

/** O corpo do DefaultChatTransport do useChat, mais o botId que o front manda em `body`. */
const Corpo = z.object({
  id: z.string().min(1).max(100),
  botId: z.string().min(1).max(40),
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

/**
 * Um turno parado no meio pode deixar uma tool sem resultado, e o modelo recusa um histórico com chamada sem resposta.
 * A chamada que nem terminou de chegar sai. A que já rodava, ou já tinha sido aprovada, vira erro, porque pode ter feito parte do trabalho.
 */
function fecharToolsParadas(m: UIMessage): UIMessage {
  const parts = m.parts.flatMap((p): UIMessage["parts"] => {
    if (!isToolUIPart(p)) return [p];
    if (p.state === "input-streaming") return [];
    if (p.state === "input-available" || (p.state === "approval-responded" && p.approval.approved))
      return [{ ...p, state: "output-error", errorText: PARADO_PELO_USUARIO, approval: p.approval && { ...p.approval, approved: true } }];
    return [p];
  });
  return { ...m, parts };
}

export function rotaDeChat({ resolverModelo, segredoAprovacao, carregarReferencias }: OpcoesChat) {
  return async (req: Request, usuario: Usuario): Promise<Response> => {
    const corpo = Corpo.safeParse(await req.json().catch(() => null));
    if (!corpo.success) return erro(400, z.prettifyError(corpo.error));
    const { id, botId, messages } = corpo.data;

    const validada = await safeValidateUIMessages({ messages: messages.slice(-1) });
    if (!validada.success) return erro(400, validada.error.message);
    const [ultima] = validada.data as [UIMessage];

    const situacao = await situacaoDoBot(botId);
    if (situacao === null) return erro(400, "Este bot não existe.");
    if (situacao === "apagado") return erro(410, "Este bot foi apagado. Restaure o bot na configuração dele para continuar a conversa.");

    const conversa = await abrirConversa(usuario, id, botId, tituloDe(ultima));
    if (!conversa) return erro(404, "Conversa não encontrada.");
    if (conversa.botId !== botId) return erro(400, `Esta conversa é do bot ${(await configDoBot(conversa.botId)).nome}.`);

    const turno = await comecarTurno(conversa.id);
    if (!turno) return erro(409, AINDA_RESPONDENDO);
    try {
      const juntada = juntar(await mensagensDaConversa(conversa.id), ultima);
      if (!juntada.ok) {
        await turno.terminar();
        return erro(juntada.status, juntada.erro);
      }
      const { historico } = juntada;
      const result = await executar(conversa.botId, conversa.id, await convertToModelMessages(historico), {
        resolverModelo,
        segredoAprovacao,
        carregarReferencias,
        abortSignal: turno.sinal,
        autor: usuario.email,
      });
      const mensagemId = crypto.randomUUID();
      const [paraOCliente, paraGravar] = toUIMessageStream({
        stream: result.stream.pipeThrough(fecharAprovacoesNoErro(historico.at(-1)!)),
        originalMessages: historico,
        generateMessageId: () => mensagemId,
        onError: explicarErro,
        // Um turno que falhou antes da primeira parte deixa uma mensagem do assistente vazia; ela não entra no histórico.
        onEnd: async ({ messages, isAborted }) => {
          try {
            const salvas = messages.filter((m) => m.parts.length > 0);
            await gravarMensagens(conversa.id, isAborted ? salvas.map(fecharToolsParadas) : salvas);
          } finally {
            await turno.terminar();
          }
        },
      }).tee();
      // O cliente pode parar de ler (aba fechada, Parar); o turno segue até o fim ou até o sinal de parar, e só então
      // grava e solta a conversa.
      void consumeStream({ stream: paraGravar });
      return createUIMessageStreamResponse({ stream: paraOCliente });
    } catch (e) {
      await turno.terminar();
      throw e;
    }
  };
}
