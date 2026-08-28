/**
 * Prova do commit "fila com lease e época": o estado exige a tarefa, reivindicar
 * é atômico e devolve época nova, e o zumbi cujo lease venceu e foi reivindicado
 * por outro é recusado em bater, concluir e falhar.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco } from "../../src/controle/db";
import { migrar } from "../../src/controle/migracoes";
import { criarFluxo, lerFluxo, transicionar } from "../../src/controle/fluxos";
import {
  LeasePerdida,
  bater,
  concluir,
  expirarLeases,
  falhar,
  garantirTarefa,
  lerTarefa,
  promoverEsgotadas,
  reivindicar,
  visitaDaTarefa,
} from "../../src/controle/tarefas";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "em-mkt-lease-"));
const db = abrirBanco(join(dir, "t.db"));
migrar(db);

const id = criarFluxo(db, {
  tipo: "instagram",
  chatId: 10,
  solicitanteId: 20,
  pedido: { theme: "Box de banheiro", format: "feed" },
});
transicionar(db, { fluxoId: id, para: "brief_confirmed", ator: "teste" });

// o estado exige a tarefa; garantir duas vezes não duplica
const t1 = garantirTarefa(db, lerFluxo(db, id)!);
assert(t1, "brief_confirmed não gerou tarefa de direção criativa");
assert(garantirTarefa(db, lerFluxo(db, id)!) === null, "garantirTarefa duplicou tarefa viva");

// papel errado não leva nada; papel certo leva com época 1
assert(reivindicar(db, "designer", "w0") === null, "designer levou tarefa de diretor criativo");
const a = reivindicar(db, "diretor_criativo", "wA");
assert(a && a.id === t1 && a.leaseEpoca === 1 && a.tentativas === 1, "reivindicação não devolveu época 1");
assert(reivindicar(db, "diretor_criativo", "wB") === null, "tarefa reivindicada foi reivindicada de novo");
assert(bater(db, { tarefaId: a.id, epoca: a.leaseEpoca }), "bater com lease válida falhou");

// lease vence, tarefa volta à fila, outro worker leva com época 2
db.query("UPDATE tasks SET lease_expira_em = '2000-01-01T00:00:00Z' WHERE id = ?").run(a.id);
assert(expirarLeases(db, new Date().toISOString()) === 1, "lease vencida não expirou");
assert(expirarLeases(db, new Date().toISOString()) === 0, "expirar de novo mexeu em algo");
const b = reivindicar(db, "diretor_criativo", "wB");
assert(b && b.id === t1 && b.leaseEpoca === 2, "reivindicação nova não incrementou a época");

// o zumbi wA é recusado nas três portas, e a saída dele é descartada
assert(!bater(db, { tarefaId: a.id, epoca: 1 }), "zumbi bateu coração com época velha");
for (const golpe of [
  () => concluir(db, { tarefaId: a.id, epoca: 1 }, { tipo: "seguir", versoes: [] }),
  () => falhar(db, { tarefaId: a.id, epoca: 1 }, { tipo: "transitoria", mensagem: "x" }),
]) {
  let lancou = false;
  try {
    golpe();
  } catch (e) {
    lancou = e instanceof LeasePerdida;
  }
  assert(lancou, "zumbi com época velha não foi recusado");
}
assert(lerTarefa(db, a.id)!.estado === "reivindicada", "golpe do zumbi mudou a tarefa");

// o dono verdadeiro conclui, e a conclusão avança o fluxo pela aresta determinística
concluir(db, { tarefaId: b.id, epoca: 2 }, { tipo: "seguir", versoes: [], resumo: "3 direções" });
assert(lerFluxo(db, id)!.estado === "directions_ready", "conclusão não avançou para directions_ready");

// reivindicar o design em directions_ready marca trabalho em curso
garantirTarefa(db, lerFluxo(db, id)!);
const d = reivindicar(db, "designer", "wD");
assert(d && d.tipo === "design_prototipos", "directions_ready não gerou tarefa de design");
assert(lerFluxo(db, id)!.estado === "prototypes_generating", "reivindicar o design não marcou prototypes_generating");

// falha transitória volta à fila; esgotar tentativas promove a revisão manual
falhar(db, { tarefaId: d.id, epoca: d.leaseEpoca }, { tipo: "transitoria", mensagem: "timeout" });
assert(lerTarefa(db, d.id)!.estado === "pendente", "falha transitória não devolveu à fila");
db.query("UPDATE tasks SET tentativas = max_tentativas WHERE id = ?").run(d.id);
assert(promoverEsgotadas(db) === 1, "tarefa esgotada não foi promovida");
assert(promoverEsgotadas(db) === 0, "promover de novo mexeu em algo");
assert(lerTarefa(db, d.id)!.estado === "revisao_manual", "tarefa esgotada não está em revisao_manual");

// falha permanente vai direto para revisão manual, e diz onde a tarefa parou
db.query("UPDATE tasks SET estado = 'pendente', tentativas = 1 WHERE id = ?").run(d.id);
const e2 = reivindicar(db, "designer", "wE")!;
const parou = falhar(db, { tarefaId: e2.id, epoca: e2.leaseEpoca }, { tipo: "permanente", mensagem: "schema inválido" });
assert(parou === "revisao_manual", `falha permanente devolveu ${parou}`);
assert(lerTarefa(db, d.id)!.estado === "revisao_manual", "falha permanente não foi para revisao_manual");

// tarefa parada em revisao_manual conta como viva: recriar por baixo daria a
// volta no teto de tentativas em silêncio
assert(garantirTarefa(db, lerFluxo(db, id)!) === null, "garantirTarefa passou por cima de revisao_manual");

// chave com contador de visitas: o laço de QA volta ao mesmo estado na mesma
// rodada e a segunda tarefa precisa caber
db.query("UPDATE tasks SET estado = 'concluida' WHERE id = ?").run(d.id);
const t2 = garantirTarefa(db, lerFluxo(db, id)!);
assert(t2, "segunda visita ao mesmo estado não criou tarefa");
const chaves = (
  db.query("SELECT chave_idempotencia AS c FROM tasks WHERE workflow_id = ? AND tipo = 'design_prototipos' ORDER BY rowid").all(id) as { c: string }[]
).map((l) => l.c);
assert(
  JSON.stringify(chaves) === JSON.stringify([`${id}:directions_ready:1:1`, `${id}:prototypes_generating:1:2`]),
  `chaves de tarefa fora do formato fluxo:estado:rodada:n: ${chaves.join(" ")}`,
);
const claim = reivindicar(db, "designer", "wF")!;
assert(visitaDaTarefa(db, claim) === 2, "a segunda visita não contou 2");

// voltar do controle de qualidade não anda com a rodada
concluir(db, { tarefaId: claim.id, epoca: claim.leaseEpoca }, { tipo: "seguir", versoes: [] });
assert(lerFluxo(db, id)!.estado === "prototype_qa", "design concluído não foi para prototype_qa");
garantirTarefa(db, lerFluxo(db, id)!);
const qa = reivindicar(db, "diretor_de_arte", "wQ")!;
concluir(db, { tarefaId: qa.id, epoca: qa.leaseEpoca }, { tipo: "voltar", versoes: [], motivo: "duas direções reprovadas" });
const depoisDaVolta = lerFluxo(db, id)!;
assert(depoisDaVolta.estado === "prototypes_generating", `voltar levou a ${depoisDaVolta.estado}`);
assert(depoisDaVolta.rodada === 1, "voltar incrementou a rodada");

db.close();
rmSync(dir, { recursive: true, force: true });
console.log("ok: lease");
