/**
 * Prova do commit "aprovação ligada ao Telegram do Ricardo": codec sobrevive a
 * entrada hostil, revisor errado não escreve nada, botão de rodada velha é
 * recusado, duplo toque vira uma linha só e executarUmaVez roda o efeito uma vez.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco } from "../../src/controle/db";
import { migrar } from "../../src/controle/migracoes";
import { criarFluxo, lerFluxo, transicionar } from "../../src/controle/fluxos";
import { garantirTarefa, reivindicar, concluir } from "../../src/controle/tarefas";
import { publicarArtefato } from "../../src/controle/artefatos";
import { codificar, decodificar, decidir, validarCallback } from "../../src/controle/aprovacoes";
import { abrirRevisao } from "../../src/controle/revisoes";
import {
  EfeitoIndeterminado,
  TETO_TENTATIVAS,
  TetoDeTentativas,
  executarUmaVez,
} from "../../src/controle/idempotencia";
import type { Papel, VersaoId } from "../../src/modelos/tipos";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "em-mkt-aprovacao-"));
const db = abrirBanco(join(dir, "t.db"));
const artefatosDir = join(dir, "artefatos");
migrar(db);

const RICARDO = 111;
const INTRUSO = 999;

// codec: ida e volta, e null para qualquer coisa malformada
const fluxoFake = "0123456789ab" as never;
const opcaoFake = "zzzzzzzzzzzz" as never;
for (const cb of [
  { fluxoId: fluxoFake, stage: "prototype", acao: "aceitar", rodada: 1, opcao: opcaoFake },
  { fluxoId: fluxoFake, stage: "package", acao: "ajustar", rodada: 42 },
  { fluxoId: fluxoFake, stage: "copy", acao: "encerrar", rodada: 9999 },
  { fluxoId: fluxoFake, stage: "angle", acao: "recusar_todas", rodada: 3 },
  { fluxoId: fluxoFake, stage: "prototype", acao: "cancelar", rodada: 1 },
] as const) {
  const data = codificar(cb);
  assert(Buffer.byteLength(data) <= 64, `codificado passou de 64 bytes: ${data}`);
  assert(JSON.stringify(decodificar(data)) === JSON.stringify(cb), `ida e volta quebrou: ${data}`);
}
for (const lixo of [
  null,
  42,
  "",
  "a|0123456789ab|p|a|1",
  "b|0123456789ab|p|a|1|",
  "a|0123456789AB|p|a|1|",
  "a|0123456789ab|z|a|1|",
  "a|0123456789ab|p|q|1|",
  "a|0123456789ab|p|a|0|",
  "a|0123456789ab|p|a|1|curta",
  "a|0123456789ab|p|a|99999|",
  `a|0123456789ab|p|a|1|${"x".repeat(50)}`,
  "a|0123456789ab|p|a|1|zzzzzzzzzzzé",
]) {
  assert(decodificar(lixo) === null, `lixo decodificou: ${JSON.stringify(lixo)}`);
}

// fluxo até a primeira revisão de protótipos
const id = criarFluxo(db, {
  tipo: "instagram",
  chatId: 10,
  solicitanteId: RICARDO,
  pedido: { theme: "Guarda-corpo de vidro", format: "feed" },
});
transicionar(db, { fluxoId: id, para: "brief_confirmed", ator: "teste" });
transicionar(db, { fluxoId: id, para: "directions_ready", ator: "teste" });
transicionar(db, { fluxoId: id, para: "prototypes_generating", ator: "teste" });

function rodarTarefa(papel: Papel, conteudos: string[], derivadaDe?: VersaoId): VersaoId[] {
  garantirTarefa(db, lerFluxo(db, id)!);
  const t = reivindicar(db, papel, "w")!;
  const lease = { tarefaId: t.id, epoca: t.leaseEpoca };
  const versoes = conteudos.map((c) =>
    publicarArtefato(db, artefatosDir, lease, {
      papel: papel === "diretor_de_arte" ? "qa" : "prototipo",
      conteudo: Buffer.from(c),
      mediaTipo: papel === "diretor_de_arte" ? "application/json" : "image/png",
      ...(derivadaDe ? { derivadaDe } : {}),
    }),
  );
  concluir(db, lease, { tipo: "seguir", versoes });
  return versoes;
}

const protos = rodarTarefa("designer", ["p1", "p2", "p3"]);
rodarTarefa("diretor_de_arte", ['{"aprovada":true}']);
abrirRevisao(db, id, "prototype", protos);
assert(lerFluxo(db, id)!.estado === "awaiting_prototype_review", "revisão não abriu");

const aprovacoes = () => (db.query("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n;
const botao = (acao: "aceitar" | "ajustar" | "recusar_todas" | "encerrar" | "cancelar", rodada: number, opcao?: VersaoId) =>
  codificar({ fluxoId: id, stage: "prototype", acao, rodada, ...(opcao ? { opcao } : {}) });

// revisor errado: recusa antes de qualquer escrita
let r = decidir(db, { deId: INTRUSO, aprovadorId: RICARDO, data: botao("aceitar", 1, protos[0]) });
assert(!r.ok && r.motivo === "nao_autorizado", "intruso não caiu em nao_autorizado");
assert(aprovacoes() === 0, "intruso escreveu approval");

// rodada que não é a atual: vencida
r = decidir(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("aceitar", 2, protos[0]) });
assert(!r.ok && r.motivo === "aprovacao_vencida", "rodada futura não caiu em aprovacao_vencida");

// ajustar no protótipo exige a opção: sem ela o designer não teria base para editar
r = decidir(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("ajustar", 1), notas: "menos texto" });
assert(!r.ok && r.motivo === "callback_invalido", "ajustar sem opção passou");

// validarCallback é a mesma porta sem escrever nada
const antesDeValidar = aprovacoes();
const v = validarCallback(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("ajustar", 1, protos[0]) });
assert(v.ok && v.callback.acao === "ajustar" && v.revisao.versoes.length === 3, "validarCallback recusou botão válido");
assert(aprovacoes() === antesDeValidar, "validarCallback escreveu approval");
assert(
  !validarCallback(db, { deId: INTRUSO, aprovadorId: RICARDO, data: botao("ajustar", 1, protos[0]) }).ok,
  "validarCallback deixou o intruso passar",
);

// ajustar: uma linha, rodada vira 2, fluxo volta a gerar na mesma transação
r = decidir(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("ajustar", 1, protos[0]), notas: "menos texto" });
assert(r.ok && r.estado === "prototypes_generating", "ajustar não voltou a prototypes_generating");
const f1 = lerFluxo(db, id)!;
assert(f1.rodada === 2 && f1.revisaoPendente === null, "ajustar não fechou a rodada");
assert(aprovacoes() === 1, "ajustar não gravou exatamente uma approval");

// sem revisão aberta, qualquer botão é incompatível
r = decidir(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("ajustar", 1, protos[0]) });
assert(!r.ok && r.motivo === "estado_incompativel", "botão sem revisão aberta passou");

// rodada 2: revisão nova, e o botão do álbum antigo ficou uma rodada atrás
const [v4] = rodarTarefa("designer", ["p1-ajustado"], protos[0]);
rodarTarefa("diretor_de_arte", ['{"aprovada":true,"r":2}']);
abrirRevisao(db, id, "prototype", [v4!]);
r = decidir(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("ajustar", 1, protos[0]) });
assert(!r.ok && r.motivo === "aprovacao_vencida", "botão de rodada velha não foi recusado");

// aceitar exige opção, e opção da rodada velha não cobre a atual
r = decidir(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("aceitar", 2) });
assert(!r.ok && r.motivo === "callback_invalido", "aceitar sem opção passou");
r = decidir(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("aceitar", 2, protos[1]) });
assert(!r.ok && r.motivo === "aprovacao_vencida", "opção fora da revisão atual passou");

// aceitar de verdade, e o duplo toque vira no-op
r = decidir(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("aceitar", 2, v4) });
assert(r.ok && r.estado === "package_finalizing", `aceitar em pedido de Feed parou em ${r.ok ? r.estado : r.motivo}`);
const aceite = db
  .query("SELECT artifact_version_ids, opcao, reviewer_id FROM approvals WHERE decision = 'accepted'")
  .all() as { artifact_version_ids: string; opcao: string; reviewer_id: number }[];
assert(aceite.length === 1 && aceite[0]!.opcao === v4 && aceite[0]!.reviewer_id === RICARDO, "aceite não registrou a opção");
assert(JSON.parse(aceite[0]!.artifact_version_ids)[0] === v4, "aceite não copiou as versões cobertas");
r = decidir(db, { deId: RICARDO, aprovadorId: RICARDO, data: botao("aceitar", 2, v4) });
assert(!r.ok, "duplo toque virou segunda decisão");
assert(aprovacoes() === 2, `duplo toque deixou ${aprovacoes()} linhas, esperava 2`);

// executarUmaVez: efeito roda uma vez; chave reservada sem resultado é indeterminada
let rodou = 0;
const efeito = async () => {
  rodou++;
  return { message_id: 7 };
};
const u1 = await executarUmaVez(db, "entrega:x", efeito);
const u2 = await executarUmaVez(db, "entrega:x", efeito);
assert(u1.novo && !u2.novo && rodou === 1, "efeito rodou mais de uma vez");
assert(u2.resultado.message_id === 7, "resultado guardado não voltou");
db.query("INSERT INTO idempotency_keys (chave) VALUES ('entrega:morta')").run();
let lancou = false;
try {
  await executarUmaVez(db, "entrega:morta", efeito);
} catch (e) {
  lancou = e instanceof EfeitoIndeterminado;
}
assert(lancou && rodou === 1, "chave reservada sem resultado não caiu em EfeitoIndeterminado");

// repetirSeFalhou: chave com erro gravado roda de novo, e o teto fecha o laço
let quebrado = 0;
const quebra = async (): Promise<{ ok: boolean }> => {
  quebrado++;
  throw new Error("telegram fora do ar");
};
for (let i = 1; i <= TETO_TENTATIVAS; i++) {
  let caiu = false;
  try {
    await executarUmaVez(db, "album:x", quebra, { repetirSeFalhou: true });
  } catch (e) {
    caiu = !(e instanceof TetoDeTentativas);
  }
  assert(caiu, `tentativa ${i} de album:x não repetiu o efeito`);
}
assert(quebrado === TETO_TENTATIVAS, `efeito repetível rodou ${quebrado} vezes, esperava ${TETO_TENTATIVAS}`);
let noTeto = false;
try {
  await executarUmaVez(db, "album:x", quebra, { repetirSeFalhou: true });
} catch (e) {
  noTeto = e instanceof TetoDeTentativas;
}
assert(noTeto && quebrado === TETO_TENTATIVAS, "teto de tentativas não segurou a chave");

// reserva fresca sem erro é efeito em voo: nem o repetível encosta nela
db.query("INSERT INTO idempotency_keys (chave, tentativas, reservado_em) VALUES ('album:voo', 1, datetime('now'))").run();
let emVoo = false;
try {
  await executarUmaVez(db, "album:voo", quebra, { repetirSeFalhou: true });
} catch (e) {
  emVoo = e instanceof EfeitoIndeterminado && !(e instanceof TetoDeTentativas);
}
assert(emVoo, "reserva fresca sem erro foi repetida");

// reserva velha sem erro é processo morto no meio: aí repete
db.query("UPDATE idempotency_keys SET reservado_em = datetime('now', '-11 minutes') WHERE chave = 'album:voo'").run();
const revivida = await executarUmaVez(db, "album:voo", async () => ({ message_id: 9 }), { repetirSeFalhou: true });
assert(revivida.novo && revivida.resultado.message_id === 9, "reserva vencida não foi retomada");

db.close();
rmSync(dir, { recursive: true, force: true });
console.log("ok: aprovacao");
