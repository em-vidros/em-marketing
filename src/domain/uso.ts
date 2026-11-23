import { AsyncLocalStorage } from "node:async_hooks";
import { q } from "../v2/banco";
import { custoDe, type Consumo } from "./precos";

/**
 * Uso das APIs de IA, uma linha por chamada: tokens, imagens e o custo em US$ pela tabela de precos.ts.
 * A linha leva a conversa e o post em andamento nela, para dar o custo de cada post.
 */
export interface Uso extends Consumo {
  origem: string;
  imagens: number;
}

const conversaAtual = new AsyncLocalStorage<string>();

/** O uso gravado dentro de `fn`, mesmo o de um cliente da OpenAI criado lá no fundo, cai na conta desta conversa. */
export const naConversa = <T>(conversaId: string, fn: () => T): T => conversaAtual.run(conversaId, fn);

/** Nunca derruba quem chamou: perder uma linha de uso é melhor que perder a resposta. */
export async function registrarUso(u: Uso, conversa: string | null = conversaAtual.getStore() ?? null): Promise<void> {
  if (u.entrada === 0 && u.saida === 0 && u.imagens === 0) return;
  await q`INSERT INTO uso_api (em, origem, modelo, entrada, saida, imagens, cache_lido, cache_escrito, entrada_imagem, custo, conversa, post_id)
    VALUES (${Date.now()}, ${u.origem}, ${u.modelo}, ${u.entrada}, ${u.saida}, ${u.imagens}, ${u.cacheLido ?? 0}, ${u.cacheEscrito ?? 0},
      ${u.entradaImagem ?? 0}, ${custoDe(u)}, ${conversa}, (SELECT post_id FROM conversas WHERE id = ${conversa}))`.catch((e) => console.error("uso_api:", e));
}

interface CorpoDaOpenAI {
  model?: string;
  data?: unknown[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; image_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/** A linha de uso de uma resposta JSON da OpenAI. A resposta de imagem não diz o modelo, por isso ele vem de quem cria o cliente. */
export function usoDaResposta(origem: string, url: string, corpo: CorpoDaOpenAI, modeloDeImagem: string): Uso {
  const ehImagem = url.includes("/images/");
  const u = corpo.usage;
  return {
    origem,
    modelo: corpo.model ?? (ehImagem ? modeloDeImagem : "texto"),
    entrada: u?.input_tokens ?? u?.prompt_tokens ?? 0,
    saida: u?.output_tokens ?? u?.completion_tokens ?? 0,
    cacheLido: u?.input_tokens_details?.cached_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0,
    entradaImagem: u?.input_tokens_details?.image_tokens ?? 0,
    imagens: ehImagem ? (corpo.data?.length ?? 0) : 0,
  };
}

/**
 * O fetch do cliente da OpenAI. Lê o `usage` das respostas JSON (responses, images) e grava;
 * a resposta segue intacta para o SDK. Streaming (SSE) não passa por aqui: o AI SDK conta pelo onFinish.
 */
export function fetchQueConta(origem: string, modeloDeImagem: string): typeof fetch {
  return (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(entrada, init);
    if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
      const url = String(entrada instanceof Request ? entrada.url : entrada);
      res
        .clone()
        .json()
        .then((corpo: CorpoDaOpenAI) => registrarUso(usoDaResposta(origem, url, corpo, modeloDeImagem)))
        .catch(() => {});
    }
    return res;
  }) as typeof fetch;
}

interface Totais {
  chamadas: number;
  entrada: number;
  saida: number;
  imagens: number;
  custo: number;
}

/** GET /api/uso. Os totais do mês corrente e de cada um dos últimos 30 dias, e o custo dos últimos posts. */
export interface ResumoDoUso {
  mes: string;
  totalDoMes: Totais;
  porModelo: ({ modelo: string } & Totais)[];
  porDia: { dia: string; entrada: number; saida: number; imagens: number; custo: number }[];
  porOrigem: ({ origem: string } & Totais)[];
  /** Custo médio de um post do mês, ou null sem post medido. */
  custoMedioPorPost: number | null;
  /** Os 10 posts mais recentes com uso medido, do mais novo para o mais velho. */
  porPost: { postId: number; headline: string | null; em: number; custo: number; imagens: number }[];
}

const FUSO = "America/Sao_Paulo";
const diaSP = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const ZERO: Totais = { chamadas: 0, entrada: 0, saida: 0, imagens: 0, custo: 0 };

export async function resumoDoUso(agora: number = Date.now()): Promise<ResumoDoUso> {
  const mes = diaSP.format(agora).slice(0, 7);
  const inicioDoMes = Date.parse(`${mes}-01T03:00:00Z`);
  const inicio = Math.min(agora - 30 * 86_400_000, inicioDoMes);
  // Brasil é UTC-3 fixo desde 2019: o dia local é o epoch menos 3 horas.
  const linhas = await q<{ dia: string; origem: string; modelo: string } & Totais>`
    SELECT to_char(to_timestamp(em / 1000) AT TIME ZONE 'UTC' - interval '3 hours', 'YYYY-MM-DD') AS dia, origem, modelo,
      count(*)::int AS chamadas, sum(entrada)::double precision AS entrada, sum(saida)::double precision AS saida,
      sum(imagens)::double precision AS imagens, coalesce(sum(custo), 0)::double precision AS custo
    FROM uso_api WHERE em >= ${inicio}
    GROUP BY 1, 2, 3`;
  const posts = await q<{ postId: number; headline: string | null; em: number; custo: number; imagens: number }>`
    SELECT u.post_id AS "postId", p.headline, max(u.em)::double precision AS em,
      coalesce(sum(u.custo), 0)::double precision AS custo, sum(u.imagens)::int AS imagens
    FROM uso_api u JOIN posts p ON p.id = u.post_id
    WHERE u.em >= ${inicio}
    GROUP BY u.post_id, p.headline
    ORDER BY max(u.em) DESC`;

  const doMes = linhas.filter((l) => l.dia.startsWith(mes));
  const somar = <K extends string>(itens: typeof linhas, chave: (l: (typeof linhas)[number]) => K) => {
    const mapa = new Map<K, Totais>();
    for (const l of itens) {
      const t = mapa.get(chave(l)) ?? ZERO;
      mapa.set(chave(l), {
        chamadas: t.chamadas + l.chamadas,
        entrada: t.entrada + l.entrada,
        saida: t.saida + l.saida,
        imagens: t.imagens + l.imagens,
        custo: t.custo + l.custo,
      });
    }
    return [...mapa];
  };
  const dias = Array.from({ length: 30 }, (_, i) => diaSP.format(agora - (29 - i) * 86_400_000));
  const porDiaMapa = new Map(somar(linhas, (l) => l.dia));
  const postsDoMes = posts.filter((p) => p.em >= inicioDoMes);

  return {
    mes,
    totalDoMes: somar(doMes, () => "total" as const)[0]?.[1] ?? ZERO,
    porModelo: somar(doMes, (l) => l.modelo)
      .map(([modelo, t]) => ({ modelo, ...t }))
      .sort((a, b) => b.custo - a.custo),
    porOrigem: somar(doMes, (l) => l.origem)
      .map(([origem, t]) => ({ origem, ...t }))
      .sort((a, b) => b.custo - a.custo),
    porDia: dias.map((dia) => {
      const t = porDiaMapa.get(dia) ?? ZERO;
      return { dia, entrada: t.entrada, saida: t.saida, imagens: t.imagens, custo: t.custo };
    }),
    custoMedioPorPost: postsDoMes.length ? postsDoMes.reduce((s, p) => s + p.custo, 0) / postsDoMes.length : null,
    porPost: posts.slice(0, 10),
  };
}
