/**
 * reconciliar() roda no boot e periodicamente, nesta ordem: expira lease
 * vencida, promove tarefa sem tentativa restante a revisão manual, e para cada
 * fluxo não terminal insere a tarefa que TAREFA_DO_ESTADO exige se ela não está
 * viva. Estado fora do mapa é espera humana e o reconciliador não tem nenhuma
 * aresta que entre ou saia de awaiting_* — nada aprova por tempo decorrido.
 * Rodar duas vezes seguidas não muda nada.
 */

import type { Banco } from "./db";
import { fluxosNaoTerminais } from "./fluxos";
import { expirarLeases, garantirTarefa, promoverEsgotadas } from "./tarefas";

export function reconciliar(db: Banco): void {
  const agora = new Date().toISOString();
  expirarLeases(db, agora);
  promoverEsgotadas(db);
  for (const fluxo of fluxosNaoTerminais(db)) {
    garantirTarefa(db, fluxo);
  }
}
