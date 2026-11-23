import { toolsDeAgenda } from "./agenda";
import { toolsDeDelegacao, type RodarDelegado } from "./delegar";
import type { BotId } from "../bots";
import { toolsDeEquipe } from "./equipe";
import { toolsDeFotos } from "./fotos";
import { toolsDeMemoria } from "./memoria";
import { toolsDePost } from "./post";
import type { ReferenciasDoTurno } from "../pedido";
import { toolsDeTexto } from "./texto";
import { buscaNaWeb, toolsDeWeb } from "./web";

export { APROVACAO } from "./post";
export type { RodarDelegado, SaidaDelegacao } from "./delegar";

export interface Turno {
  conversaId: string;
  botId: BotId;
  /** Quem está na conversa. Vai como autor das versões que o Chefe grava ao criar ou editar um bot. */
  autor: string;
  rodar: RodarDelegado;
  referencias?: ReferenciasDoTurno;
}

/**
 * Todas as tools. As de post leem e gravam o post da conversa; as de delegação rodam especialistas nela;
 * lembrar grava na memória do bot que está no turno.
 */
export const catalogo = async ({ conversaId, botId, autor, rodar, referencias }: Turno) => ({
  ...toolsDePost(conversaId, referencias),
  ...toolsDeFotos,
  ...toolsDeAgenda,
  ...toolsDeTexto,
  ...toolsDeMemoria(botId),
  ...toolsDeWeb,
  // A mesma busca de pesquisar_web, com o nome que o fluxo de estilo do Post e as conversas gravadas dele usam.
  pesquisar_referencias: buscaNaWeb(),
  ...toolsDeEquipe(autor),
  ...(await toolsDeDelegacao(conversaId, rodar)),
});

export type Catalogo = Awaited<ReturnType<typeof catalogo>>;
export type ToolName = keyof Catalogo;
