import { tool } from "ai";
import { z } from "zod";
import { db } from "../../db";
import { tokens } from "../../domain/brand";
import { cotaDePilares } from "../../domain/brand/cota";
import { contarFotos } from "../../domain/fotos";
import { cancelQueueItem, listQueue } from "../../domain/scheduler";
import { proximasDatas } from "../../domain/scheduler/calendar";

const mesCorrente = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date());

/**
 * O código calcula o buraco e junta o material (pilar deficitário, datas que
 * passam no §12.4, fotos no banco). Quem redige a pauta é o modelo.
 */
function statusDoMes(mes: string) {
  // Brasil é UTC-3 sem horário de verão desde 2019; created_at é UTC.
  const linhas = db
    .query(
      `SELECT COALESCE(pilar,'(sem pilar)') AS pilar, COUNT(*) AS n
         FROM posts
        WHERE strftime('%Y-%m', created_at, '-3 hours') = ?
          AND status IN ('archived','scheduled','published')
        GROUP BY 1`,
    )
    .all(mes) as { pilar: string; n: number }[];

  const total = linhas.reduce((s, l) => s + l.n, 0);
  const { base, itens } = cotaDePilares(Object.fromEntries(linhas.map((l) => [l.pilar, l.n])), total);
  const { publicacoesPorMesMin, publicacoesPorMesMax, videoMin, proporcaoVideoAlvo } = tokens.cadencia;

  return {
    mes,
    publicacoes: { feitas: total, metaMin: publicacoesPorMesMin, metaMax: publicacoesPorMesMax, faltamParaMinimo: Math.max(0, publicacoesPorMesMin - total) },
    cota: itens.map((c) => ({ ...c, percentual: tokens.pilares[c.pilar].percentual, base })),
    semPilar: linhas.find((l) => l.pilar === "(sem pilar)")?.n ?? 0,
    // Este sistema só produz peça estática; o vídeo é feito fora dele.
    video: { feitos: 0, meta: videoMin, proporcaoAlvo: proporcaoVideoAlvo },
    deficit: itens
      .filter((c) => c.faltam > 0)
      .sort((a, b) => b.faltam - a.faltam)
      .map((d) => ({ pilar: d.pilar, faltam: d.faltam, ...tokens.pilares[d.pilar] })),
    datasDoMes: proximasDatas(45),
    fotosNoBanco: contarFotos(),
  };
}

export const toolsDeAgenda = {
  listar_agenda: tool({
    description: "Lista a fila de publicações agendadas.",
    inputSchema: z.object({}),
    execute: async () => ({
      fila: listQueue().map((i) => ({
        id: i.id,
        mediaType: i.media_type,
        publishAt: i.publish_at,
        tema: (JSON.parse(i.brief ?? "{}").tema as string | undefined) ?? null,
      })),
    }),
  }),

  status_do_mes: tool({
    description:
      "Cota do mês contra as metas do brandbook: mix de pilares 40/25/20/15 (§12.1), 8 a 10 publicações (§13.3) e 60% em vídeo (§12.3). Chame quando perguntarem o que falta postar, ou antes de propor pauta.",
    inputSchema: z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("AAAA-MM; omita para o mês corrente") }),
    execute: async ({ mes }) => statusDoMes(mes ?? mesCorrente()),
  }),

  cancelar_agendamento: tool({
    description: "Cancela um item pendente da fila pelo id.",
    inputSchema: z.object({ id: z.number().int() }),
    execute: async ({ id }) => ({ id, cancelado: cancelQueueItem(id) }),
  }),

  proximas_datas: tool({
    description: "Datas que passam na trava do §12.4 nos próximos dias. Só essas viram post de data; não invente outra.",
    inputSchema: z.object({ dias: z.number().int().min(1).max(366).optional() }),
    execute: async ({ dias }) => ({ datas: proximasDatas(dias ?? 45) }),
  }),
};
