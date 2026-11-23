import { tool } from "ai";
import { z } from "zod";
import { temErro } from "../../domain/brand/validate";
import { banco } from "../../v2/banco";
import { legendaDaPeca, listarPecasProntas } from "../../v2/pecas-prontas";

/** As peças prontas da Biblioteca. Agendar e publicar uma delas é agendar_publicacao e publicar_agora com peca_pronta_id. */
export const toolsDePecasProntas = {
  listar_pecas_prontas: tool({
    description:
      "Lista as peças prontas da Biblioteca: artes que a equipe fez fora do app, como no Canva, e subiu para publicar como estão. Cada uma traz a leitura (o texto pintado, o tema e o pilar), o formato e a legenda, se já tiver. Ache a peça que a pessoa pediu pela leitura, ou pelo começo do id quando o pedido trouxer um.",
    inputSchema: z.object({}),
    execute: async () => ({
      pecas: (await listarPecasProntas(banco())).map((p) => ({
        id: p.id,
        tema: p.tema,
        texto: p.texto,
        pilar: p.pilar,
        formato: p.formato,
        mediaType: p.formato === "feed" ? ("IMAGE" as const) : ("STORIES" as const),
        legenda: p.legenda,
        subidaEm: p.criadaEm.toISOString(),
      })),
    }),
  }),

  legenda_da_peca_pronta: tool({
    description:
      "Escreve a legenda de uma peça pronta do feed com o gerador de legenda dos posts, validado contra o capítulo 16, e guarda na peça. Uma peça que já tem legenda devolve a dela; passe refazer quando a pessoa pedir outra. Chame antes de agendar ou publicar uma peça do feed.",
    inputSchema: z.object({ peca_pronta_id: z.uuid(), refazer: z.boolean().optional() }),
    execute: async ({ peca_pronta_id, refazer }) => {
      const r = await legendaDaPeca(banco(), peca_pronta_id, { refazer });
      if (!r.ok) return r;
      return { ok: true as const, pecaProntaId: r.peca.id, legenda: r.peca.legenda, problemas: r.problemas, bloqueia: temErro(r.problemas) };
    },
  }),
};
