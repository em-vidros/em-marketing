/**
 * Predicado 1 do PRD §5.1: "um fluxo simulado sobrevive a uma reinicialização em
 * cada estado".
 *
 * Cada estado dos dois alfabetos ganha um processo filho que leva o fluxo até lá e
 * morre de SIGKILL, sem fechar o banco. Fechar limpo não exercita a recuperação do
 * WAL, que é justamente o que o predicado promete. O pai sobe o plano de novo
 * contra o mesmo arquivo e confere quatro coisas.
 *
 * Itera as chaves das tabelas de transição, então estado novo sem prova de
 * reinício quebra o build em vez de passar despercebido.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarControle } from "../../src/controle/api";
import { carregarAdaptadores } from "../../src/adaptadores/index";
import {
  TAREFA_DO_ESTADO,
  TRANSICOES_BLOG,
  TRANSICOES_INSTAGRAM,
  ehTerminal,
  transicoesDe,
  type EstadoQualquer,
  type TipoFluxo,
} from "../../src/modelos/tipos";
import type { FluxoId } from "../../src/modelos/tipos";

let falhas = 0;
function checar(cond: unknown, msg: string): void {
  if (cond) return;
  console.error(`FALHOU  ${msg}`);
  falhas++;
}

const raiz = mkdtempSync(join(tmpdir(), "reinicio-"));
const adaptadores = carregarAdaptadores();

/** Sobe o filho, espera o id do fluxo e mata com SIGKILL. */
async function derrubarEm(caminhoDb: string, artefatos: string, tipo: TipoFluxo, alvo: EstadoQualquer): Promise<FluxoId> {
  const filho = Bun.spawn(
    ["bun", "scripts/verificar/passo.ts", caminhoDb, artefatos, tipo, alvo],
    { stdout: "pipe", stderr: "pipe" },
  );
  const decodificador = new TextDecoder();
  let buffer = "";
  for await (const pedaco of filho.stdout as ReadableStream<Uint8Array>) {
    buffer += decodificador.decode(pedaco);
    const achado = buffer.match(/FLUXO=(\S+)/);
    if (achado) {
      filho.kill("SIGKILL");
      await filho.exited;
      return achado[1] as FluxoId;
    }
  }
  await filho.exited;
  const erro = await new Response(filho.stderr).text();
  throw new Error(`filho morreu sem chegar em ${tipo}/${alvo}: ${erro}`);
}

async function provar(tipo: TipoFluxo, alvo: EstadoQualquer): Promise<void> {
  const dir = mkdtempSync(join(raiz, `${tipo}-`));
  const caminhoDb = join(dir, "agencia.db");
  const artefatos = join(dir, "artefatos");

  const fluxoId = await derrubarEm(caminhoDb, artefatos, tipo, alvo);

  // criarControle abre o arquivo e reconcilia: esta linha é a reinicialização.
  const plano = criarControle({ caminhoDb, adaptadores, aprovadorId: 111, artefatosDir: artefatos });
  const rotulo = `${tipo}/${alvo}`;

  const depois = plano.inspecionar.fluxo(fluxoId);
  checar(depois?.estado === alvo, `${rotulo}: voltou em ${depois?.estado}, esperava ${alvo}`);

  const exigida = TAREFA_DO_ESTADO[alvo];
  const vivas = plano.inspecionar
    .tarefas(fluxoId)
    .filter((t) => t.estado === "pendente" || t.estado === "reivindicada");
  if (exigida) {
    const daVez = vivas.filter((t) => t.tipo === exigida);
    checar(daVez.length === 1, `${rotulo}: ${daVez.length} tarefas ${exigida} vivas, esperava 1`);
  } else {
    checar(vivas.length === 0, `${rotulo}: espera humana com ${vivas.length} tarefas vivas`);
  }

  const foto = () => JSON.stringify([plano.inspecionar.fluxo(fluxoId), plano.inspecionar.tarefas(fluxoId)]);
  const antes = foto();
  plano.reconciliar();
  checar(foto() === antes, `${rotulo}: reconciliar de novo mudou o estado`);

  if (!ehTerminal(alvo)) {
    const saidas = transicoesDe(tipo)[alvo] ?? [];
    checar(saidas.length > 0, `${rotulo}: não terminal e sem aresta de saída`);
  }

  plano.fechar();
  rmSync(dir, { recursive: true, force: true });
}

const alvos: [TipoFluxo, EstadoQualquer[]][] = [
  ["instagram", Object.keys(TRANSICOES_INSTAGRAM) as EstadoQualquer[]],
  ["blog", Object.keys(TRANSICOES_BLOG) as EstadoQualquer[]],
];

for (const [tipo, estados] of alvos) {
  for (const alvo of estados) {
    await provar(tipo, alvo);
    if (falhas === 0) console.log(`ok\t${tipo}: sobreviveu ao SIGKILL em ${alvo}`);
  }
}

rmSync(raiz, { recursive: true, force: true });

if (falhas) {
  console.error(`\nreinicio: ${falhas} falha(s)`);
  process.exit(1);
}
console.log(`\nreinicio: ok — ${alvos[0]![1].length + alvos[1]![1].length} estados, cada um com SIGKILL e volta`);
