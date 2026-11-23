import { imagensGeradas, type PastaDaImagem, type TipoImagem } from "../db";
import { artesDoEstudio, resumoDaArte } from "../v2/artes";
import type { Banco } from "../v2/banco";
import type { Formato } from "../v2/camadas";

/**
 * Uma imagem da Biblioteca. As do fluxo de posts abrem no editor por POST /api/imagens/:id/editar;
 * as do estúdio já são artes e abrem em /artes/:id.
 */
export type ImagemDaBiblioteca =
  | {
      origem: "post";
      id: number;
      url: string;
      formato: Formato;
      titulo: string | null;
      tipo: TipoImagem;
      variante: number | null;
      postId: number;
      conversaId: string | null;
      criadaEm: string;
      pasta: PastaDaImagem;
    }
  | { origem: "estudio"; id: string; url: string; formato: Formato; titulo: string; criadaEm: string };

/** GET /api/biblioteca: tudo o que foi gerado, da equipe inteira, o mais novo primeiro. */
export async function imagensDaBiblioteca(banco: Banco, userId: string): Promise<ImagemDaBiblioteca[]> {
  const doPost = (await imagensGeradas(userId)).map(
    (i): ImagemDaBiblioteca => ({
      origem: "post",
      id: i.id,
      url: i.url,
      formato: i.formato === "stories" ? "story" : "feed",
      titulo: i.headline ?? i.tema,
      tipo: i.tipo,
      variante: i.variante,
      postId: i.postId,
      conversaId: i.conversaId,
      criadaEm: new Date(i.criadaEm).toISOString(),
      pasta: i.pasta,
    }),
  );
  const doEstudio = (await artesDoEstudio(banco)).map((a): ImagemDaBiblioteca => {
    const { id, titulo, capa, formato } = resumoDaArte(a);
    return { origem: "estudio", id, url: capa, formato, titulo, criadaEm: a.criadaEm.toISOString() };
  });
  // As duas listas já vêm em ordem; o sort estável mantém as variações de uma geração na ordem delas.
  return [...doPost, ...doEstudio].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
}
