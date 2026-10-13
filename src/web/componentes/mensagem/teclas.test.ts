import { describe, expect, test } from "bun:test";
import { criarDespachante } from "../../teclado/motor";
import { editaAoSubir } from "./teclas";

const tecla = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("teclas das mensagens", () => {
  test("↑ só edita a última mensagem com o composer vazio", () => {
    expect(editaAoSubir(tecla("ArrowUp"), "", true)).toBe(true);
    expect(editaAoSubir(tecla("ArrowUp"), "quase pronto", true)).toBe(false);
    expect(editaAoSubir(tecla("ArrowUp", { shiftKey: true }), "", true)).toBe(false);
  });

  test("E e ⌘⌫ agem na mensagem focada no transcript, na conversa fora dele, e em nada enquanto a pessoa digita", () => {
    const naConversa = (s: string) => (s.includes("conversa") ? {} : null);
    const mensagem = { tagName: "ARTICLE", closest: naConversa };
    const editor = { tagName: "TEXTAREA", closest: naConversa };
    const d = criarDespachante(true, () => true);
    expect(d(tecla("e"), mensagem, 0)).toBe("mensagem-editar");
    expect(d(tecla("e"), editor, 0)).toBeNull();
    expect(d(tecla("Backspace", { metaKey: true }), editor, 0)).toBeNull();
    expect(d(tecla("Backspace", { metaKey: true }), mensagem, 0)).toBe("mensagem-apagar");
    const linha = { tagName: "A", closest: () => null };
    expect(d(tecla("e"), linha, 0)).toBe("conversa-arquivar");
    expect(d(tecla("Backspace", { metaKey: true }), linha, 0)).toBe("conversa-excluir");
  });
});
