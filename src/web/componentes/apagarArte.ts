import { apiArtes, type ArteDaApi } from "../api";
import { mostrarAviso } from "./menu/Avisos";
import { pilhaDeDesfazer } from "./menu/desfazer";

/**
 * Apaga a arte e deixa o desfazer na pilha do app, que o aviso e o ⌘Z consomem. `aoDesfazer` roda depois que a arte
 * volta, para quem apagou atualizar a própria tela. Falha da API sobe para quem chamou mostrar.
 */
export async function apagarComDesfazer(id: string, aoDesfazer: (arte: ArteDaApi) => void): Promise<{ apagada: ArteDaApi; chave: number }> {
  const apagada = await apiArtes.apagar(id);
  const chave = pilhaDeDesfazer.empilhar(async () => {
    aoDesfazer(await apiArtes.restaurar(apagada));
  });
  mostrarAviso({ tipo: "desfazivel", chave, texto: "Arte apagada." });
  return { apagada, chave };
}
