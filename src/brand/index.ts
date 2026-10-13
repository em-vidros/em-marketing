import { readFileSync } from "node:fs";
import tokens from "../../brand/tokens.json";

export { tokens };

/**
 * brand/BRANDBOOK.md é normativo e tem ~42 KB. Injetá-lo inteiro em todo turno do
 * cérebro custaria ~12k tokens por hop, até 8 hops por mensagem. Em vez disso,
 * cada consumidor pede só os capítulos que aplica:
 *   - cérebro  → conversa e conteúdo (1, 9, 10, 11, 12, 13, 16)
 *   - legenda  → voz e sistema de legenda (1, 9, 10, 11)
 *   - arte     → identidade visual (3, 4, 5, 6, 7, 8)
 * Os capítulos visuais viram prompt de imagem em styles/, não texto de conversa.
 */

let _raw: string | null = null;
export function brandbook(): string {
  return (_raw ??= readFileSync("brand/BRANDBOOK.md", "utf8"));
}

/** Índice capítulo → texto, construído uma vez a partir dos headings `# N. Título`. */
let _chapters: Map<number, string> | null = null;
function chapters(): Map<number, string> {
  if (_chapters) return _chapters;
  const map = new Map<number, string>();
  const src = brandbook();
  const heading = /^# (\d+)\.\s.*$/gm;
  const hits: { num: number; start: number }[] = [];
  for (const m of src.matchAll(heading)) hits.push({ num: Number(m[1]), start: m.index! });
  hits.forEach((h, i) => {
    const end = hits[i + 1]?.start ?? src.length;
    map.set(h.num, src.slice(h.start, end).trimEnd());
  });
  return (_chapters = map);
}

/** Concatena os capítulos pedidos, na ordem pedida. Capítulo ausente lança — é erro de código. */
export function capitulos(...nums: number[]): string {
  const c = chapters();
  return nums
    .map((n) => {
      const txt = c.get(n);
      if (!txt) throw new Error(`Capítulo ${n} não encontrado em brand/BRANDBOOK.md`);
      return txt;
    })
    .join("\n\n");
}

/** Voz, legenda, emoji e hashtag — o que escreve texto precisa. */
export const VOZ = () => capitulos(1, 9, 10, 11);

/** O que o cérebro precisa para conduzir a conversa e decidir conteúdo. */
export const CONVERSA = () => capitulos(1, 9, 10, 11, 12, 13, 16);

/** Identidade visual — para quem monta prompt de arte. */
export const VISUAL = () => capitulos(3, 4, 5, 6, 7, 8);
