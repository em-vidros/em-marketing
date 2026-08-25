/**
 * Prova do commit "transicionar com CAS e evento na mesma transação": aresta
 * ilegal lança e não escreve nada, CAS defasado lança FluxoDesatualizado sem
 * evento fantasma, e a transição legal grava estado e evento juntos.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco } from "../../src/controle/db";
import { migrar } from "../../src/controle/migracoes";
import {
  ArestaIlegal,
  FluxoDesatualizado,
  criarFluxo,
  lerFluxo,
  transicionar,
} from "../../src/controle/fluxos";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "em-mkt-transicoes-"));
const db = abrirBanco(join(dir, "t.db"));
migrar(db);

const id = criarFluxo(db, {
  tipo: "instagram",
  chatId: 10,
  solicitanteId: 20,
  pedido: { theme: "Dia do Vidraceiro", format: "feed" },
});
const eventos = () =>
  (db.query("SELECT COUNT(*) AS n FROM events WHERE workflow_id = ?").get(id) as { n: number }).n;
assert(lerFluxo(db, id)!.estado === "requested", "fluxo não nasce em requested");
const eventosAposCriar = eventos();

// aresta ilegal: nada muda
let lancou = false;
try {
  transicionar(db, { fluxoId: id, para: "delivered", ator: "teste" });
} catch (e) {
  lancou = e instanceof ArestaIlegal;
}
assert(lancou, "aresta ilegal não lançou ArestaIlegal");
assert(lerFluxo(db, id)!.estado === "requested", "aresta ilegal mudou o estado");
assert(eventos() === eventosAposCriar, "aresta ilegal gravou evento");

// aresta legal: estado, versao e evento na mesma transação
transicionar(db, { fluxoId: id, para: "brief_confirmed", ator: "telegram:20" });
const f1 = lerFluxo(db, id)!;
assert(f1.estado === "brief_confirmed" && f1.versao === 1, "transição legal não aplicou CAS");
assert(eventos() === eventosAposCriar + 1, "transição legal não gravou evento");

// CAS defasado: outro escritor passou na frente
lancou = false;
try {
  transicionar(db, {
    fluxoId: id,
    para: "directions_ready",
    ator: "teste",
    esperado: { estado: "brief_confirmed", versao: 0 },
  });
} catch (e) {
  lancou = e instanceof FluxoDesatualizado;
}
assert(lancou, "CAS defasado não lançou FluxoDesatualizado");
assert(lerFluxo(db, id)!.estado === "brief_confirmed", "CAS defasado mudou o estado");
assert(eventos() === eventosAposCriar + 1, "CAS defasado gravou evento");

// rodada e revisao_pendente andam junto com a aresta quando pedido
transicionar(db, { fluxoId: id, para: "directions_ready", ator: "teste" });
transicionar(db, { fluxoId: id, para: "prototypes_generating", ator: "teste" });
transicionar(db, { fluxoId: id, para: "prototype_qa", ator: "teste" });
transicionar(db, {
  fluxoId: id,
  para: "awaiting_prototype_review",
  ator: "teste",
  revisaoPendente: { stage: "prototype", rodada: 1, versoes: [] },
});
assert(lerFluxo(db, id)!.revisaoPendente?.stage === "prototype", "revisao_pendente não gravou");
transicionar(db, {
  fluxoId: id,
  para: "directions_ready",
  ator: "teste",
  incrementaRodada: true,
  revisaoPendente: null,
});
const f2 = lerFluxo(db, id)!;
assert(f2.rodada === 2, "incrementaRodada não somou");
assert(f2.revisaoPendente === null, "revisaoPendente: null não limpou");

// snapshot de marca é reusado por conteúdo
const id2 = criarFluxo(db, {
  tipo: "blog",
  chatId: 10,
  solicitanteId: 20,
  pedido: { theme: "Vidro temperado", format: "blog" },
});
const marcas = (db.query("SELECT COUNT(*) AS n FROM brand_versions").get() as { n: number }).n;
assert(marcas === 1, `marca inalterada gerou ${marcas} snapshots`);
assert(lerFluxo(db, id2)!.tipo === "blog", "fluxo de blog não persistiu o tipo");

db.close();
rmSync(dir, { recursive: true, force: true });
console.log("ok: transicoes");
