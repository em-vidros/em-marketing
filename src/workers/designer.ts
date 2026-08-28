/**
 * O que o designer tem a fazer, e o que entra no pacote, derivados só do
 * contexto da tarefa. As duas funções são puras: repetir a tarefa depois de uma
 * queda lê o mesmo banco, chega no mesmo desfecho e produz só o que falta, em
 * vez de refazer chamada de modelo que já custou.
 *
 * As três direções da rodada viajam no `meta` do artefato `direcao`, além dos
 * bytes. Sem isso a derivação precisaria abrir arquivo para decidir, e deixaria
 * de ser função do contexto.
 */

import type { Violacao } from "../adaptadores/tipos";
import { derivarPreview, normalizarMestre } from "../adaptadores/imagem";
import type { ControlePlano, PacoteContexto, ResumoArtefato } from "../controle/api";
import type { Lease } from "../controle/api";
import type { DirecaoVisual, Formato, VersaoId } from "../modelos/tipos";

/** Visitas ao mesmo estado antes de o laço de controle visual desistir. */
export const TETO_QA = 3;

export interface Alvo {
  readonly master: ResumoArtefato;
  readonly direcao: DirecaoVisual;
  readonly violacoes: readonly Violacao[];
}

export type ModoDesigner =
  | {
      readonly modo: "produzir";
      readonly formato: Formato;
      readonly gerar: readonly DirecaoVisual[];
      readonly refinar: readonly Alvo[];
      readonly ajustar?: { master: ResumoArtefato; direcao: DirecaoVisual; instrucao: string };
    }
  | { readonly modo: "nada_a_fazer"; readonly versoes: readonly VersaoId[] };

export interface ConjuntoPacote {
  readonly feed: ResumoArtefato | null;
  readonly stories: ResumoArtefato | null;
  readonly copy: ResumoArtefato | null;
  readonly precisaStories: boolean;
  readonly precisaCopy: boolean;
}

/** Stories só quando o pedido é só Stories: no Ambos, o protótipo é o Feed que orienta a adaptação (US-4). */
export function formatoDoPrototipo(contexto: PacoteContexto): Formato {
  return contexto.pedido.format === "stories" ? "stories" : "feed";
}

export function varianteDoLogo(direcao: DirecaoVisual): "cor" | "branco" {
  return direcao.logo_variant ?? "cor";
}

function ultimo<T>(itens: readonly T[], filtro: (i: T) => boolean): T | null {
  for (let i = itens.length - 1; i >= 0; i--) if (filtro(itens[i]!)) return itens[i]!;
  return null;
}

export function direcoesDoArtefato(a: ResumoArtefato): readonly DirecaoVisual[] {
  return (a.meta?.direcoes as DirecaoVisual[] | undefined) ?? [];
}

export function direcoesDaRodada(contexto: PacoteContexto): readonly DirecaoVisual[] | null {
  const a = ultimo(contexto.artefatos, (x) => x.papel === "direcao" && x.rodada === contexto.rodada);
  return a ? direcoesDoArtefato(a) : null;
}

/** Toda direção que o fluxo já propôs, de qualquer rodada. */
export function direcoesDoFluxo(contexto: PacoteContexto): readonly DirecaoVisual[] {
  return contexto.artefatos.filter((a) => a.papel === "direcao").flatMap(direcoesDoArtefato);
}

export function direcaoDoMestre(
  contexto: PacoteContexto,
  master: ResumoArtefato,
): DirecaoVisual | null {
  const id = master.meta?.direction_id;
  return direcoesDoFluxo(contexto).find((d) => d.direction_id === id) ?? null;
}

export interface Parecer {
  readonly aprovada: boolean;
  readonly violacoes: readonly Violacao[];
}

export function ultimoParecer(contexto: PacoteContexto, masterId: VersaoId): Parecer | null {
  const qa = ultimo(contexto.artefatos, (a) => a.papel === "qa" && a.derivadaDe === masterId);
  if (!qa) return null;
  return {
    aprovada: qa.meta?.aprovada === true,
    violacoes: (qa.meta?.violacoes as Violacao[] | undefined) ?? [],
  };
}

/** Um mestre por linhagem, o mais novo, entre os da rodada. É o que o Ricardo veria hoje. */
export function mestresAtuais(
  artefatos: readonly ResumoArtefato[],
  rodada: number,
  formato?: Formato,
): ResumoArtefato[] {
  const porLinhagem = new Map<string, ResumoArtefato>();
  for (const a of artefatos) {
    if (a.papel !== "master" || a.rodada !== rodada) continue;
    if (formato && a.formato !== formato) continue;
    const atual = porLinhagem.get(a.linhagemId);
    if (!atual || a.versao > atual.versao) porLinhagem.set(a.linhagemId, a);
  }
  return [...porLinhagem.values()];
}

export function modoDoDesigner(contexto: PacoteContexto): ModoDesigner {
  const formato = formatoDoPrototipo(contexto);
  const daRodada = direcoesDaRodada(contexto);
  const atuais = mestresAtuais(contexto.artefatos, contexto.rodada);

  if (!daRodada) return modoDeAjuste(contexto, formato, atuais);

  const gerar: DirecaoVisual[] = [];
  const refinar: Alvo[] = [];
  for (const direcao of daRodada) {
    const master = atuais.find((m) => m.meta?.direction_id === direcao.direction_id);
    if (!master) {
      gerar.push(direcao);
      continue;
    }
    const parecer = ultimoParecer(contexto, master.id);
    if (parecer && !parecer.aprovada) refinar.push({ master, direcao, violacoes: parecer.violacoes });
  }
  if (gerar.length === 0 && refinar.length === 0) {
    return { modo: "nada_a_fazer", versoes: atuais.map((m) => m.id) };
  }
  return { modo: "produzir", formato, gerar, refinar };
}

/**
 * Rodada sem direção própria é rodada de ajuste: o Ricardo apontou um protótipo
 * e escreveu o que queria. A base é a opção da decisão da rodada anterior, e a
 * direção vem do direction_id gravado no mestre.
 */
function modoDeAjuste(
  contexto: PacoteContexto,
  formato: Formato,
  atuais: readonly ResumoArtefato[],
): ModoDesigner {
  const decisao = ultimo(
    contexto.decisoes,
    (d) =>
      d.stage === "prototype" &&
      d.decision === "adjustment_requested" &&
      d.rodada === contexto.rodada - 1,
  );
  if (!decisao?.opcao) {
    throw new Error(
      `fluxo ${contexto.fluxoId} está na rodada ${contexto.rodada} sem direção e sem ajuste pedido na rodada anterior`,
    );
  }
  const base = contexto.artefatos.find((a) => a.id === decisao.opcao);
  if (!base) throw new Error(`ajuste aponta para a versão ${decisao.opcao}, que não é do fluxo`);
  const direcao = direcaoDoMestre(contexto, base);
  if (!direcao) throw new Error(`mestre ${base.id} não guarda a direção que o gerou`);

  const jaAjustado = atuais.find((m) => m.linhagemId === base.linhagemId && m.versao > base.versao);
  if (jaAjustado) {
    const parecer = ultimoParecer(contexto, jaAjustado.id);
    if (parecer && !parecer.aprovada) {
      return {
        modo: "produzir",
        formato,
        gerar: [],
        refinar: [{ master: jaAjustado, direcao, violacoes: parecer.violacoes }],
      };
    }
    return { modo: "nada_a_fazer", versoes: atuais.map((m) => m.id) };
  }
  return {
    modo: "produzir",
    formato,
    gerar: [],
    refinar: [],
    ajustar: { master: base, direcao, instrucao: decisao.notas ?? "" },
  };
}

/**
 * O pacote não é "toda a rodada": aceitar não incrementa a rodada, então em
 * package_qa as três linhagens de protótipo ainda são da rodada. O que vale é a
 * linhagem que o Ricardo aceitou.
 */
export function conjuntoDoPacote(contexto: PacoteContexto): ConjuntoPacote {
  const aceite = ultimo(
    contexto.decisoes,
    (d) => d.stage === "prototype" && d.decision === "accepted",
  );
  const escolhido = aceite?.opcao
    ? contexto.artefatos.find((a) => a.id === aceite.opcao) ?? null
    : null;
  const feed = escolhido
    ? contexto.artefatos
        .filter(
          (a) => a.papel === "master" && a.linhagemId === escolhido.linhagemId && a.formato === "feed",
        )
        .reduce<ResumoArtefato | null>((m, a) => (!m || a.versao > m.versao ? a : m), null)
    : null;
  const precisaStories = contexto.pedido.format === "both";
  const stories = precisaStories
    ? ultimo(contexto.artefatos, (a) => a.papel === "master" && a.formato === "stories")
    : null;
  // Stories não recebe legenda de publicação (US-6), então a legenda segue o Feed.
  const precisaCopy = contexto.pedido.format === "feed" || contexto.pedido.format === "both";
  const copy = precisaCopy ? ultimo(contexto.artefatos, (a) => a.papel === "copy") : null;
  return { feed, stories, copy, precisaStories, precisaCopy };
}

/**
 * Cada peça vira dois artefatos: o mestre PNG normalizado, que é o que a US-5
 * entrega, e o preview JPEG, que é o que cabe no celular. Os dois saem da mesma
 * chamada porque um mestre sem preview não pode ser apresentado.
 */
export async function publicarPeca(
  controle: ControlePlano,
  lease: Lease,
  e: {
    png: Buffer;
    formato: Formato;
    meta: Record<string, unknown>;
    derivadaDe?: VersaoId;
  },
): Promise<{ master: VersaoId; preview: VersaoId }> {
  const mestre = await normalizarMestre(e.png, e.formato);
  const master = controle.publicarArtefato(lease, {
    papel: "master",
    formato: e.formato,
    conteudo: mestre.png,
    mediaTipo: "image/png",
    meta: e.meta,
    ...(e.derivadaDe ? { derivadaDe: e.derivadaDe } : {}),
  });
  const preview = await garantirPreview(controle, lease, master, mestre.png, e.formato);
  return { master, preview };
}

export async function garantirPreview(
  controle: ControlePlano,
  lease: Lease,
  masterId: VersaoId,
  mestrePng: Buffer,
  formato: Formato,
): Promise<VersaoId> {
  const previa = await derivarPreview(mestrePng);
  return controle.publicarArtefato(lease, {
    papel: "preview",
    formato,
    conteudo: previa.jpeg,
    mediaTipo: "image/jpeg",
    derivadaDe: masterId,
  });
}

/** Instrução de refino: a violação do parecer, em texto, é o que o modelo recebe. */
export function instrucaoDeRefino(violacoes: readonly Violacao[]): string {
  if (violacoes.length === 0) return "Refaça a peça corrigindo o que ficou fora do brandbook.";
  return `Corrija sem mudar o conceito: ${violacoes.map((v) => `${v.criterio}: ${v.problema}`).join(" ")}`;
}
