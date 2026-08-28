/**
 * Prova dos workers da Fase 2, dirigida pelo EntradaTelegram e por
 * rodarAteEsvaziar. A camada de conversa não entra aqui: o que se prova é que
 * tema mais decisão do Ricardo viram protótipos, pacote, entrega e arquivo, e
 * que repetir qualquer passo não duplica nada.
 *
 * Tudo offline com adaptadores falsos, e o mesmo brief devolve sempre os mesmos
 * bytes, então cada asserção de contagem é exata em vez de aproximada.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tokens from "../../brand/tokens.json";
import { carregarAdaptadores } from "../../src/adaptadores/index";
import { FakePortaLinear, FakePortaTelegram, SENTINELA_REPROVAR } from "../../src/adaptadores/fake";
import { normalizarMestre } from "../../src/adaptadores/imagem";
import type { Adaptadores } from "../../src/adaptadores/tipos";
import { criarControle } from "../../src/controle/api";
import type { ResumoArtefato } from "../../src/controle/api";
import { codificar } from "../../src/controle/aprovacoes";
import { abrirBanco } from "../../src/controle/db";
import { expirarLeases } from "../../src/controle/tarefas";
import { apresentarRevisoes } from "../../src/workers/apresentador";
import { direcoesDaRodada } from "../../src/workers/designer";
import type { OpcoesWorkers } from "../../src/workers/laco";
import { iniciarWorkers, rodarAteEsvaziar } from "../../src/workers/laco";
import type { AcaoCallback } from "../../src/controle/aprovacoes";
import type { FluxoId, FormatoPedido, Papel, VersaoId } from "../../src/modelos/tipos";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
}

const RICARDO = 111;
const PAPEIS: readonly Papel[] = [
  "diretor_criativo",
  "designer",
  "diretor_de_arte",
  "redator",
  "operacoes",
];

interface Falha {
  fluxoId: FluxoId;
  tipo: string;
  mensagem: string;
  vaiTentarDeNovo: boolean;
}

const raiz = mkdtempSync(join(tmpdir(), "em-mkt-workers-"));

function montar(rotulo: string) {
  const dir = mkdtempSync(join(raiz, `${rotulo}-`));
  const adaptadores: Adaptadores = carregarAdaptadores();
  const controle = criarControle({
    caminhoDb: join(dir, "t.db"),
    adaptadores,
    aprovadorId: RICARDO,
    artefatosDir: join(dir, "artefatos"),
  });
  const falhas: Falha[] = [];
  const opcoes: OpcoesWorkers = {
    controle: controle.paraWorkers,
    adaptadores,
    papeis: PAPEIS,
    aoFalhar: (fluxoId, _chatId, tipo, mensagem, vaiTentarDeNovo) =>
      falhas.push({ fluxoId, tipo, mensagem, vaiTentarDeNovo }),
  };
  return {
    dir,
    caminhoDb: join(dir, "t.db"),
    adaptadores,
    telegram: adaptadores.telegram as FakePortaTelegram,
    linear: adaptadores.linear as FakePortaLinear,
    controle,
    falhas,
    opcoes,
    rodar: () => rodarAteEsvaziar(opcoes),
    apresentar: () => apresentarRevisoes({ controle: controle.paraWorkers, adaptadores }),
  };
}

type Bancada = ReturnType<typeof montar>;

function abrir(b: Bancada, tema: string, format: FormatoPedido): FluxoId {
  const id = b.controle.paraTelegram.criarFluxo({
    tipo: "instagram",
    chatId: 10,
    solicitanteId: RICARDO,
    pedido: { theme: tema, format },
  });
  b.controle.paraTelegram.confirmarBrief(id);
  return id;
}

function decidir(b: Bancada, id: FluxoId, acao: AcaoCallback, rodada: number, opcao?: VersaoId) {
  return b.controle.paraTelegram.aoCallback({
    deId: RICARDO,
    callbackId: `cb-${acao}-${rodada}`,
    data: codificar({ fluxoId: id, stage: "prototype", acao, rodada, ...(opcao ? { opcao } : {}) }),
  });
}

function decidirPacote(
  b: Bancada,
  id: FluxoId,
  acao: AcaoCallback,
  rodada: number,
  opcao?: VersaoId,
  notas?: string,
) {
  return b.controle.paraTelegram.aoCallback({
    deId: RICARDO,
    callbackId: `cbk-${acao}-${rodada}`,
    data: codificar({ fluxoId: id, stage: "package", acao, rodada, ...(opcao ? { opcao } : {}) }),
    ...(notas ? { notas } : {}),
  });
}

const de = (arts: readonly ResumoArtefato[], papel: string, rodada?: number) =>
  arts.filter((a) => a.papel === papel && (rodada === undefined || a.rodada === rodada));

const chamadas = (b: Bancada, metodo: string) => b.telegram.chamadas.filter((c) => c.metodo === metodo);

// ---------------------------------------------------------------------------
// 1. Ambos: três protótipos, ajuste, pacote, ajuste de legenda, entrega, arquivo
// ---------------------------------------------------------------------------
{
  const b = montar("ambos");
  const id = abrir(b, "Box de banheiro", "both");
  await b.rodar();

  assert(
    b.controle.inspecionar.fluxo(id)!.estado === "awaiting_prototype_review",
    `ambos: parou em ${b.controle.inspecionar.fluxo(id)!.estado}`,
  );
  let arts = b.controle.inspecionar.artefatos(id);
  assert(de(arts, "master", 1).length === 3, `ambos: ${de(arts, "master", 1).length} mestres, esperava 3`);
  assert(de(arts, "preview", 1).length === 3, `ambos: ${de(arts, "preview", 1).length} previews, esperava 3`);
  const pareceres = de(arts, "qa", 1);
  assert(pareceres.length === 3, `ambos: ${pareceres.length} pareceres, esperava 3`);
  assert(pareceres.every((p) => p.meta?.aprovada === true), "ambos: parecer reprovado numa peça sem sentinela");
  assert(
    de(arts, "master", 1).every((m) => m.formato === "feed"),
    "ambos: protótipo saiu em stories, e o Feed é que orienta a adaptação",
  );

  await b.apresentar();
  const album = chamadas(b, "enviarAlbum");
  assert(album.length === 1, `ambos: ${album.length} álbuns, esperava 1`);
  assert((album[0]!.itens as unknown[]).length === 3, "ambos: álbum sem as três prévias");
  const comTeclado = chamadas(b, "enviarMensagem").filter(
    (c) => (c.extra as { reply_markup?: unknown } | undefined)?.reply_markup,
  );
  assert(comTeclado.length === 1, `ambos: ${comTeclado.length} mensagens com teclado, esperava 1`);
  const antesDeRepetir = b.telegram.chamadas.length;
  await b.apresentar();
  assert(b.telegram.chamadas.length === antesDeRepetir, "ambos: apresentar de novo mandou álbum de novo");

  // ajuste no v2: uma peça nova, na mesma linhagem, derivada da que ele apontou
  const rev1 = b.controle.paraWorkers.revisoesAbertas()[0]!;
  const v2 = rev1.versoes[1]!;
  const ajuste = b.controle.paraTelegram.aoCallback({
    deId: RICARDO,
    callbackId: "cb-ajuste",
    data: codificar({ fluxoId: id, stage: "prototype", acao: "ajustar", rodada: 1, opcao: v2 }),
    notas: "menos texto e o produto maior",
  });
  assert(ajuste.ok, `ambos: ajuste recusado (${ajuste.ok ? "" : ajuste.motivo})`);
  await b.rodar();
  assert(
    b.controle.inspecionar.fluxo(id)!.estado === "awaiting_prototype_review",
    "ambos: rodada de ajuste não voltou para revisão",
  );
  arts = b.controle.inspecionar.artefatos(id);
  const novos = de(arts, "master", 2);
  assert(novos.length === 1, `ambos: rodada de ajuste produziu ${novos.length} mestres, esperava 1`);
  const base = arts.find((a) => a.id === v2)!;
  assert(novos[0]!.derivadaDe === v2, "ambos: a peça ajustada não deriva da que o Ricardo apontou");
  assert(novos[0]!.linhagemId === base.linhagemId, "ambos: o ajuste trocou de linhagem");
  assert(novos[0]!.versao === 2, `ambos: a peça ajustada saiu na versão ${novos[0]!.versao}`);
  await b.apresentar();

  // aceite: Feed e Stories mais legenda entram na revisão de pacote
  const rev2 = b.controle.paraWorkers.revisoesAbertas()[0]!;
  const aceite = decidir(b, id, "aceitar", 2, rev2.versoes[0]!);
  assert(aceite.ok && aceite.estado === "package_finalizing", "ambos: aceite não abriu a finalização do pacote");
  await b.rodar();
  assert(
    b.controle.inspecionar.fluxo(id)!.estado === "awaiting_package_review",
    `ambos: pacote parou em ${b.controle.inspecionar.fluxo(id)!.estado}`,
  );
  arts = b.controle.inspecionar.artefatos(id);
  const feed = de(arts, "master").find((m) => m.formato === "feed" && m.rodada === 2)!;
  const stories = de(arts, "master").find((m) => m.formato === "stories")!;
  assert(stories, "ambos: pacote sem Stories");
  assert(stories.derivadaDe === feed.id, "ambos: o Stories não saiu do Feed aprovado");
  const copy1 = de(arts, "copy");
  assert(copy1.length === 1, `ambos: ${copy1.length} legendas, esperava 1`);

  const antesDoPacote = b.telegram.chamadas.length;
  await b.apresentar();
  const albunsDoPacote = chamadas(b, "enviarAlbum");
  assert(
    albunsDoPacote.length === 3,
    `ambos: ${albunsDoPacote.length} álbuns depois do pacote, esperava 3 (rodada 1, ajuste, pacote)`,
  );
  assert(
    (albunsDoPacote.at(-1)!.itens as unknown[]).length === 2,
    "ambos: álbum do pacote sem Feed e Stories",
  );
  const legendaNoChat = b.telegram.chamadas
    .slice(antesDoPacote)
    .filter((c) => c.metodo === "enviarMensagem" && String(c.texto).includes("#EMVidros"));
  assert(legendaNoChat.length === 1, "ambos: a legenda não saiu numa mensagem só dela");

  // ajuste só na legenda: imagem intacta, texto novo (US-6)
  const revPacote = b.controle.paraWorkers.revisoesAbertas()[0]!;
  assert(
    revPacote.versoes.length === 3,
    `ambos: revisão de pacote cobre ${revPacote.versoes.length} versões, esperava 3`,
  );
  const ajusteLegenda = decidirPacote(b, id, "ajustar", 2, copy1[0]!.id, "fala mais de segurança");
  assert(ajusteLegenda.ok, "ambos: ajuste de legenda recusado");
  await b.rodar();
  arts = b.controle.inspecionar.artefatos(id);
  const copies = de(arts, "copy");
  assert(copies.length === 2, `ambos: ajuste de legenda deixou ${copies.length} legendas, esperava 2`);
  assert(
    de(arts, "master").filter((m) => m.formato === "feed" && m.rodada === 2).length === 1 &&
      de(arts, "master").filter((m) => m.formato === "stories").length === 1,
    "ambos: ajuste de legenda mexeu na imagem",
  );
  await b.apresentar();

  // aceite do pacote: um documento por mestre, com o hash conferido, e o Linear
  const aceitePacote = decidirPacote(b, id, "aceitar", 3);
  assert(
    aceitePacote.ok && aceitePacote.estado === "approved_for_manual_delivery",
    "ambos: aceite do pacote não liberou a entrega",
  );
  await b.rodar();
  assert(b.controle.inspecionar.fluxo(id)!.estado === "archived", "ambos: fluxo não fechou em archived");
  const entregas = b.controle.inspecionar.entregas(id);
  assert(entregas.length === 2, `ambos: ${entregas.length} entregas, esperava 2 (Feed e Stories)`);
  assert(
    entregas.every((e) => e.estado === "confirmada" && e.hashConferido?.length === 64),
    "ambos: entrega sem hash conferido de 64 chars",
  );
  const issues = b.linear.chamadas.filter((c) => c.metodo === "criarIssue");
  const anexos = b.linear.chamadas.filter((c) => c.metodo === "anexar");
  assert(issues.length === 1, `ambos: ${issues.length} issues no Linear, esperava 1`);
  assert(anexos.length === 2, `ambos: ${anexos.length} anexos, esperava 1 por mestre`);

  const fotoFinal = JSON.stringify([
    b.controle.inspecionar.fluxo(id),
    b.controle.inspecionar.tarefas(id),
    b.controle.inspecionar.artefatos(id),
    b.telegram.chamadas.length,
    b.linear.chamadas.length,
  ]);
  await b.rodar();
  await b.apresentar();
  const depois = JSON.stringify([
    b.controle.inspecionar.fluxo(id),
    b.controle.inspecionar.tarefas(id),
    b.controle.inspecionar.artefatos(id),
    b.telegram.chamadas.length,
    b.linear.chamadas.length,
  ]);
  assert(fotoFinal === depois, "ambos: rodar de novo depois de archived mudou algo");
  assert(b.falhas.length === 0, `ambos: ${b.falhas.length} falha(s) num caminho feliz`);
  b.controle.fechar();
  console.log("ok\tambos: protótipo, ajuste, pacote, ajuste de legenda, entrega e arquivo");
}

// ---------------------------------------------------------------------------
// 2. Stories: o aceite do protótipo já é a entrega, sem legenda
// ---------------------------------------------------------------------------
{
  const b = montar("stories");
  const id = abrir(b, "Espelho bisotado", "stories");
  await b.rodar();
  let arts = b.controle.inspecionar.artefatos(id);
  assert(
    de(arts, "master", 1).every((m) => m.formato === "stories"),
    "stories: protótipo não saiu em stories",
  );

  const rev = b.controle.paraWorkers.revisoesAbertas()[0]!;
  const r = decidir(b, id, "aceitar", 1, rev.versoes[0]!);
  assert(
    r.ok && r.estado === "approved_for_manual_delivery",
    `stories: aceite parou em ${r.ok ? r.estado : r.motivo}, e formato único pula a revisão de pacote`,
  );
  await b.rodar();
  assert(b.controle.inspecionar.fluxo(id)!.estado === "archived", "stories: fluxo não fechou");
  arts = b.controle.inspecionar.artefatos(id);
  assert(de(arts, "copy").length === 0, "stories: Stories não recebe legenda de publicação (US-6)");
  const entregas = b.controle.inspecionar.entregas(id);
  assert(entregas.length === 1 && entregas[0]!.hashConferido?.length === 64, "stories: entrega fora do esperado");
  b.controle.fechar();
  console.log("ok\tstories: aceite do protótipo entrega direto, sem legenda");
}

// ---------------------------------------------------------------------------
// 3. Sentinela de reprovação: o laço de controle visual fecha em revisão manual
// ---------------------------------------------------------------------------
{
  const b = montar("reprova");
  const id = abrir(b, `Porta de vidro ${SENTINELA_REPROVAR}`, "feed");
  await b.rodar();

  const tarefas = b.controle.inspecionar.tarefas(id);
  const qa = tarefas.filter((t) => t.tipo === "qa_visual");
  const design = tarefas.filter((t) => t.tipo === "design_prototipos");
  assert(qa.length === 3, `reprova: ${qa.length} visitas do controle visual, esperava 3`);
  assert(design.length === 3, `reprova: ${design.length} visitas do designer, esperava 3`);
  assert(
    qa.filter((t) => t.estado === "revisao_manual").length === 1,
    "reprova: a terceira visita não parou em revisao_manual",
  );
  assert(b.controle.inspecionar.fluxo(id)!.rodada === 1, "reprova: o laço de QA andou com a rodada");
  const falha = b.falhas.at(-1);
  assert(falha && falha.tipo === "qa_visual", "reprova: aoFalhar não recebeu a falha do controle visual");
  assert(falha!.vaiTentarDeNovo === false, "reprova: o aviso prometeu outra tentativa que não existe");
  assert(b.falhas.length === 1, `reprova: ${b.falhas.length} avisos, esperava 1 (primeira falha é a última)`);

  const antes = JSON.stringify(b.controle.inspecionar.tarefas(id));
  await b.rodar();
  assert(
    JSON.stringify(b.controle.inspecionar.tarefas(id)) === antes,
    "reprova: rodar de novo criou tarefa por cima da revisão manual",
  );
  b.controle.fechar();
  console.log("ok\treprova: três visitas, revisão manual e um aviso só");
}

// ---------------------------------------------------------------------------
// 3b. Recusar todas: rodada nova com direções que ele ainda não viu
// ---------------------------------------------------------------------------
{
  const b = montar("recusa");
  const id = abrir(b, "Fachada em pele de vidro", "feed");
  await b.rodar();
  const arts1 = b.controle.inspecionar.artefatos(id);
  const idsRodada1 = new Set(de(arts1, "master", 1).map((m) => String(m.meta?.direction_id)));
  assert(idsRodada1.size === 3, "recusa: rodada 1 sem três direções distintas");

  const r = decidir(b, id, "recusar_todas", 1);
  assert(r.ok && r.estado === "brief_confirmed", `recusa: parou em ${r.ok ? r.estado : r.motivo}`);
  assert(b.controle.inspecionar.fluxo(id)!.rodada === 2, "recusa: a rodada não andou");
  await b.rodar();

  assert(
    b.controle.inspecionar.fluxo(id)!.estado === "awaiting_prototype_review",
    "recusa: a rodada nova não chegou à revisão",
  );
  const arts2 = b.controle.inspecionar.artefatos(id);
  const mestres2 = de(arts2, "master", 2);
  assert(mestres2.length === 3, `recusa: rodada 2 com ${mestres2.length} mestres, esperava 3`);
  for (const m of mestres2) {
    assert(
      !idsRodada1.has(String(m.meta?.direction_id)),
      "recusa: a rodada nova repetiu uma direção que o Ricardo já recusou",
    );
  }
  b.controle.fechar();
  console.log("ok\trecusa: rodada nova com três direções inéditas");
}

// ---------------------------------------------------------------------------
// 3c. Feed: pacote é o Feed aceito mais a legenda, sem Stories
// ---------------------------------------------------------------------------
{
  const b = montar("feed");
  const id = abrir(b, "Guarda-corpo de vidro", "feed");
  await b.rodar();
  const rev = b.controle.paraWorkers.revisoesAbertas()[0]!;
  const escolhido = rev.versoes[2]!;
  const recusados = rev.versoes.filter((v) => v !== escolhido);
  const r = decidir(b, id, "aceitar", 1, escolhido);
  assert(r.ok && r.estado === "package_finalizing", "feed: aceite não abriu a finalização do pacote");
  await b.rodar();

  const arts = b.controle.inspecionar.artefatos(id);
  assert(de(arts, "master").every((m) => m.formato === "feed"), "feed: pedido de Feed produziu Stories");
  const copy = de(arts, "copy");
  assert(copy.length === 1, `feed: ${copy.length} legendas, esperava 1`);
  const revPacote = b.controle.paraWorkers.revisoesAbertas()[0]!;
  assert(
    JSON.stringify([...revPacote.versoes].sort()) === JSON.stringify([escolhido, copy[0]!.id].sort()),
    `feed: a revisão de pacote cobre ${revPacote.versoes.join(",")}, esperava o Feed aceito e a legenda`,
  );
  for (const v of recusados) {
    assert(!revPacote.versoes.includes(v), "feed: protótipo recusado entrou na revisão de pacote");
  }
  b.controle.fechar();
  console.log("ok\tfeed: pacote com o Feed aceito e a legenda, sem os recusados");
}

// ---------------------------------------------------------------------------
// 4. Queda no meio do design: a retomada produz só o que falta
// ---------------------------------------------------------------------------
{
  const b = montar("queda");
  const id = abrir(b, "Janela acústica", "feed");
  await rodarAteEsvaziar({ ...b.opcoes, papeis: ["diretor_criativo"] });
  assert(b.controle.inspecionar.fluxo(id)!.estado === "directions_ready", "queda: as direções não saíram");

  b.controle.paraWorkers.reconciliar();
  const tarefa = b.controle.paraWorkers.reivindicar("designer", "worker-que-vai-cair")!;
  const direcoes = direcoesDaRodada(tarefa.contexto)!;
  const peca = await b.adaptadores.designer.gerar({
    direcao: direcoes[0]!,
    formato: "feed",
    logo: readFileSync(tokens.assets.logoColor),
  });
  const mestre = await normalizarMestre(peca.png, "feed");
  b.controle.paraWorkers.publicarArtefato(tarefa.lease, {
    papel: "master",
    formato: "feed",
    conteudo: mestre.png,
    mediaTipo: "image/png",
    meta: { direction_id: direcoes[0]!.direction_id, modelo: peca.modelo, refId: peca.refId ?? null },
  });

  // o worker morre aqui: nem preview, nem conclusão, nem falha
  const db2 = abrirBanco(b.caminhoDb);
  const daquiAUmaHora = new Date(Date.now() + 3_600_000).toISOString();
  assert(expirarLeases(db2, daquiAUmaHora) === 1, "queda: a lease do worker morto não expirou");
  db2.close();

  await b.rodar();
  const arts = b.controle.inspecionar.artefatos(id);
  const mestres = de(arts, "master", 1);
  assert(mestres.length === 3, `queda: a retomada deixou ${mestres.length} mestres, esperava 3`);
  assert(de(arts, "preview", 1).length === 3, "queda: a retomada não completou os previews");
  assert(
    new Set(mestres.map((m) => String(m.meta?.direction_id))).size === 3,
    "queda: a retomada refez uma direção que já tinha peça",
  );
  assert(
    b.controle.inspecionar.fluxo(id)!.estado === "awaiting_prototype_review",
    "queda: o fluxo não chegou à revisão depois da retomada",
  );
  b.controle.fechar();
  console.log("ok\tqueda: retomada produz só o que falta, sem quarto mestre");
}

// ---------------------------------------------------------------------------
// 5. Laço com timer: é o modo de produção, e parar() tem que parar mesmo
// ---------------------------------------------------------------------------
{
  const b = montar("laco");
  const id = abrir(b, "Divisória de vidro", "feed");
  const trabalhando = iniciarWorkers({ ...b.opcoes, intervaloMs: 10 });
  // Quem cria tarefa é o reconciliador, e em produção ele tem tique próprio.
  const tique = setInterval(() => {
    b.controle.paraWorkers.reconciliar();
    void b.apresentar();
  }, 10);
  const limite = Date.now() + 60_000;
  while (b.controle.inspecionar.fluxo(id)!.estado !== "awaiting_prototype_review") {
    assert(Date.now() < limite, "laço: os workers com timer não chegaram à revisão em 60s");
    await new Promise((r) => setTimeout(r, 20));
  }
  clearInterval(tique);
  trabalhando.parar();
  await new Promise((r) => setTimeout(r, 50));
  const parado = JSON.stringify(b.controle.inspecionar.tarefas(id));
  await new Promise((r) => setTimeout(r, 100));
  assert(JSON.stringify(b.controle.inspecionar.tarefas(id)) === parado, "laço: parar() não parou");
  assert(chamadas(b, "enviarAlbum").length === 1, "laço: o tique do reconciliador não apresentou a revisão");
  b.controle.fechar();
  console.log("ok\tlaço: workers com heartbeat chegam à revisão e param quando mandado");
}

rmSync(raiz, { recursive: true, force: true });
console.log("\nworkers: ok");
