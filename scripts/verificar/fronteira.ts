/**
 * Prova estrutural das fronteiras do DESIGN.md.
 *
 * Hoje o limite entre banco, modelo e árvore é uma convenção que alguém lembra na
 * revisão. Aqui ele vira build vermelho. Chave de API nova, ou um `bun:sqlite`
 * conveniente no meio de um worker, param no CI antes de virar dívida.
 */

import { readdirSync, readFileSync } from "node:fs";

interface Regra {
  nome: string;
  padrao: RegExp;
  permitido: readonly string[];
  motivo: string;
}

const REGRAS: readonly Regra[] = [
  {
    nome: "banco",
    padrao: /bun:sqlite/,
    permitido: ["src/controle/db.ts", "src/db/index.ts"],
    motivo: "só o módulo de banco abre conexão; o resto recebe as funções do controle",
  },
  {
    nome: "modelo",
    padrao: /@google\/genai|generativelanguage\.googleapis\.com|api\.deepseek\.com/,
    permitido: ["src/adaptadores/", "src/art/", "src/brain/", "src/caption/"],
    motivo: "SDK e host de modelo só em src/adaptadores/ e no bot v1 que cai na Fase 2",
  },
  {
    nome: "imutabilidade",
    padrao: /\bUPDATE\s+(events|approvals|artifact_versions)\b/i,
    permitido: [],
    motivo: "evento, aprovação e versão de artefato são append-only",
  },
];

/** As regras moram aqui como texto literal, então casariam contra si mesmas. */
const ESTE_ARQUIVO = "scripts/verificar/fronteira.ts";

function arquivosTs(raiz: string): string[] {
  return readdirSync(raiz, { recursive: true, encoding: "utf8" })
    .filter((n) => n.endsWith(".ts") && !n.includes("node_modules"))
    .map((n) => `${raiz}/${n}`)
    .sort();
}

const violacoes: string[] = [];

for (const caminho of [...arquivosTs("src"), ...arquivosTs("scripts")]) {
  if (caminho === ESTE_ARQUIVO) continue;
  const aplicaveis = REGRAS.filter(
    (r) => !r.permitido.some((p) => caminho === p || caminho.startsWith(p)),
  );
  readFileSync(caminho, "utf8")
    .split("\n")
    .forEach((linha, i) => {
      for (const regra of aplicaveis)
        if (regra.padrao.test(linha))
          violacoes.push(`${caminho}:${i + 1}  [${regra.nome}] ${regra.motivo}\n    ${linha.trim()}`);
    });
}

if (violacoes.length) {
  console.error(`fronteira: ${violacoes.length} violação(ões)\n`);
  for (const v of violacoes) console.error(v);
  process.exit(1);
}

console.log(`fronteira: ok — ${REGRAS.length} regras, nenhuma violação`);
