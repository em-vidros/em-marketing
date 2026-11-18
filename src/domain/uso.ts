import { q } from "../v2/banco";

/**
 * Uso das APIs de IA, uma linha por chamada: tokens de entrada e saída e imagens geradas.
 * Custo em dinheiro fica no painel do provedor; aqui é o volume, que o sistema mede sozinho.
 */
export interface Uso {
  origem: string;
  modelo: string;
  entrada: number;
  saida: number;
  imagens: number;
}

/** Nunca derruba quem chamou: perder uma linha de uso é melhor que perder a resposta. */
export async function registrarUso(u: Uso): Promise<void> {
  if (u.entrada === 0 && u.saida === 0 && u.imagens === 0) return;
  await q`INSERT INTO uso_api (em, origem, modelo, entrada, saida, imagens) VALUES (${Date.now()}, ${u.origem}, ${u.modelo}, ${u.entrada}, ${u.saida}, ${u.imagens})`.catch(
    (e) => console.error("uso_api:", e),
  );
}

interface CorpoDaOpenAI {
  model?: string;
  data?: unknown[];
  usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
}

/**
 * O fetch do cliente da OpenAI. Lê o `usage` das respostas JSON (responses, images) e grava;
 * a resposta de imagem não diz o modelo, por isso ele vem de quem cria o cliente.
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
        .then((corpo: CorpoDaOpenAI) => {
          const ehImagem = url.includes("/images/");
          return registrarUso({
            origem,
            modelo: corpo.model ?? (ehImagem ? modeloDeImagem : "texto"),
            entrada: corpo.usage?.input_tokens ?? corpo.usage?.prompt_tokens ?? 0,
            saida: corpo.usage?.output_tokens ?? corpo.usage?.completion_tokens ?? 0,
            imagens: ehImagem ? (corpo.data?.length ?? 0) : 0,
          });
        })
        .catch(() => {});
    }
    return res;
  }) as typeof fetch;
}

/** GET /api/uso. Os totais do mês corrente e de cada um dos últimos 30 dias, por modelo. */
export interface ResumoDoUso {
  mes: string;
  totalDoMes: { chamadas: number; entrada: number; saida: number; imagens: number };
  porModelo: { modelo: string; chamadas: number; entrada: number; saida: number; imagens: number }[];
  porDia: { dia: string; entrada: number; saida: number; imagens: number }[];
  porOrigem: { origem: string; chamadas: number; entrada: number; saida: number; imagens: number }[];
}

const FUSO = "America/Sao_Paulo";
const diaSP = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });

export async function resumoDoUso(agora: number = Date.now()): Promise<ResumoDoUso> {
  const mes = diaSP.format(agora).slice(0, 7);
  const inicio = agora - 30 * 86_400_000;
  // Brasil é UTC-3 fixo desde 2019: o dia local é o epoch menos 3 horas.
  const linhas = await q<{ dia: string; origem: string; modelo: string; chamadas: number; entrada: number; saida: number; imagens: number }>`
    SELECT to_char(to_timestamp(em / 1000) AT TIME ZONE 'UTC' - interval '3 hours', 'YYYY-MM-DD') AS dia, origem, modelo,
      count(*)::int AS chamadas, sum(entrada)::double precision AS entrada, sum(saida)::double precision AS saida, sum(imagens)::double precision AS imagens
    FROM uso_api WHERE em >= ${Math.min(inicio, Date.parse(`${mes}-01T03:00:00Z`))}
    GROUP BY 1, 2, 3`;

  const doMes = linhas.filter((l) => l.dia.startsWith(mes));
  const somar = <K extends string>(itens: typeof linhas, chave: (l: (typeof linhas)[number]) => K) => {
    const mapa = new Map<K, { chamadas: number; entrada: number; saida: number; imagens: number }>();
    for (const l of itens) {
      const t = mapa.get(chave(l)) ?? { chamadas: 0, entrada: 0, saida: 0, imagens: 0 };
      mapa.set(chave(l), { chamadas: t.chamadas + l.chamadas, entrada: t.entrada + l.entrada, saida: t.saida + l.saida, imagens: t.imagens + l.imagens });
    }
    return [...mapa];
  };
  const totalDoMes = somar(doMes, () => "total" as const)[0]?.[1] ?? { chamadas: 0, entrada: 0, saida: 0, imagens: 0 };
  const dias = Array.from({ length: 30 }, (_, i) => diaSP.format(agora - (29 - i) * 86_400_000));
  const porDiaMapa = new Map(somar(linhas, (l) => l.dia));

  return {
    mes,
    totalDoMes,
    porModelo: somar(doMes, (l) => l.modelo)
      .map(([modelo, t]) => ({ modelo, ...t }))
      .sort((a, b) => b.entrada + b.saida - (a.entrada + a.saida) || b.imagens - a.imagens),
    porOrigem: somar(doMes, (l) => l.origem)
      .map(([origem, t]) => ({ origem, ...t }))
      .sort((a, b) => b.chamadas - a.chamadas),
    porDia: dias.map((dia) => {
      const t = porDiaMapa.get(dia);
      return { dia, entrada: t?.entrada ?? 0, saida: t?.saida ?? 0, imagens: t?.imagens ?? 0 };
    }),
  };
}
