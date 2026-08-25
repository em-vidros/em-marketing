/**
 * Snapshot imutável da marca (PRD §3.4).
 *
 * O `brandVersionId` sai do conteúdo, nunca do relógio nem de contador: a mesma
 * árvore devolve sempre o mesmo id, e qualquer byte editado em `brand/` ou
 * `styles/` devolve outro. É o que deixa um artefato dizer contra qual marca foi
 * produzido sem guardar cópia dela.
 */

import { readdirSync, readFileSync } from "node:fs";
import { sha256 } from "./imagem";
import type { ContextoMarca } from "./tipos";

export function carregarContextoMarca(): ContextoMarca {
  const brandbook = readFileSync("brand/BRANDBOOK.md", "utf8");
  const voz = readFileSync("brand/voice.md", "utf8");
  const tokensBrutos = readFileSync("brand/tokens.json", "utf8");

  const estilos: Record<string, string> = {};
  for (const arquivo of readdirSync("styles").filter((n) => n.endsWith(".md")).sort())
    estilos[arquivo.slice(0, -3)] = readFileSync(`styles/${arquivo}`, "utf8");

  const conteudo: Record<string, string> = {
    "brand/BRANDBOOK.md": brandbook,
    "brand/voice.md": voz,
    "brand/tokens.json": tokensBrutos,
  };
  for (const [id, md] of Object.entries(estilos)) conteudo[`styles/${id}.md`] = md;

  const pares = Object.keys(conteudo)
    .sort()
    .map((caminho) => `${caminho}:${sha256(conteudo[caminho]!)}`);

  return {
    brandVersionId: sha256(pares.join("\n")),
    brandbook,
    voz,
    tokens: JSON.parse(tokensBrutos),
    estilos,
  };
}
