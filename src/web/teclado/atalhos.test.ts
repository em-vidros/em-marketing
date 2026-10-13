import { describe, expect, test } from "bun:test";
import { ATALHOS, type Atalho, type Escopo, IDS_DE_ATALHO, sequencia } from "./atalhos";
import { criarDespachante } from "./motor";

/** Escopos que valem ao mesmo tempo: global soma com um só dos outros. */
const JUNTOS: Escopo[][] = [
  ["global", "lista"],
  ["global", "conversa"],
  ["global", "calendario"],
];

describe("tabela de atalhos", () => {
  test("nenhuma tecla tem dois donos, nem é prefixo de outra, entre escopos que valem juntos", () => {
    const conflitos: string[] = [];
    for (const escopos of JUNTOS) {
      const seqs = IDS_DE_ATALHO.flatMap((id) => {
        const a: Atalho = ATALHOS[id];
        return escopos.includes(a.escopo) ? a.teclas.map((t) => ({ id, seq: sequencia(t) })) : [];
      });
      for (const x of seqs)
        for (const y of seqs) {
          if (x === y) continue;
          const curta = x.seq.length <= y.seq.length ? x : y;
          const longa = curta === x ? y : x;
          if (curta.seq.every((c, i) => longa.seq[i] === c)) conflitos.push(`${x.id} × ${y.id}`);
        }
    }
    expect(conflitos).toEqual([]);
  });
});

describe("despachante", () => {
  const tecla = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  const div = { tagName: "DIV", closest: () => null };
  const input = { tagName: "INPUT", type: "text", closest: () => null };
  const editavel = { tagName: "DIV", isContentEditable: true, closest: () => null };
  const textarea = { tagName: "TEXTAREA", closest: () => null };

  test("tecla simples digitada num campo é texto, não atalho", () => {
    for (const campo of [input, editavel, textarea]) {
      const d = criarDespachante(true, () => true);
      expect(d(tecla("c"), campo, 0)).toBeNull();
      expect(d(tecla("?", { shiftKey: true }), campo, 0)).toBeNull();
      expect(d(tecla("g"), campo, 0)).toBeNull();
      expect(d(tecla("a"), campo, 10)).toBeNull();
      expect(d(tecla("Backspace", { metaKey: true }), campo, 20)).toBeNull();
    }
  });

  test("fora de campo a mesma tecla dispara, e ⌘K vale até dentro do campo", () => {
    const d = criarDespachante(true, () => true);
    expect(d(tecla("c"), div, 0)).toBe("nova-conversa");
    expect(d(tecla("k", { metaKey: true }), input, 0)).toBe("paleta");
  });

  test("G depois A navega; a sequência expira se a segunda tecla demora", () => {
    const d = criarDespachante(true, () => true);
    expect(d(tecla("g"), div, 0)).toBeNull();
    expect(d(tecla("a"), div, 300)).toBe("ir-atividade");
    expect(d(tecla("g"), div, 1000)).toBeNull();
    expect(d(tecla("b"), div, 5000)).toBeNull();
  });

  test("R renomeia na lista e recusa dentro de um cartão de conversa", () => {
    const d = criarDespachante(true, () => true);
    const cartao = { tagName: "ARTICLE", closest: (s: string) => (s.includes("conversa") ? {} : null) };
    expect(d(tecla("r"), div, 0)).toBe("conversa-renomear");
    expect(d(tecla("r"), cartao, 0)).toBe("recusar");
  });

  test("dentro do calendário as setas andam pelos dias, e fora dele pela lista de conversas", () => {
    const d = criarDespachante(true, () => true);
    const calendario = { tagName: "DIV", closest: (s: string) => (s.includes("calendario") ? {} : null) };
    expect(d(tecla("ArrowDown"), calendario, 0)).toBe("cal-baixo");
    expect(d(tecla("ArrowDown"), div, 0)).toBe("lista-proxima");
    expect(d(tecla("ArrowRight", { altKey: true }), calendario, 0)).toBe("cal-mover-depois");
  });
});
