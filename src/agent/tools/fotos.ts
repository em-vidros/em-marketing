import { tool } from "ai";
import { z } from "zod";
import { buscarFotos, catalogarFoto, contarFotos } from "../../domain/fotos";

export const toolsDeFotos = {
  buscar_fotos: tool({
    description:
      "Busca no banco de fotos reais da EM Vidros. Chame sempre que o brief exigir foto real (§8.2), antes de pedir foto nova ao usuário.",
    inputSchema: z.object({
      termo: z.string().optional().describe("produto, unidade ou contexto, ex.: 'box temperado Imperatriz'. Omita para ver as mais recentes."),
    }),
    execute: async ({ termo }) => ({ fotos: buscarFotos(termo), totalNoBanco: contarFotos() }),
  }),

  catalogar_foto: tool({
    description: "Descreve uma foto do banco com o modelo de visão e grava os campos de busca. A unidade vem do que o usuário disse, nunca da imagem.",
    inputSchema: z.object({
      foto_id: z.number().int(),
      legenda_do_usuario: z.string().optional(),
    }),
    execute: async ({ foto_id, legenda_do_usuario }) => ({ foto: await catalogarFoto(foto_id, legenda_do_usuario) }),
  }),
};
