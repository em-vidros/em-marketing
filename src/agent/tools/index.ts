import { toolsDeAgenda } from "./agenda";
import { toolsDeFotos } from "./fotos";
import { toolsDePost } from "./post";
import { toolsDeTexto } from "./texto";

export { APROVACAO } from "./post";

/** Todas as tools. As de post leem e gravam o post da conversa. */
export const catalogo = (conversaId: string) => ({
  ...toolsDePost(conversaId),
  ...toolsDeFotos,
  ...toolsDeAgenda,
  ...toolsDeTexto,
});

export type ToolName = keyof ReturnType<typeof catalogo>;
