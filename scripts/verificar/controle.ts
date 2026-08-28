/**
 * Prova do commit "entregas idempotentes e reconciliador", com o plano montado
 * por criarControle e adaptadores falsos em memória: o reconciliador é
 * idempotente e não toca em awaiting_*, e executar a mesma entrega duas vezes
 * cria um documento só, com o hash do download conferido contra o mestre.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarControle } from "../../src/controle/api";
import { codificar } from "../../src/controle/aprovacoes";
import type { Adaptadores } from "../../src/adaptadores/tipos";
import type { VersaoId } from "../../src/modelos/tipos";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
}

const RICARDO = 111;
const naoUsado = () => Promise.reject(new Error("modelo não entra na fase 1 do arnês"));
const documentos = new Map<string, Buffer>();
const nomesEnviados: string[] = [];
let enviados = 0;
const adaptadores: Adaptadores = {
  criativo: { direcoes: naoUsado },
  redator: { legenda: naoUsado, angulos: naoUsado, artigo: naoUsado },
  designer: { gerar: naoUsado, editar: naoUsado },
  arte: { revisar: naoUsado },
  telegram: {
    enviarMensagem: async () => ({ message_id: 1 }),
    enviarAlbum: async () => ({ message_ids: [1] }),
    enviarFoto: async () => ({ message_id: 1 }),
    enviarDocumento: async (_chat, arquivo, nome) => {
      enviados++;
      nomesEnviados.push(nome);
      const fileId = `doc${enviados}`;
      documentos.set(fileId, Buffer.from(arquivo));
      return { message_id: enviados, file_id: fileId };
    },
    obterArquivo: async (fileId) => ({ file_path: fileId }),
    baixarArquivo: async (path) => documentos.get(path)!,
    responderCallback: async () => {},
  },
  linear: {
    criarIssue: async () => ({ id: "L1", url: "https://linear.app/x" }),
    comentar: async () => {},
    anexar: async () => ({ url: "https://linear.app/a" }),
    moverEstado: async () => {},
  },
};

const dir = mkdtempSync(join(tmpdir(), "em-mkt-controle-"));
const controle = criarControle({
  caminhoDb: join(dir, "t.db"),
  adaptadores,
  aprovadorId: RICARDO,
});
const { paraWorkers, paraTelegram, reconciliar, inspecionar } = controle;

const id = paraTelegram.criarFluxo({
  tipo: "instagram",
  chatId: 10,
  solicitanteId: RICARDO,
  pedido: { theme: "Fechamento de sacada", format: "feed" },
});
paraTelegram.confirmarBrief(id);

const foto = () =>
  JSON.stringify({ fluxo: inspecionar.fluxo(id), tarefas: inspecionar.tarefas(id), eventos: inspecionar.eventos(id).length });

// reconciliar cria a tarefa exigida e é idempotente
reconciliar();
const depoisDe1 = foto();
reconciliar();
assert(foto() === depoisDe1, "reconciliar duas vezes mudou algo");
assert(inspecionar.tarefas(id).some((t) => t.tipo === "direcao_criativa"), "reconciliar não criou a tarefa do estado");

function rodar(papel: Parameters<typeof paraWorkers.reivindicar>[0], conteudos: string[]): VersaoId[] {
  reconciliar();
  const t = paraWorkers.reivindicar(papel, `w-${papel}`);
  assert(t, `nada na fila para ${papel}`);
  const versoes = conteudos.map((c, i) =>
    paraWorkers.publicarArtefato(t.lease, {
      papel: papel === "diretor_de_arte" ? "qa" : papel === "diretor_criativo" ? "direcao" : "master",
      conteudo: Buffer.from(`${c}-${i}`),
      mediaTipo: papel === "designer" ? "image/png" : "application/json",
      ...(papel === "designer" ? { formato: "feed" as const } : {}),
    }),
  );
  assert(paraWorkers.bater(t.lease), "heartbeat com lease válida falhou");
  paraWorkers.concluir(t.lease, { tipo: "seguir", versoes });
  return versoes;
}

// pacote de contexto carrega marca e pedido congelados
reconciliar();
const atribuida = paraWorkers.reivindicar("diretor_criativo", "w-cc")!;
assert(atribuida.contexto.marca.brandbook.length > 0, "contexto sem brandbook");
assert(atribuida.contexto.pedido.theme === "Fechamento de sacada", "contexto sem pedido");
assert(atribuida.contexto.fluxoId === id && atribuida.contexto.chatId === 10, "contexto sem identidade do fluxo");
assert(atribuida.contexto.estado === "brief_confirmed" && atribuida.contexto.rodada === 1, "contexto sem estado e rodada");
assert(atribuida.visita === 1, `primeira tarefa do tipo veio na visita ${atribuida.visita}`);
paraWorkers.concluir(atribuida.lease, { tipo: "seguir", versoes: [paraWorkers.publicarArtefato(atribuida.lease, { papel: "direcao", conteudo: Buffer.from("d1"), mediaTipo: "application/json" })] });
assert(inspecionar.fluxo(id)!.estado === "directions_ready", "direção concluída não avançou o fluxo");

const masters = rodar("designer", ["m1", "m2", "m3"]);
rodar("diretor_de_arte", ["veredito"]);
paraTelegram.abrirRevisao(id, "prototype", masters);
assert(inspecionar.fluxo(id)!.estado === "awaiting_prototype_review", "revisão não abriu");

// em awaiting_* o reconciliador não cria tarefa nem mexe no estado
const tarefasAntes = inspecionar.tarefas(id).length;
reconciliar();
reconciliar();
assert(inspecionar.fluxo(id)!.estado === "awaiting_prototype_review", "reconciliador saiu de awaiting_*");
assert(inspecionar.tarefas(id).length === tarefasAntes, "reconciliador criou tarefa em espera humana");

// aceite do Ricardo pelo callback, formato único pula a revisão de pacote
const escolhido = masters[0]!;
const r = paraTelegram.aoCallback({
  deId: RICARDO,
  callbackId: "cb1",
  data: codificar({ fluxoId: id, stage: "prototype", acao: "aceitar", rodada: 1, opcao: escolhido }),
});
// pedido de Feed passa pela revisão de pacote, então o aceite do protótipo para
// em package_finalizing, não em prototype_approved
assert(r.ok && r.estado === "package_finalizing", `aceite parou em ${r.ok ? r.estado : r.motivo}`);

// o resto do caminho até a entrega é dos workers, que são outra suíte; aqui o
// arnês empurra por uma segunda conexão ao mesmo arquivo
const { abrirBanco } = await import("../../src/controle/db");
const { transicionar } = await import("../../src/controle/fluxos");
const db2 = abrirBanco(join(dir, "t.db"));
for (const passo of ["package_qa", "awaiting_package_review", "approved_for_manual_delivery"] as const) {
  transicionar(db2, { fluxoId: id, para: passo, ator: "arnes" });
}
db2.close();

// entrega: um documento, hash do download conferido contra o mestre
await paraTelegram.executarEntregas(id);
assert(enviados === 1, `entrega mandou ${enviados} documentos, esperava 1`);
const entregas = inspecionar.entregas(id);
assert(entregas.length === 1 && entregas[0]!.estado === "confirmada", "entrega não confirmou");
assert(typeof entregas[0]!.hashConferido === "string" && entregas[0]!.hashConferido.length === 64, "hash do ida e volta não gravou");
assert(inspecionar.fluxo(id)!.estado === "delivered", "entrega confirmada não marcou delivered");
assert(
  nomesEnviados[0] === "em-vidros-fechamento-de-sacada-feed-v1.png",
  `nome do documento fora do padrão da US-5: ${nomesEnviados[0]}`,
);

// executar de novo: nenhum reenvio, nenhuma linha nova
await paraTelegram.executarEntregas(id);
assert(enviados === 1, "segunda execução reenviou o documento");
assert(inspecionar.entregas(id).length === 1, "segunda execução criou outra entrega");

// arquivar fecha o ciclo
reconciliar();
const arquivo = paraWorkers.reivindicar("operacoes", "w-ops");
assert(arquivo && arquivo.tipo === "arquivar_linear", "delivered não exigiu arquivar_linear");
paraWorkers.concluir(arquivo.lease, { tipo: "seguir", versoes: [] });
assert(inspecionar.fluxo(id)!.estado === "archived", "arquivar não fechou o fluxo");

// cancelamento autorizado mata o trabalho vivo
const id2 = paraTelegram.criarFluxo({
  tipo: "blog",
  chatId: 10,
  solicitanteId: RICARDO,
  pedido: { theme: "Vidro laminado ou temperado?", format: "blog" },
});
paraTelegram.confirmarBrief(id2);
reconciliar();
let barrado = false;
try {
  paraTelegram.cancelar(id2, 999);
} catch {
  barrado = true;
}
assert(barrado, "estranho cancelou fluxo alheio");
paraTelegram.cancelar(id2, RICARDO);
assert(inspecionar.fluxo(id2)!.estado === "cancelled", "cancelamento não aplicou");
assert(
  inspecionar.tarefas(id2).every((t) => t.estado === "cancelada"),
  "cancelamento deixou tarefa viva",
);

controle.fechar();
rmSync(dir, { recursive: true, force: true });
console.log("ok: controle");
