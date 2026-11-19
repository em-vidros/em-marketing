import { tool } from "ai";
import { z } from "zod";
import type { BotId } from "../bots";
import { lembrar } from "../config";

/** A memória do bot é da equipe toda: o que ele guarda aqui entra no prompt de todas as conversas com ele. */
export const toolsDeMemoria = (botId: BotId) => ({
  lembrar: tool({
    description:
      "Guarda uma nota na sua memória, que entra no seu prompt em todas as conversas da equipe com você. Use quando o usuário pedir para lembrar algo ou corrigir um jeito de trabalhar que vale para as próximas vezes. Não guarde o que só serve para esta conversa.",
    inputSchema: z.object({ nota: z.string().min(1).max(500).describe("Uma frase curta, sem a data; o sistema põe a data.") }),
    execute: async ({ nota }) =>
      (await lembrar(botId, nota))
        ? { ok: true as const }
        : { ok: false as const, motivo: "A memória está cheia. Peça para alguém limpar a memória na configuração do bot." },
  }),
});
