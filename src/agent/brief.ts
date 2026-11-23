import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { PILARES, type Brief } from "../domain/art/pipeline";
import { CONVERSA } from "../domain/brand";
import { montarBrief as briefComPublico, PUBLICOS } from "../domain/publico";
import { MODELO_DE_TEXTO, openai } from "../openai";
import { REGRA_DA_IMAGEM, REGRA_DO_PEDIDO, REGRA_DOS_PILARES } from "./bots";
import { contextoDeData } from "./hoje";
import type { Formato } from "./post";

const BriefLido = z.object({
  pilar: z.enum(PILARES),
  tema: z.string(),
  angulo: z.string().nullable(),
  data: z.string().nullable(),
  publico: z.enum(PUBLICOS).nullable(),
  precisa_foto_real: z.boolean(),
  formato: z.enum(["feed", "stories", "ambos"]),
  direcao: z.string().max(1500).nullable(),
  alternativa_tipografica: z.object({ tema: z.string(), angulo: z.string() }).nullable(),
});

/**
 * As regras de decisão que moravam no prompt do Post: pilar, foto real (§8.2), público (§1.2), formato e estilo pedido.
 * Ficam antes do brandbook e do pedido, e não mudam entre posts: a OpenAI reaproveita o prefixo do cache.
 */
const REGRAS = [
  "Você monta o brief de um post do Instagram da EM Vidros a partir do pedido. Não pergunta nada: decide com o que tem.",
  REGRA_DOS_PILARES,
  REGRA_DA_IMAGEM,
  "Quando precisa_foto_real for true, escreva em alternativa_tipografica um tema e um ângulo tipográficos, que não mostrem produto, obra nem pessoas, para o caso de o banco de fotos não ter foto que sirva. Quando for false, alternativa_tipografica é null.",
  "Público (§1.2): vidraceiro, arquiteto ou consumidor. Tire do pedido; se o pedido não diz, publico é null e o post sai para o vidraceiro. Arquiteto e consumidor são levados a uma vidraçaria parceira, nunca à EM Vidros.",
  "Formato: o que o pedido disser (feed, stories ou ambos). Sem formato no pedido, feed.",
  "Estilo: quando o pedido pede um estilo de arte (mais gráfico, com ilustração, minimalista, colagem, outro clima), escreva em direcao uma direção de arte concreta, como um diretor de arte: composição, elementos, tipografia, textura e luz. Sem estilo pedido, direcao é null e a arte sai no estilo da casa.",
  REGRA_DO_PEDIDO,
  "Tema e ângulo concretos, com o assunto do pedido nas palavras da marca. data é a data do post em AAAA-MM-DD quando o pedido cita uma, senão null.",
].join("\n\n");

const instrucoes = () => `${REGRAS}\n\n--- BRANDBOOK (capítulos de conteúdo) ---\n${CONVERSA()}`;

export interface BriefDoPedido {
  brief: Brief;
  formato: Formato;
  direcao: string | null;
  /** O brief tipográfico para quando o post pede foto real e o banco não tem uma que sirva. */
  alternativa: Brief | null;
}

/** Uma chamada ao modelo de texto, com saída estruturada. A data de hoje vai junto do pedido, depois da parte fixa. */
export async function montarBrief(pedido: string, agora = Date.now()): Promise<BriefDoPedido> {
  const resposta = await (await openai()).responses.parse({
    model: MODELO_DE_TEXTO,
    reasoning: { effort: "low" },
    instructions: instrucoes(),
    input: `${contextoDeData(agora)}\n\n--- PEDIDO ---\n${pedido}`,
    prompt_cache_key: "em-vidros-brief",
    text: { format: zodTextFormat(BriefLido, "brief") },
  });
  const lido = resposta.output_parsed;
  if (!lido) throw new Error("O modelo não devolveu o brief do post.");
  const brief: Brief = briefComPublico({
    pilar: lido.pilar,
    tema: lido.tema,
    ...(lido.angulo && { angulo: lido.angulo }),
    ...(lido.data && { data: lido.data }),
    ...(lido.publico && { publico: lido.publico }),
    precisaFotoReal: lido.precisa_foto_real,
  });
  const alt = lido.precisa_foto_real ? lido.alternativa_tipografica : null;
  return {
    brief,
    formato: lido.formato,
    direcao: lido.direcao,
    alternativa: alt && { ...brief, tema: alt.tema, angulo: alt.angulo, precisaFotoReal: false },
  };
}
