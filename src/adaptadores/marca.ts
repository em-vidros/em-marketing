/**
 * Snapshot imutável da marca (PRD §3.4).
 *
 * O `brandVersionId` sai do conteúdo, nunca do relógio nem de contador: a mesma
 * árvore devolve sempre o mesmo id, e qualquer byte editado em `brand/` ou
 * `styles/` devolve outro. É o que deixa um artefato dizer contra qual marca foi
 * produzido sem guardar cópia dela.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import type { ContextoMarca } from "./tipos";

const hex = (texto: string) => createHash("sha256").update(texto, "utf8").digest("hex");

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
    .map((caminho) => `${caminho}:${hex(conteudo[caminho]!)}`);

  return {
    brandVersionId: hex(pares.join("\n")),
    brandbook,
    voz,
    tokens: JSON.parse(tokensBrutos),
    estilos,
  };
}
