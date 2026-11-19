import { useAtalho } from "../../teclado/motor";
import type { useEditor } from "./useEditor";

/**
 * As teclas do editor. Ficam no escopo `arte`, então só valem com o foco no editor e fora de campo de texto: no
 * campo e na edição do texto na arte, Backspace e ⌘Z são do navegador. Devolver false deixa a tecla seguir.
 */
export function useAtalhosDoEditor(editor: ReturnType<typeof useEditor>, focarPalco: () => void) {
  const { camada, acoes } = editor;

  useAtalho("desfazer", editor.desfazer, editor.podeDesfazer);
  useAtalho("refazer", editor.refazer, editor.podeRefazer);

  useAtalho("arte-apagar", () => {
    if (!camada || camada.bloqueada) return false;
    acoes.remover(camada);
    focarPalco();
  });
  useAtalho("arte-duplicar", () => {
    if (!camada) return false;
    acoes.duplicar(camada);
  });
  useAtalho("arte-copiar", () => {
    if (!camada || temTextoSelecionado()) return false;
    acoes.copiar(camada);
  });
  useAtalho("arte-colar", () => acoes.colar());

  useAtalho("arte-desselecionar", () => {
    if (!camada) return false;
    editor.selecionar(null);
  });

  const empurrar = (dx: number, dy: number) => (e?: KeyboardEvent) => {
    if (!camada || focoUsaSetas()) return false;
    const passo = e?.shiftKey ? 10 : 1;
    acoes.empurrar(camada, dx * passo, dy * passo);
  };
  useAtalho("arte-esquerda", empurrar(-1, 0));
  useAtalho("arte-direita", empurrar(1, 0));
  useAtalho("arte-cima", empurrar(0, -1));
  useAtalho("arte-baixo", empurrar(0, 1));
}

/** Deslizantes, grupos de opções e listas de seleção usam as setas; ali elas não empurram a camada. */
function focoUsaSetas() {
  const foco = document.activeElement;
  return foco instanceof HTMLInputElement || foco instanceof HTMLSelectElement || !!foco?.closest('[role="radiogroup"], [role="tablist"], [role="slider"]');
}

const temTextoSelecionado = () => !!window.getSelection()?.toString();
