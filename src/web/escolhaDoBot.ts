import { DefaultChatTransport } from "ai";
import type { BotId, Mensagem } from "./tipos";

/**
 * Qual bot responde uma conversa. Numa conversa nova dá para trocar até a primeira mensagem
 * sair; a partir dela o bot fica, porque o servidor grava a conversa com ele e recusa outro.
 */
export interface EscolhaDoBot {
  ler: () => BotId;
  travada: () => boolean;
  /** Troca o bot. Depois da primeira mensagem não muda nada. */
  escolher: (bot: BotId) => void;
  travar: () => void;
  assinar: (avisar: () => void) => () => void;
}

export function criarEscolhaDoBot(inicial: BotId, { travada = false } = {}): EscolhaDoBot {
  let bot = inicial;
  let presa = travada;
  const ouvintes = new Set<() => void>();
  const avisar = () => ouvintes.forEach((o) => o());
  return {
    ler: () => bot,
    travada: () => presa,
    escolher(novo) {
      if (presa || novo === bot) return;
      bot = novo;
      avisar();
    },
    travar() {
      if (presa) return;
      presa = true;
      avisar();
    },
    assinar(o) {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
  };
}

/** O transporte do useChat: manda o bot da escolha e a trava no mesmo envio. */
export function criarTransporte(escolha: EscolhaDoBot) {
  return new DefaultChatTransport<Mensagem>({
    api: "/api/chat",
    // O servidor guarda o histórico e só lê a última mensagem.
    prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => {
      escolha.travar();
      return { body: { id, botId: escolha.ler(), trigger, messageId, messages: messages.slice(-1) } };
    },
  });
}
