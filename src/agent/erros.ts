import { APICallError, InvalidToolApprovalError, InvalidToolApprovalSignatureError, LoadAPIKeyError, RetryError, ToolCallNotFoundForApprovalError } from "ai";

type Causa = "cota" | "chave" | "rede" | "sobrecarga" | "aprovacao" | "desconhecida";

const MENSAGEM: Record<Causa, string> = {
  cota: "O modelo de IA chegou ao limite de uso. Tente de novo mais tarde.",
  chave: "A chave do modelo de IA está faltando ou foi recusada. Avise quem cuida do sistema.",
  rede: "Não deu para falar com o modelo de IA. Confira a conexão e tente de novo.",
  sobrecarga: "O modelo de IA está fora do ar ou sobrecarregado. Tente de novo em alguns minutos.",
  aprovacao: "A aprovação não pôde ser conferida, e nada foi publicado nem agendado. Peça de novo ao Chefe.",
  desconhecida: "Algo deu errado do nosso lado. Tente de novo.",
};

function causaDe(e: unknown): Causa {
  if (RetryError.isInstance(e)) return causaDe(e.lastError);
  if (LoadAPIKeyError.isInstance(e)) return "chave";
  if (InvalidToolApprovalSignatureError.isInstance(e) || InvalidToolApprovalError.isInstance(e) || ToolCallNotFoundForApprovalError.isInstance(e))
    return "aprovacao";
  if (!APICallError.isInstance(e)) return "desconhecida";
  const { statusCode: status, responseBody = "" } = e;
  if (status === undefined) return "rede";
  if (status === 429) return "cota";
  // O Gemini recusa chave inválida com 400 INVALID_ARGUMENT, não 401.
  if (status === 401 || status === 403 || responseBody.includes("API_KEY_INVALID")) return "chave";
  if (status >= 500) return "sobrecarga";
  return "desconhecida";
}

/** O que o usuário lê quando um turno ou uma tarefa falha. O original fica no log do servidor, pelo onError do streamText. */
export const explicarErro = (e: unknown): string => MENSAGEM[causaDe(e)];
