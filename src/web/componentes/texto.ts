/**
 * Texto corrido de um Markdown, para as prévias de uma linha: sem #, **, crases, citações,
 * marcadores de lista e com o rótulo dos links no lugar do link.
 */
export function semMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|\*|_|`|~~)/g, "")
    .replace(/^\|?[\s:|-]+\|?$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
