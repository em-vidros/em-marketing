/**
 * Um laço por papel: reivindicar, bater o coração enquanto o executor roda,
 * concluir ou falhar. O laço não sabe o que a tarefa faz e não escolhe aresta
 * nenhuma; ele cuida da lease e da classificação do erro.
 *
 * Perder a lease é silêncio, não erro: quem reivindicou depois já está fazendo o
 * trabalho, e um zumbi barulhento só encheria o chat do Ricardo. Falha
 * permanente e efeito indeterminado vão direto para a fila de revisão manual;
 * qualquer outro erro é transitório e respeita max_tentativas.
 *
 * O aviso sai na primeira falha e na última, dizendo se ainda vai tentar de novo
 * (US-9). Três avisos por tarefa num incidente de rede seria ruído. Quem manda a
 * mensagem é o chamador: o laço não fala com o Telegram.
 */

import { readFileSync } from "node:fs";
import tokens from "../../brand/tokens.json";
import type { Adaptadores } from "../adaptadores/tipos";
import type { ControlePlano } from "../controle/api";
import { EfeitoIndeterminado } from "../controle/idempotencia";
import { LeasePerdida } from "../controle/tarefas";
import type { FluxoId, Papel, TipoTarefa } from "../modelos/tipos";
import { EXECUTORES, FalhaPermanente } from "./executores";

export { FalhaPermanente } from "./executores";

const HEARTBEAT_MS = 20_000;
const INTERVALO_PADRAO_MS = 1_000;
/** Cerca do arnês: laço que não converge é defeito, e travar a suíte esconde o defeito. */
const TETO_PASSOS = 500;

export type AoFalhar = (
  fluxoId: FluxoId,
  chatId: number,
  tipo: TipoTarefa,
  mensagem: string,
  vaiTentarDeNovo: boolean,
) => void;

export interface OpcoesWorkers {
  readonly controle: ControlePlano;
  readonly adaptadores: Adaptadores;
  readonly papeis: readonly Papel[];
  readonly intervaloMs?: number;
  readonly aoFalhar?: AoFalhar;
}

const logos = new Map<string, Buffer>();

function logo(variante: "cor" | "branco"): Buffer {
  const caminho = variante === "branco" ? tokens.assets.logoWhite : tokens.assets.logoColor;
  const guardado = logos.get(caminho);
  if (guardado) return guardado;
  const bytes = readFileSync(caminho);
  logos.set(caminho, bytes);
  return bytes;
}

/** Devolve true quando havia tarefa para este papel, tenha ela dado certo ou não. */
async function executarUma(papel: Papel, o: OpcoesWorkers, comBatida: boolean): Promise<boolean> {
  const tarefa = o.controle.reivindicar(papel, `worker:${papel}`);
  if (!tarefa) return false;

  const abortador = new AbortController();
  const batida = comBatida
    ? setInterval(() => {
        if (!o.controle.bater(tarefa.lease)) abortador.abort();
      }, HEARTBEAT_MS)
    : null;

  try {
    const saida = await EXECUTORES[tarefa.tipo]({
      tarefa,
      controle: o.controle,
      adaptadores: o.adaptadores,
      logo,
      sinal: abortador.signal,
    });
    if (saida.tipo !== "fechada") o.controle.concluir(tarefa.lease, saida);
  } catch (erro) {
    if (erro instanceof LeasePerdida) return true;
    const permanente = erro instanceof FalhaPermanente || erro instanceof EfeitoIndeterminado;
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    let parou: "pendente" | "revisao_manual";
    try {
      parou = o.controle.falhar(tarefa.lease, {
        tipo: permanente ? "permanente" : "transitoria",
        mensagem,
      });
    } catch (segundo) {
      if (segundo instanceof LeasePerdida) return true;
      throw segundo;
    }
    const vaiTentarDeNovo = parou === "pendente";
    if (tarefa.tentativa === 1 || !vaiTentarDeNovo) {
      o.aoFalhar?.(tarefa.fluxoId, tarefa.contexto.chatId, tarefa.tipo, mensagem, vaiTentarDeNovo);
    }
  } finally {
    if (batida) clearInterval(batida);
  }
  return true;
}

export function iniciarWorkers(o: OpcoesWorkers): { parar(): void } {
  let parado = false;
  let acordar: (() => void) | null = null;
  const intervalo = o.intervaloMs ?? INTERVALO_PADRAO_MS;

  const dormir = () =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, intervalo);
      acordar = () => {
        clearTimeout(t);
        resolve();
      };
    });

  for (const papel of o.papeis) {
    void (async () => {
      while (!parado) {
        let achou = false;
        try {
          achou = await executarUma(papel, o, true);
        } catch (erro) {
          console.error(`worker ${papel} caiu fora do executor: ${erro}`);
        }
        if (!achou && !parado) await dormir();
      }
    })();
  }

  return {
    parar() {
      parado = true;
      acordar?.();
    },
  };
}

/**
 * Roda todos os papéis até nenhuma tarefa ser reivindicável. Sem timers e sem
 * heartbeat: é o modo do arnês, onde o tempo não passa e a lease nunca vence
 * sozinha. Reconcilia antes de cada passada, porque quem cria tarefa é o
 * reconciliador, e sem ele o segundo estado do fluxo nunca chegaria à fila.
 */
export async function rodarAteEsvaziar(o: OpcoesWorkers): Promise<number> {
  let total = 0;
  for (let passo = 0; passo < TETO_PASSOS; passo++) {
    o.controle.reconciliar();
    let algum = false;
    for (const papel of o.papeis) {
      while (await executarUma(papel, o, false)) {
        algum = true;
        total++;
      }
    }
    if (!algum) return total;
  }
  throw new Error(`rodarAteEsvaziar passou de ${TETO_PASSOS} passadas sem esvaziar a fila`);
}
