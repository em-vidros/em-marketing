import { MODELO_DE_IMAGEM } from "../../openai";
import { custoDe } from "../precos";
import { usoDaResposta, type Uso } from "../uso";
import { generateArt, type Formato, type Qualidade } from "./generate";
import { aplicarLogo } from "./logo";
import { buildPrompt, type Brief, type ReferenciaParaGerar, type Visual } from "./pipeline";

/** As duas qualidades que a equipe decide entre. */
export const QUALIDADES = ["medium", "high"] as const satisfies readonly Qualidade[];
export type QualidadeComparada = (typeof QUALIDADES)[number];

/** Quantas artes um pedido de post gera: a base do "custo por post" do relatório. */
export const ARTES_POR_POST = 3;

export interface PedidoDeExemplo {
  /** Nome curto na tela do relatório. */
  titulo: string;
  brief: Brief;
  headline: string;
  apoio: string;
}

/** Pedidos fixos, um por tema que a casa publica. O comando usa os primeiros N. */
export const PEDIDOS_DE_EXEMPLO: readonly PedidoDeExemplo[] = [
  {
    titulo: "Espessura por aplicação",
    brief: { pilar: "AUTORIDADE", tema: "a espessura certa do vidro por aplicação", angulo: "box e guarda-corpo", precisaFotoReal: false },
    headline: "Vidro certo para cada vão",
    apoio: "Espessura, tipo e acabamento para cada aplicação.",
  },
  {
    titulo: "Vidro temperado",
    brief: { pilar: "PROVA", tema: "vidro temperado e como ele quebra", angulo: "segurança no dia a dia", precisaFotoReal: false },
    headline: "Temperado de verdade",
    apoio: "Quebra em pedaços pequenos, não em lâminas.",
  },
  {
    titulo: "Mais luz no projeto",
    brief: { pilar: "MARCA", tema: "o vidro que traz luz natural para o espaço", angulo: "arquitetura residencial", precisaFotoReal: false },
    headline: "Mais luz para o espaço",
    apoio: "Vidro plano e esquadrias para o seu projeto.",
  },
  {
    titulo: "Laminado ou temperado",
    brief: { pilar: "AUTORIDADE", tema: "laminado ou temperado na fachada", angulo: "como escolher na obra", precisaFotoReal: false },
    headline: "Laminado ou temperado?",
    apoio: "Saiba qual escolher para a sua obra.",
  },
  {
    titulo: "Espelho sob medida",
    brief: { pilar: "MARCA", tema: "espelho cortado sob medida", angulo: "lapidação e furos conforme o projeto", precisaFotoReal: false },
    headline: "Espelho sob medida",
    apoio: "Corte, lapidação e furos conforme o projeto.",
  },
];

/** Um pedido e a âncora que as duas qualidades recebem. Sem âncora, o visual da casa. */
export interface PedidoParaComparar {
  pedido: PedidoDeExemplo;
  referencia?: ReferenciaParaGerar;
  formato?: Formato;
}

export interface Medido {
  qualidade: QualidadeComparada;
  /** A arte final, com a logo, como o app a entregaria. */
  jpeg: Buffer;
  /** O `usage` da resposta do modelo. Null quando a resposta veio sem ele. */
  consumo: Uso | null;
  /** US$ pela tabela de precos.ts. Null sem `usage` ou com modelo fora da tabela. */
  custo: number | null;
  /** Do pedido ao JPEG normalizado, o que a pessoa espera na tela. */
  tempoMs: number;
}

export type ParMedido = { pedido: PedidoDeExemplo; temReferencia: boolean } & Record<QualidadeComparada, Medido>;

export const custoDoConsumo = (consumo: Uso | null): number | null => (consumo ? custoDe(consumo) : null);

/** Roda `fn` e devolve o `usage` da resposta de imagem que passou pelo fetch durante ela. Chamadas em série, para a conta ser de uma só. */
async function medir<T>(fn: () => Promise<T>): Promise<{ valor: T; consumo: Uso | null; tempoMs: number }> {
  const original = globalThis.fetch;
  let consumo: Uso | null = null;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(entrada, init);
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    if (res.ok && url.includes("/images/")) {
      const corpo = await res.clone().json();
      const uso = usoDaResposta("Comparar qualidade", url, corpo, MODELO_DE_IMAGEM);
      consumo = uso.entrada === 0 && uso.saida === 0 ? null : uso;
    }
    return res;
  }) as typeof fetch;
  const inicio = performance.now();
  try {
    const valor = await fn();
    return { valor, consumo, tempoMs: performance.now() - inicio };
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * Gera a mesma arte de cada pedido em medium e em high, pelo caminho do app (buildPrompt, generateArt, aplicarLogo),
 * com o mesmo prompt e as mesmas referências nas duas. Uma chamada de cada vez, para o tempo e o `usage` serem de uma só.
 * `gerar` só muda nos testes.
 */
export async function compararQualidades(
  pedidos: readonly PedidoParaComparar[],
  { gerar = generateArt, aoMedir }: { gerar?: typeof generateArt; aoMedir?: (indice: number, medido: Medido) => void } = {},
): Promise<ParMedido[]> {
  const pares: ParMedido[] = [];
  for (const [i, { pedido, referencia, formato = "feed" }] of pedidos.entries()) {
    const visual: Visual = referencia ? (referencia.origem === "biblioteca" ? { tipo: "referencia", leitura: referencia.leitura } : { tipo: "pedido" }) : { tipo: "casa" };
    const prompt = buildPrompt({ formato, brief: pedido.brief, headline: pedido.headline, apoio: pedido.apoio, visual });
    const referencias = referencia ? [referencia.imagem] : [];

    const medidos = {} as Record<QualidadeComparada, Medido>;
    for (const qualidade of QUALIDADES) {
      const { valor, consumo, tempoMs } = await medir(async () => aplicarLogo(await gerar({ prompt, formato, referencias, qualidade }), formato));
      medidos[qualidade] = { qualidade, jpeg: valor, consumo, custo: custoDoConsumo(consumo), tempoMs };
      aoMedir?.(i, medidos[qualidade]);
    }
    pares.push({ pedido, temReferencia: Boolean(referencia), ...medidos });
  }
  return pares;
}

/**
 * O que uma chamada costuma consumir, para a estimativa antes de gastar. Os tokens de saída de uma arte 1088x1360
 * seguem a escala publicada da série gpt-image (cerca de 1.500 em medium e 5.900 em high para 1024x1536); não foram
 * medidos neste modelo. O relatório depois mostra o gasto real ao lado desta estimativa.
 */
const SAIDA_ESTIMADA: Record<QualidadeComparada, number> = { medium: 1_500, high: 5_900 };
const TOKENS_DE_TEXTO_DO_PROMPT = 800;
const TOKENS_DA_REFERENCIA = 1_100;

export interface Estimativa {
  porQualidade: Record<QualidadeComparada, number>;
  total: number;
  chamadas: number;
}

/** US$ que `n` pedidos custam pela tabela de precos.ts, nas duas qualidades. */
export function estimarCusto(n: number, comReferencia = true): Estimativa {
  const imagem = comReferencia ? TOKENS_DA_REFERENCIA : 0;
  const porChamada = (q: QualidadeComparada) =>
    custoDe({ modelo: MODELO_DE_IMAGEM, entrada: TOKENS_DE_TEXTO_DO_PROMPT + imagem, entradaImagem: imagem, saida: SAIDA_ESTIMADA[q] }) ?? 0;
  const porQualidade = { medium: porChamada("medium") * n, high: porChamada("high") * n };
  return { porQualidade, total: porQualidade.medium + porQualidade.high, chamadas: n * QUALIDADES.length };
}

export interface CustoPorPost {
  medium: number;
  high: number;
  diferenca: number;
  /** Quantas vezes o high custa o medium. */
  vezes: number;
}

/** O custo de um post de 3 artes em cada qualidade: a média por arte dos pares medidos vezes 3. Null se faltar o custo de alguma. */
export function custoPorPost(pares: readonly { medium: { custo: number | null }; high: { custo: number | null } }[], artes = ARTES_POR_POST): CustoPorPost | null {
  if (pares.length === 0) return null;
  let medium = 0;
  let high = 0;
  for (const p of pares) {
    if (p.medium.custo === null || p.high.custo === null) return null;
    medium += p.medium.custo;
    high += p.high.custo;
  }
  const porPost = (soma: number) => (soma / pares.length) * artes;
  return { medium: porPost(medium), high: porPost(high), diferenca: porPost(high) - porPost(medium), vezes: medium === 0 ? 0 : high / medium };
}

export interface LinhaDoRelatorio {
  /** Nome do arquivo ao lado do relatório. */
  arquivo: string;
  custo: number | null;
  tempoMs: number;
  tokensDeSaida: number | null;
}

export interface PostDoRelatorio {
  titulo: string;
  headline: string;
  /** Qual âncora guiou as duas artes, em palavras e sem ponto final. */
  guia: string;
  medium: LinhaDoRelatorio;
  high: LinhaDoRelatorio;
}

const dinheiro = (v: number | null) => (v === null ? "sem custo" : `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`);
const comSinal = (v: number) => `${v < 0 ? "-" : "+"}${dinheiro(Math.abs(v))}`;
const segundos = (ms: number) => `${(ms / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
const numero = (v: number | null) => (v === null ? "sem dado" : v.toLocaleString("pt-BR"));
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A página do relatório: um arquivo só, com as imagens ao lado dele por caminho relativo. */
export function htmlDoRelatorio(opts: { posts: readonly PostDoRelatorio[]; geradoEm: Date; modelo: string; estimativa?: Estimativa }): string {
  const { posts, geradoEm, modelo, estimativa } = opts;
  const resumo = custoPorPost(posts);
  const gastoReal = posts.reduce((s, p) => s + (p.medium.custo ?? 0) + (p.high.custo ?? 0), 0);
  const tempoMedio = (q: QualidadeComparada) => posts.reduce((s, p) => s + p[q].tempoMs, 0) / Math.max(1, posts.length);

  const topo = resumo
    ? `<section class="resumo" aria-label="Custo de um post de ${ARTES_POR_POST} artes">
        <div><span>Medium</span><strong>${dinheiro(resumo.medium)}</strong><small>por post de ${ARTES_POR_POST} artes</small></div>
        <div><span>High</span><strong>${dinheiro(resumo.high)}</strong><small>por post de ${ARTES_POR_POST} artes</small></div>
        <div class="destaque"><span>Diferença</span><strong>${comSinal(resumo.diferenca)}</strong><small>por post, o high custa ${resumo.vezes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vezes o medium</small></div>
      </section>`
    : `<section class="resumo"><div class="destaque"><span>Custo por post</span><strong>sem dado</strong><small>alguma resposta veio sem o consumo, então a conta não fecha</small></div></section>`;

  const par = (p: PostDoRelatorio, i: number) => {
    const figura = (q: QualidadeComparada) => `<figure>
          <img src="${escapar(p[q].arquivo)}" alt="${escapar(p.headline)} em qualidade ${q}" loading="lazy">
          <figcaption><b>${q}</b><span>${dinheiro(p[q].custo)}</span><span>${segundos(p[q].tempoMs)}</span><span>${numero(p[q].tokensDeSaida)} tokens de saída</span></figcaption>
        </figure>`;
    const dif = p.medium.custo !== null && p.high.custo !== null ? `. Por arte, o high custa ${comSinal(p.high.custo - p.medium.custo)}.` : ".";
    return `<article>
        <h2>${i + 1}. ${escapar(p.titulo)}</h2>
        <p class="guia">${escapar(p.guia)}${dif}</p>
        <div class="par">${figura("medium")}${figura("high")}</div>
      </article>`;
  };

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Medium contra high</title>
<style>
  :root { --fundo: #f0efea; --papel: #fff; --texto: #1f2a2b; --suave: #5b6667; --linha: #d9d7cf; --teal: #2f646a; --realce: #e3f1ef; }
  @media (prefers-color-scheme: dark) { :root { --fundo: #141a1b; --papel: #1c2425; --texto: #eef2f1; --suave: #9db0b0; --linha: #2e3a3b; --teal: #63b5af; --realce: #1f3534; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--fundo); color: var(--texto); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  h2 { margin: 0; font-size: 18px; }
  .sub { margin: 0 0 24px; color: var(--suave); }
  .resumo { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 12px; }
  .resumo div { background: var(--papel); border: 1px solid var(--linha); border-radius: 12px; padding: 16px; display: grid; gap: 2px; }
  .resumo .destaque { background: var(--realce); border-color: var(--teal); }
  .resumo span { color: var(--suave); font-size: 14px; }
  .resumo strong { font-size: 28px; font-variant-numeric: tabular-nums; }
  .resumo small { color: var(--suave); }
  .nota { margin: 0 0 32px; color: var(--suave); font-size: 14px; }
  article { margin-bottom: 40px; }
  .guia { margin: 2px 0 12px; color: var(--suave); font-size: 14px; }
  .par { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  figure { margin: 0; background: var(--papel); border: 1px solid var(--linha); border-radius: 12px; overflow: hidden; }
  img { display: block; width: 100%; height: auto; }
  figcaption { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 12px 16px; font-size: 14px; font-variant-numeric: tabular-nums; }
  figcaption b { color: var(--teal); text-transform: uppercase; letter-spacing: .04em; }
  @media (max-width: 560px) { .par { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <h1>Medium contra high</h1>
  <p class="sub">${escapar(modelo)}, ${posts.length} ${posts.length === 1 ? "pedido" : "pedidos"}, gerado em ${geradoEm.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
  ${topo}
  <p class="nota">Custo pelo consumo que a resposta do modelo informou e pela tabela de preços do app. Tempo médio por arte: medium ${segundos(tempoMedio("medium"))}, high ${segundos(tempoMedio("high"))}. Gasto real desta rodada: ${dinheiro(gastoReal)}${estimativa ? `, estimado antes: ${dinheiro(estimativa.total)}` : ""}.</p>
  ${posts.map(par).join("\n  ")}
</main>
</body>
</html>
`;
}
