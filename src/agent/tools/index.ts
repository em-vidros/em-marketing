import { toolsDeAgenda } from "./agenda";
import { toolsDeDelegacao, type RodarEspecialista } from "./delegar";
import { toolsDeFotos } from "./fotos";
import { toolsDePost, type Inspiracoes } from "./post";
import { toolsDeTexto } from "./texto";

export { APROVACAO } from "./post";
export type { RodarEspecialista, SaidaDelegacao } from "./delegar";
export type { Inspiracoes } from "./post";

/** Todas as tools. As de post leem e gravam o post da conversa; as de delegação rodam especialistas nela. */
export const catalogo = async (conversaId: string, rodar: RodarEspecialista, inspiracoes?: Inspiracoes) => ({
  ...toolsDePost(conversaId, inspiracoes),
  ...toolsDeFotos,
  ...toolsDeAgenda,
  ...toolsDeTexto,
  ...(await toolsDeDelegacao(conversaId, rodar)),
});

export type Catalogo = Awaited<ReturnType<typeof catalogo>>;
export type ToolName = keyof Catalogo;
