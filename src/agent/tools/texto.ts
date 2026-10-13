import { tool } from "ai";
import { z } from "zod";
import { PILARES } from "../../domain/art/pipeline";
import { escreverLegenda } from "../../domain/caption";
import { temErro, validarLegenda, validarTextoDaArte } from "../../domain/brand/validate";
import { validarRoteiro } from "../../domain/reel";

const pilar = z.enum(PILARES);

export const toolsDeTexto = {
  validar_texto: tool({
    description: "Confere um texto contra o checklist do capítulo 16. Legenda de publicação ou texto que vai dentro da arte.",
    inputSchema: z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("legenda"), texto: z.string(), pilar: pilar.optional() }),
      z.object({ tipo: z.literal("arte"), headline: z.string(), apoio: z.string().optional() }),
    ]),
    execute: async (input) => {
      const problemas =
        input.tipo === "legenda" ? validarLegenda(input.texto, { pilar: input.pilar }) : validarTextoDaArte(input.headline, input.apoio);
      return { problemas, aprovado: !temErro(problemas) };
    },
  }),

  redigir_legenda: tool({
    description: "Escreve uma legenda avulsa a partir de um brief, fora do fluxo de post. Valida contra o capítulo 16 e reescreve uma vez se houver erro.",
    inputSchema: z.object({
      pilar,
      tema: z.string(),
      angulo: z.string().optional(),
      headline: z.string().optional().describe("texto da arte, se já existir"),
    }),
    execute: async ({ headline, ...brief }) => {
      const { legenda, problemas } = await escreverLegenda(brief, headline ?? "");
      return { legenda, problemas, aprovado: !temErro(problemas) };
    },
  }),

  roteiro_reel: tool({
    description: "Registra o roteiro de um Reel e confere contra o capítulo 14: ritmo por função do plano, duração alvo do pilar, capa e texto em tela.",
    inputSchema: z.object({
      pilar,
      perfil: z.enum(["produto", "mini-vlog"]).describe("§14.2: produto sai mudo; mini-vlog leva áudio embutido"),
      planos: z
        .array(
          z.object({
            funcao: z.enum(["estabelecer", "detalhar", "fechar"]),
            segundos: z.number().positive(),
            imagem: z.string().describe("o que a câmera mostra"),
            textoEmTela: z.string().optional(),
            fala: z.string().optional(),
          }),
        )
        .min(2),
      tituloDaCapa: z.string().describe("§14.9: até 5 palavras"),
    }),
    execute: async (roteiro) => {
      const problemas = validarRoteiro(roteiro);
      return { roteiro, segundos: roteiro.planos.reduce((s, p) => s + p.segundos, 0), problemas, aprovado: !temErro(problemas) };
    },
  }),
};
