import { openai } from "@ai-sdk/openai";
import { toolsDeAgenda } from "./agenda";
import { toolsDeDelegacao, type RodarEspecialista } from "./delegar";
import type { BotId } from "../bots";
import { toolsDeFotos } from "./fotos";
import { toolsDeMemoria } from "./memoria";
import { toolsDePost, type Inspiracoes } from "./post";
import { toolsDeTexto } from "./texto";

export { APROVACAO } from "./post";
export type { RodarEspecialista, SaidaDelegacao } from "./delegar";
export type { Inspiracoes } from "./post";

/**
 * Todas as tools. As de post leem e gravam o post da conversa; as de delegação rodam especialistas nela;
 * lembrar grava na memória do bot que está no turno.
 */
export const catalogo = async (conversaId: string, botId: BotId, rodar: RodarEspecialista, inspiracoes?: Inspiracoes) => ({
  ...toolsDePost(conversaId, inspiracoes),
  ...toolsDeFotos,
  ...toolsDeAgenda,
  ...toolsDeTexto,
  ...toolsDeMemoria(botId),
  // Busca na web da OpenAI, executada pelo provedor: o Post procura referências quando o usuário pede outro estilo.
  pesquisar_referencias: openai.tools.webSearch({ searchContextSize: "medium" }),
  ...(await toolsDeDelegacao(conversaId, rodar)),
});

export type Catalogo = Awaited<ReturnType<typeof catalogo>>;
export type ToolName = keyof Catalogo;
