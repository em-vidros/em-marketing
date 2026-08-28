/**
 * Um executor por tipo de tarefa. O Record é exaustivo, então tipo novo sem
 * executor não compila.
 *
 * Nenhum deles chama transicionar: cada um devolve um desfecho tipado e o plano
 * de controle escolhe a aresta. Todos leem o que já existe antes de produzir, e
 * é isso que faz repetir uma tarefa depois de uma queda produzir só o que falta.
 */

import type { Adaptadores, Violacao } from "../adaptadores/tipos";
import type {
  ControlePlano,
  PacoteContexto,
  ResumoArtefato,
  SaidaTarefa,
  TarefaAtribuida,
} from "../controle/api";
import { LeasePerdida } from "../controle/tarefas";
import type { Estagio, TipoTarefa, VersaoId } from "../modelos/tipos";
import {
  TETO_QA,
  conjuntoDoPacote,
  direcaoDoMestre,
  direcoesDoArtefato,
  formatoDoPrototipo,
  garantirPreview,
  instrucaoDeRefino,
  mestresAtuais,
  modoDoDesigner,
  publicarPeca,
  ultimoParecer,
  varianteDoLogo,
} from "./designer";

/** Erro que não melhora com outra tentativa: vai direto para a fila de revisão manual. */
export class FalhaPermanente extends Error {}

export interface Ambiente {
  readonly tarefa: TarefaAtribuida;
  readonly controle: ControlePlano;
  readonly adaptadores: Adaptadores;
  readonly logo: (variante: "cor" | "branco") => Buffer;
  /** Dispara quando o heartbeat perde a lease: seguir escrevendo seria escrever por cima de outro worker. */
  readonly sinal: AbortSignal;
}

export type Executor = (a: Ambiente) => Promise<SaidaTarefa | { tipo: "fechada" }>;

const INSTRUCAO_STORIES =
  "Recomponha esta peça em 9:16 para Stories, mantendo o conceito, as cores e o elemento principal. " +
  "Reposicione o texto e o logo dentro da zona segura. Não recorte a arte original.";

function conferirLease(a: Ambiente): void {
  if (a.sinal.aborted) throw new LeasePerdida(`tarefa ${a.tarefa.lease.tarefaId} perdeu a lease no meio`);
}

function recarregar(a: Ambiente): readonly ResumoArtefato[] {
  return a.controle.artefatosDoFluxo(a.tarefa.fluxoId);
}

function textoDoArtefato(a: Ambiente, id: VersaoId): string {
  return a.controle.lerArtefato(id).bytes.toString("utf8");
}

/** Mestre atual sem preview é queda entre as duas publicações; o preview é determinístico e refaz de graça. */
async function garantirPreviews(a: Ambiente, mestres: readonly ResumoArtefato[]): Promise<void> {
  const artefatos = recarregar(a);
  for (const m of mestres) {
    const tem = artefatos.some((x) => x.papel === "preview" && x.derivadaDe === m.id);
    if (tem) continue;
    const bytes = a.controle.lerArtefato(m.id).bytes;
    await garantirPreview(a.controle, a.tarefa.lease, m.id, bytes, m.formato ?? "feed");
  }
}

const direcaoCriativa: Executor = async (a) => {
  const ctx = a.tarefa.contexto;
  const daRodada = [...ctx.artefatos]
    .reverse()
    .find((x) => x.papel === "direcao" && x.rodada === ctx.rodada);
  if (daRodada) return { tipo: "seguir", versoes: [daRodada.id] };

  const excluir = ctx.artefatos
    .filter((x) => x.papel === "direcao" && x.rodada < ctx.rodada)
    .flatMap((x) => direcoesDoArtefato(x).map((d) => d.direction_id));
  const direcoes = await a.adaptadores.criativo.direcoes({
    pedido: ctx.pedido,
    marca: ctx.marca,
    rodada: ctx.rodada,
    excluir,
  });
  if (direcoes.length !== 3) {
    throw new FalhaPermanente(`o diretor criativo devolveu ${direcoes.length} direções, o contrato é 3`);
  }
  conferirLease(a);
  const id = a.controle.publicarArtefato(a.tarefa.lease, {
    papel: "direcao",
    conteudo: Buffer.from(JSON.stringify(direcoes, null, 2), "utf8"),
    mediaTipo: "application/json",
    meta: { direcoes, rodada: ctx.rodada },
  });
  return { tipo: "seguir", versoes: [id], resumo: `3 direções na rodada ${ctx.rodada}` };
};

const designPrototipos: Executor = async (a) => {
  const ctx = a.tarefa.contexto;
  const modo = modoDoDesigner(ctx);
  if (modo.modo === "nada_a_fazer") {
    const atuais = mestresAtuais(recarregar(a), ctx.rodada);
    await garantirPreviews(a, atuais);
    return { tipo: "seguir", versoes: atuais.map((m) => m.id) };
  }

  for (const direcao of modo.gerar) {
    const peca = await a.adaptadores.designer.gerar({
      direcao,
      formato: modo.formato,
      logo: a.logo(varianteDoLogo(direcao)),
    });
    conferirLease(a);
    await publicarPeca(a.controle, a.tarefa.lease, {
      png: peca.png,
      formato: modo.formato,
      meta: { direction_id: direcao.direction_id, modelo: peca.modelo, refId: peca.refId ?? null },
    });
  }

  for (const alvo of modo.refinar) {
    const peca = await a.adaptadores.designer.editar({
      base: a.controle.lerArtefato(alvo.master.id).bytes,
      instrucao: instrucaoDeRefino(alvo.violacoes),
      formato: modo.formato,
      logo: a.logo(varianteDoLogo(alvo.direcao)),
      ...(alvo.master.meta?.refId ? { refId: String(alvo.master.meta.refId) } : {}),
    });
    conferirLease(a);
    await publicarPeca(a.controle, a.tarefa.lease, {
      png: peca.png,
      formato: modo.formato,
      derivadaDe: alvo.master.id,
      meta: {
        direction_id: alvo.direcao.direction_id,
        modelo: peca.modelo,
        refId: peca.refId ?? null,
      },
    });
  }

  if (modo.ajustar) {
    const peca = await a.adaptadores.designer.editar({
      base: a.controle.lerArtefato(modo.ajustar.master.id).bytes,
      instrucao: modo.ajustar.instrucao,
      formato: modo.formato,
      logo: a.logo(varianteDoLogo(modo.ajustar.direcao)),
      ...(modo.ajustar.master.meta?.refId ? { refId: String(modo.ajustar.master.meta.refId) } : {}),
    });
    conferirLease(a);
    await publicarPeca(a.controle, a.tarefa.lease, {
      png: peca.png,
      formato: modo.formato,
      derivadaDe: modo.ajustar.master.id,
      meta: {
        direction_id: modo.ajustar.direcao.direction_id,
        modelo: peca.modelo,
        refId: peca.refId ?? null,
      },
    });
  }

  const atuais = mestresAtuais(recarregar(a), ctx.rodada);
  await garantirPreviews(a, atuais);
  return { tipo: "seguir", versoes: atuais.map((m) => m.id) };
};

function nomeDaLinhagem(contexto: PacoteContexto, m: ResumoArtefato): string {
  return direcaoDoMestre(contexto, m)?.territory ?? m.formato ?? m.id;
}

const qaVisual: Executor = async (a) => {
  const ctx = a.tarefa.contexto;
  const stage: Estagio = ctx.estado === "package_qa" ? "package" : "prototype";
  const pacote = stage === "package" ? conjuntoDoPacote(ctx) : null;
  const candidatos =
    pacote === null
      ? mestresAtuais(ctx.artefatos, ctx.rodada)
      : [pacote.feed, pacote.stories].filter((x): x is ResumoArtefato => x !== null);
  if (candidatos.length === 0) throw new FalhaPermanente("controle visual sem nenhum mestre para revisar");

  for (const master of candidatos) {
    if (ultimoParecer(ctx, master.id)) continue;
    const direcao = direcaoDoMestre(ctx, master);
    if (!direcao) throw new FalhaPermanente(`mestre ${master.id} não guarda a direção que o gerou`);
    const veredito = await a.adaptadores.arte.revisar({
      png: a.controle.lerArtefato(master.id).bytes,
      formato: master.formato ?? "feed",
      direcao,
      tema: ctx.pedido.theme,
    });
    conferirLease(a);
    a.controle.publicarArtefato(a.tarefa.lease, {
      papel: "qa",
      // O id da peça entra no conteúdo: dois vereditos idênticos sobre peças
      // diferentes cairiam na deduplicação por hash e virariam um parecer só.
      conteudo: Buffer.from(JSON.stringify({ versao: master.id, ...veredito }, null, 2), "utf8"),
      mediaTipo: "application/json",
      derivadaDe: master.id,
      meta: {
        aprovada: veredito.aprovada,
        stage,
        direction_id: direcao.direction_id,
        violacoes: veredito.violacoes,
      },
    });
  }

  const depois = { ...ctx, artefatos: recarregar(a) };
  const aprovadas: ResumoArtefato[] = [];
  const reprovadas: { master: ResumoArtefato; violacoes: readonly Violacao[] }[] = [];
  for (const master of candidatos) {
    const parecer = ultimoParecer(depois, master.id);
    if (parecer?.aprovada) aprovadas.push(master);
    else reprovadas.push({ master, violacoes: parecer?.violacoes ?? [] });
  }

  if (reprovadas.length > 0 && a.tarefa.visita < TETO_QA) {
    return {
      tipo: "voltar",
      versoes: aprovadas.map((m) => m.id),
      motivo: `${reprovadas.length} peça(s) reprovada(s) na visita ${a.tarefa.visita} de ${TETO_QA}`,
    };
  }
  if (aprovadas.length === 0) {
    const detalhe = reprovadas
      .map((r) => `${nomeDaLinhagem(depois, r.master)}: ${r.violacoes.map((v) => v.problema).join(" ")}`)
      .join(" | ");
    throw new FalhaPermanente(
      `nenhuma peça passou no controle visual depois de ${TETO_QA} tentativas. ${detalhe}`,
    );
  }

  const versoes = [...aprovadas.map((m) => m.id)];
  if (pacote?.copy) versoes.push(pacote.copy.id);
  const aviso =
    reprovadas.length === 0
      ? undefined
      : `Caiu no controle visual e não vai para você: ${reprovadas
          .map((r) => `${nomeDaLinhagem(depois, r.master)} (${r.violacoes.map((v) => v.problema).join(" ")})`)
          .join("; ")}`;
  return { tipo: "revisar", stage, versoes, ...(aviso ? { aviso } : {}) };
};

/** Alvo do ajuste de pacote que ainda não ganhou versão nova nesta rodada. */
function alvoDoAjusteDePacote(a: Ambiente): ResumoArtefato | null {
  const ctx = a.tarefa.contexto;
  const decisao = [...ctx.decisoes]
    .reverse()
    .find(
      (d) =>
        d.stage === "package" &&
        d.decision === "adjustment_requested" &&
        d.rodada === ctx.rodada - 1,
    );
  if (!decisao?.opcao) return null;
  const alvo = ctx.artefatos.find((x) => x.id === decisao.opcao);
  if (!alvo) return null;
  const jaRefeito = ctx.artefatos.some((x) =>
    alvo.papel === "copy"
      ? x.papel === "copy" && x.rodada === ctx.rodada
      : x.papel === "master" &&
        x.linhagemId === alvo.linhagemId &&
        x.formato === alvo.formato &&
        x.rodada === ctx.rodada,
  );
  return jaRefeito ? null : alvo;
}

async function produzirStories(a: Ambiente, feed: ResumoArtefato, instrucao: string): Promise<void> {
  const ctx = a.tarefa.contexto;
  const direcao = direcaoDoMestre(ctx, feed);
  if (!direcao) throw new FalhaPermanente(`mestre ${feed.id} não guarda a direção que o gerou`);
  const peca = await a.adaptadores.designer.editar({
    base: a.controle.lerArtefato(feed.id).bytes,
    instrucao,
    formato: "stories",
    logo: a.logo(varianteDoLogo(direcao)),
    ...(feed.meta?.refId ? { refId: String(feed.meta.refId) } : {}),
  });
  conferirLease(a);
  await publicarPeca(a.controle, a.tarefa.lease, {
    png: peca.png,
    formato: "stories",
    derivadaDe: feed.id,
    meta: { direction_id: direcao.direction_id, modelo: peca.modelo, refId: peca.refId ?? null },
  });
}

async function produzirLegenda(
  a: Ambiente,
  feed: ResumoArtefato,
  ajuste?: { anterior: string; instrucao: string },
): Promise<void> {
  const ctx = a.tarefa.contexto;
  const direcao = direcaoDoMestre(ctx, feed);
  if (!direcao) throw new FalhaPermanente(`mestre ${feed.id} não guarda a direção que o gerou`);
  const texto = await a.adaptadores.redator.legenda({
    pedido: ctx.pedido,
    direcao,
    marca: ctx.marca,
    ...(ajuste ? { anterior: ajuste.anterior, ajuste: ajuste.instrucao } : {}),
  });
  conferirLease(a);
  a.controle.publicarArtefato(a.tarefa.lease, {
    papel: "copy",
    conteudo: Buffer.from(texto, "utf8"),
    mediaTipo: "text/plain",
    meta: { direction_id: direcao.direction_id },
  });
}

/**
 * O QA de pacote devolve `voltar` para cá quando reprova uma peça; sem este passo
 * a visita seguinte pularia a peça, que já tem parecer, e o laço só gastaria as
 * visitas até a falha permanente. Feed refinado obriga Stories novo (US-4).
 */
async function refinarPacoteReprovado(a: Ambiente): Promise<void> {
  const ctx = { ...a.tarefa.contexto, artefatos: recarregar(a) };
  const pacote = conjuntoDoPacote(ctx);
  for (const master of [pacote.feed, pacote.stories]) {
    if (!master) continue;
    const parecer = ultimoParecer(ctx, master.id);
    if (!parecer || parecer.aprovada) continue;
    const direcao = direcaoDoMestre(ctx, master);
    if (!direcao) throw new FalhaPermanente(`mestre ${master.id} não guarda a direção que o gerou`);
    const formato = master.formato ?? "feed";
    const peca = await a.adaptadores.designer.editar({
      base: a.controle.lerArtefato(master.id).bytes,
      instrucao: instrucaoDeRefino(parecer.violacoes),
      formato,
      logo: a.logo(varianteDoLogo(direcao)),
      ...(master.meta?.refId ? { refId: String(master.meta.refId) } : {}),
    });
    conferirLease(a);
    const novo = await publicarPeca(a.controle, a.tarefa.lease, {
      png: peca.png,
      formato,
      derivadaDe: master.id,
      meta: { ...(master.meta ?? {}), modelo: peca.modelo, refId: peca.refId ?? null },
    });
    if (formato === "feed" && pacote.precisaStories) {
      await produzirStories(a, a.controle.resumoArtefato(novo.master), INSTRUCAO_STORIES);
    }
  }
}

const finalizarPacote: Executor = async (a) => {
  const ctx = a.tarefa.contexto;
  const pacote = conjuntoDoPacote(ctx);
  if (!pacote.feed) throw new FalhaPermanente("pacote sem Feed aceito: não há o que finalizar");

  const alvo = alvoDoAjusteDePacote(a);
  const notas =
    [...ctx.decisoes].reverse().find((d) => d.stage === "package" && d.rodada === ctx.rodada - 1)
      ?.notas ?? "";

  if (alvo?.papel === "copy") {
    await produzirLegenda(a, pacote.feed, { anterior: textoDoArtefato(a, alvo.id), instrucao: notas });
  } else if (alvo?.papel === "master" && alvo.formato === "stories") {
    await produzirStories(a, pacote.feed, `${INSTRUCAO_STORIES} Ajuste pedido: ${notas}`);
  } else if (alvo?.papel === "master" && alvo.formato === "feed") {
    const peca = await a.adaptadores.designer.editar({
      base: a.controle.lerArtefato(alvo.id).bytes,
      instrucao: notas,
      formato: "feed",
      logo: a.logo(varianteDoLogo(direcaoDoMestre(ctx, alvo)!)),
      ...(alvo.meta?.refId ? { refId: String(alvo.meta.refId) } : {}),
    });
    conferirLease(a);
    const novo = await publicarPeca(a.controle, a.tarefa.lease, {
      png: peca.png,
      formato: "feed",
      derivadaDe: alvo.id,
      meta: { ...(alvo.meta ?? {}), modelo: peca.modelo, refId: peca.refId ?? null },
    });
    // O Stories sai do Feed aprovado (US-4): Feed novo obriga Stories novo.
    if (pacote.precisaStories) {
      const feedNovo = a.controle.resumoArtefato(novo.master);
      await produzirStories(a, feedNovo, INSTRUCAO_STORIES);
    }
  } else {
    // Stories de rodada anterior ao Feed é Stories do Feed velho: queda entre as
    // duas publicações do ajuste de Feed deixaria ele passar, e a US-4 proíbe.
    const storiesVelho = pacote.stories !== null && pacote.stories.rodada < pacote.feed.rodada;
    if (pacote.precisaStories && (!pacote.stories || storiesVelho)) {
      await produzirStories(a, pacote.feed, INSTRUCAO_STORIES);
    }
    if (pacote.precisaCopy && !pacote.copy) await produzirLegenda(a, pacote.feed);
  }

  await refinarPacoteReprovado(a);

  const depois = { ...ctx, artefatos: recarregar(a) };
  const fechado = conjuntoDoPacote(depois);
  const versoes = [fechado.feed, fechado.stories, fechado.copy]
    .filter((x): x is ResumoArtefato => x !== null)
    .map((x) => x.id);
  await garantirPreviews(
    a,
    [fechado.feed, fechado.stories].filter((x): x is ResumoArtefato => x !== null),
  );
  return { tipo: "seguir", versoes, resumo: `pacote com ${versoes.length} peça(s)` };
};

/** O que o Ricardo aceitou por último, resolvido pelos artefatos e não pela memória do processo. */
function aprovadoParaEntrega(a: Ambiente): { mestres: ResumoArtefato[]; copy: ResumoArtefato | null } {
  const ctx = a.tarefa.contexto;
  const aceite = [...ctx.decisoes].reverse().find((d) => d.decision === "accepted");
  if (!aceite) throw new FalhaPermanente("entrega sem aceite registrado");
  if (aceite.stage === "prototype") {
    const master = ctx.artefatos.find((x) => x.id === aceite.opcao);
    if (!master) throw new FalhaPermanente(`aceite aponta para ${aceite.opcao}, que não é do fluxo`);
    return { mestres: [master], copy: null };
  }
  // O aceite cobre versões exatas (PRD §3.3): peça que caiu no QA não está nele,
  // e conjuntoDoPacote ainda a devolveria.
  const cobertos = aceite.versoes
    .map((id) => ctx.artefatos.find((x) => x.id === id))
    .filter((x): x is ResumoArtefato => x !== undefined);
  const mestres = cobertos.filter((x) => x.papel === "master");
  if (mestres.length === 0) throw new FalhaPermanente("pacote aceito sem nenhum mestre");
  return { mestres, copy: cobertos.find((x) => x.papel === "copy") ?? null };
}

const entrega: Executor = async (a) => {
  const ctx = a.tarefa.contexto;
  const { mestres, copy } = aprovadoParaEntrega(a);

  for (const master of mestres) {
    const previa = [...ctx.artefatos]
      .reverse()
      .find((x) => x.papel === "preview" && x.derivadaDe === master.id);
    if (!previa) continue;
    await a.controle.executarUmaVez(
      `${ctx.fluxoId}:entrega:previa:${previa.id}`,
      () => a.adaptadores.telegram.enviarFoto(ctx.chatId, a.controle.lerArtefato(previa.id).bytes),
      { repetirSeFalhou: true },
    );
  }

  if (copy) {
    await a.controle.executarUmaVez(
      `${ctx.fluxoId}:entrega:legenda:${copy.id}`,
      () =>
        a.adaptadores.telegram.enviarMensagem(
          ctx.chatId,
          `Legenda do Feed, pronta para copiar:\n\n${textoDoArtefato(a, copy.id)}`,
        ),
      { repetirSeFalhou: true },
    );
  }

  await a.controle.executarEntregas(ctx.fluxoId);
  const estado = a.controle.estadoDoFluxo(ctx.fluxoId);
  if (estado !== "delivered") {
    throw new FalhaPermanente(`entrega terminou com o fluxo em ${estado}, não em delivered`);
  }

  await a.controle.executarUmaVez(
    `${ctx.fluxoId}:entrega:pronto`,
    () =>
      a.adaptadores.telegram.enviarMensagem(
        ctx.chatId,
        "Material pronto para publicar. Baixe o arquivo mestre acima e publique pelo aplicativo. Eu não publico no Instagram.",
      ),
    { repetirSeFalhou: true },
  );

  // executarEntregas já fechou a tarefa e transicionou para delivered.
  return { tipo: "fechada" };
};

function historico(a: Ambiente): string {
  const ctx = a.tarefa.contexto;
  const linhas = ctx.decisoes.map(
    (d) =>
      `- rodada ${d.rodada}, ${d.stage}: ${d.decision}${d.opcao ? ` (versão ${d.opcao})` : ""}${
        d.notas ? `. Notas: ${d.notas}` : ""
      }`,
  );
  return linhas.length ? linhas.join("\n") : "- sem ajustes nem recusas";
}

const arquivarLinear: Executor = async (a) => {
  const ctx = a.tarefa.contexto;
  const { mestres, copy } = aprovadoParaEntrega(a);
  const direcoes = ctx.artefatos.filter((x) => x.papel === "direcao").length;

  const issue = await a.controle.executarUmaVez(`${ctx.fluxoId}:linear:issue`, () =>
    a.adaptadores.linear.criarIssue({
      titulo: `${ctx.pedido.theme} (${ctx.pedido.format})`,
      descricao: [
        `Tema: ${ctx.pedido.theme}`,
        `Formato: ${ctx.pedido.format}`,
        ctx.pedido.objective ? `Objetivo: ${ctx.pedido.objective}` : "",
        `Rodadas: ${ctx.rodada}`,
        `Conjuntos de direções: ${direcoes}`,
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  );

  for (const master of mestres) {
    const arquivo = a.controle.lerArtefato(master.id);
    await a.controle.executarUmaVez(`${ctx.fluxoId}:linear:anexo:${master.id}`, () =>
      a.adaptadores.linear.anexar(
        issue.resultado.id,
        arquivo.bytes,
        `${master.formato ?? "peca"}-v${master.versao}.png`,
        arquivo.mediaTipo,
      ),
    );
  }

  await a.controle.executarUmaVez(`${ctx.fluxoId}:linear:comentario`, () =>
    a.adaptadores.linear.comentar(
      issue.resultado.id,
      [
        "Histórico da aprovação:",
        historico(a),
        copy ? `\nLegenda entregue:\n${textoDoArtefato(a, copy.id)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );

  await a.controle.executarUmaVez(
    `${ctx.fluxoId}:linear:aviso`,
    () =>
      a.adaptadores.telegram.enviarMensagem(
        ctx.chatId,
        `Trabalho arquivado no Linear: ${issue.resultado.url}`,
      ),
    { repetirSeFalhou: true },
  );

  return { tipo: "seguir", versoes: [], resumo: issue.resultado.url };
};

const faseTres = (nome: string): Executor => {
  return async () => {
    throw new FalhaPermanente(`${nome} é do fluxo de blog, que chega na Fase 3`);
  };
};

export const EXECUTORES: Record<TipoTarefa, Executor> = {
  direcao_criativa: direcaoCriativa,
  design_prototipos: designPrototipos,
  qa_visual: qaVisual,
  finalizar_pacote: finalizarPacote,
  entrega,
  arquivar_linear: arquivarLinear,
  redacao_angulos: faseTres("redacao_angulos"),
  redacao_artigo: faseTres("redacao_artigo"),
  revisao_copy: faseTres("revisao_copy"),
};
