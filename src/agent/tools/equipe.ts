import { tool } from "ai";
import { z } from "zod";
import { listarBots, type DetalheBot } from "../config";
import { apagarBot, criarBot, EdicaoBot, editarBot, NovoBot, restaurarBot, type Resultado } from "../equipe";

const BotId = z.string().describe("O id do bot, como b-1a2b3c4d ou agenda. Veja em listar_bots.");

const resumo = (bot: DetalheBot) => ({ id: bot.id, nome: bot.nome, setor: bot.setor, descricao: bot.descricao, link: `/bots/${bot.id}` });

const saida = (r: Resultado) => (r.ok ? { ok: true as const, bot: resumo(r.bot) } : { ok: false as const, motivo: r.erro });

/**
 * O Chefe cria, edita, apaga e restaura bots pelas mesmas funções da tela, com o mesmo schema.
 * Cada versão gravada leva o e-mail de quem está na conversa.
 */
export const toolsDeEquipe = (autor: string) => ({
  listar_bots: tool({
    description: "Lista os bots ativos da equipe, os que vêm com o sistema e os criados, com id, nome, setor e descrição.",
    inputSchema: z.object({}),
    execute: async () =>
      (await listarBots()).map((b) => ({ id: b.id, nome: b.nome, setor: b.setor, descricao: b.descricao, criado: b.criado !== null })),
  }),
  criar_bot: tool({
    description:
      "Cria um bot novo para qualquer setor da empresa. Ele recebe as ferramentas livres (pesquisa na web, leitura de página e as de marketing) e usa só as que servem ao papel dele.",
    inputSchema: NovoBot,
    execute: async (novo) => ({ ok: true as const, bot: resumo(await criarBot(novo, autor)) }),
  }),
  editar_bot: tool({
    description: "Muda só os campos mandados de um bot ativo, fixo ou criado. Grava uma versão nova, que a equipe pode desfazer na configuração do bot.",
    inputSchema: z.object({ botId: BotId, campos: EdicaoBot }),
    execute: async ({ botId, campos }) => saida(await editarBot(botId, campos, autor)),
  }),
  remover_bot: tool({
    description: "Apaga um bot criado pela equipe. Ele some da barra e as conversas continuam legíveis. Os bots que vêm com o sistema não saem.",
    inputSchema: z.object({ botId: BotId }),
    execute: async ({ botId }) => saida(await apagarBot(botId)),
  }),
  restaurar_bot: tool({
    description: "Traz de volta um bot criado que foi apagado.",
    inputSchema: z.object({ botId: BotId }),
    execute: async ({ botId }) => saida(await restaurarBot(botId)),
  }),
});
