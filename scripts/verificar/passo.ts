/**
 * Filho do reinicio.ts: leva um fluxo até o estado pedido e fica vivo esperando o
 * SIGKILL do pai.
 *
 * O caminho sai de uma busca em largura sobre a própria tabela de transição, então
 * estado novo no alfabeto passa a ser exercitado sem ninguém escrever caminho na
 * mão. Ele nunca sai limpo, e é isso que faz o WAL precisar de recuperação de
 * verdade na volta.
 *
 * Uso: bun scripts/verificar/passo.ts <db> <artefatos> <instagram|blog> <estado>
 */

import { abrirBanco } from "../../src/controle/db";
import { migrar } from "../../src/controle/migracoes";
import { criarFluxo, transicionar } from "../../src/controle/fluxos";
import {
  transicoesDe,
  type EstadoQualquer,
  type TipoFluxo,
} from "../../src/modelos/tipos";

/** Menor caminho de `requested` até o alvo, sobre as arestas legais do tipo. */
export function caminhoAte(tipo: TipoFluxo, alvo: EstadoQualquer): EstadoQualquer[] {
  const tabela = transicoesDe(tipo);
  const anterior = new Map<string, string>();
  const fila: string[] = ["requested"];
  const visto = new Set(fila);
  while (fila.length) {
    const atual = fila.shift()!;
    if (atual === alvo) break;
    for (const proximo of tabela[atual] ?? []) {
      if (visto.has(proximo)) continue;
      visto.add(proximo);
      anterior.set(proximo, atual);
      fila.push(proximo);
    }
  }
  if (alvo === "requested") return [];
  if (!visto.has(alvo)) throw new Error(`${tipo}: ${alvo} é inalcançável a partir de requested`);
  const caminho: EstadoQualquer[] = [];
  for (let no: string | undefined = alvo; no && no !== "requested"; no = anterior.get(no)) {
    caminho.unshift(no as EstadoQualquer);
  }
  return caminho;
}

const [caminhoDb, _artefatos, tipoBruto, alvoBruto] = process.argv.slice(2);
if (!caminhoDb || !tipoBruto || !alvoBruto) {
  console.error("uso: passo.ts <db> <artefatos> <instagram|blog> <estado>");
  process.exit(2);
}
const tipo = tipoBruto as TipoFluxo;
const alvo = alvoBruto as EstadoQualquer;

const db = abrirBanco(caminhoDb);
migrar(db);
const fluxoId = criarFluxo(db, {
  tipo,
  chatId: 900,
  solicitanteId: 111,
  pedido: {
    theme: `reinício em ${alvo}`,
    format: tipo === "blog" ? "blog" : "feed",
  },
});
for (const estado of caminhoAte(tipo, alvo)) {
  transicionar(db, { fluxoId, para: estado, ator: "arnes:passo" });
}

console.log(`FLUXO=${fluxoId}`);
// Nunca fecha o banco: o pai mata este processo para que a volta exercite o WAL.
await new Promise(() => {});
