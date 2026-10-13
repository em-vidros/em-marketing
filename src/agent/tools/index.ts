import { toolsDeAgenda } from "./agenda";
import { toolsDeDelegacao, type RodarEspecialista } from "./delegar";
import { toolsDeFotos } from "./fotos";
import { toolsDePost } from "./post";
import { toolsDeTexto } from "./texto";

export { APROVACAO } from "./post";
export type { RodarEspecialista, SaidaDelegacao } from "./delegar";

/** Todas as tools. As de post leem e gravam o post da conversa; as de delegação rodam especialistas nela. */
export const catalogo = (conversaId: string, rodar: RodarEspecialista) => ({
  ...toolsDePost(conversaId),
  ...toolsDeFotos,
  ...toolsDeAgenda,
  ...toolsDeTexto,
  ...toolsDeDelegacao(conversaId, rodar),
});

export type ToolName = keyof ReturnType<typeof catalogo>;
