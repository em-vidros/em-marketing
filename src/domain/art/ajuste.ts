import { zodTextFormat } from "openai/helpers/zod";
import sharp from "sharp";
import { z } from "zod";
import { MODELO_DE_TEXTO, openai } from "../../openai";
import { FORMATOS, type Formato as FormatoDoEstudio } from "../../v2/camadas";
import { editarComMascara, lerElementosCom } from "../../v2/ia";
import { comFolga, remendar, type Area, type Elementos } from "../../v2/separar";
import type { Problema } from "../brand/validate";
import { compararTexto, gerarConferida, REGRA_DO_TEXTO } from "./conferencia";
import { lerTextoDaArte, type Formato } from "./generate";

/** O que a pessoa pediu para mudar: um texto pintado na arte, ou um objeto da cena. */
export type PedidoDeAjuste = { tipo: "texto"; atual: string; novo: string } | { tipo: "objeto"; objeto: string; mudanca: string };

/** Os modelos que o ajuste chama. Os testes trocam todos juntos, para nenhum teste chegar à OpenAI. */
export interface IaDoAjuste {
  lerElementos(jpeg: Uint8Array, formato: FormatoDoEstudio): Promise<Elementos>;
  /** A caixa justa do objeto, em px da arte final, ou null quando ele não está na arte. */
  acharObjeto(jpeg: Uint8Array, formato: FormatoDoEstudio, objeto: string): Promise<Area | null>;
  /** Refaz só a área, com máscara. Devolve a imagem inteira, no tamanho do modelo. */
  editarArea(jpeg: Uint8Array, formato: FormatoDoEstudio, area: Area, prompt: string): Promise<Uint8Array>;
  lerTexto(jpeg: Uint8Array): Promise<string[]>;
}

export type Ajustada = { ok: true; jpeg: Uint8Array; area: Area; problemas: Problema[] } | { ok: false; motivo: string };

const doEstudio = (f: Formato): FormatoDoEstudio => (f === "stories" ? "story" : "feed");

const MARGEM = 40;

/**
 * Muda só a área que o pedido afeta e cola o resultado na arte original, então o resto fica igual pixel a pixel.
 * A área de um texto vem da leitura dos elementos da arte; a de um objeto, do modelo de visão.
 * O texto novo passa pela conferência como as artes novas: uma refação, depois o aviso.
 * `problemas` são os da versão atual; os de texto dão lugar aos da conferência nova.
 */
export async function ajustarArte(
  opts: { jpeg: Uint8Array; formato: Formato; pedido: PedidoDeAjuste; problemas: readonly Problema[] },
  ia: IaDoAjuste = IA_DA_OPENAI,
): Promise<Ajustada> {
  const { jpeg, pedido } = opts;
  const formato = doEstudio(opts.formato);

  if (pedido.tipo === "objeto") {
    const caixa = await ia.acharObjeto(jpeg, formato, pedido.objeto);
    if (!caixa) return { ok: false, motivo: `Não achei "${pedido.objeto}" na arte. Pergunte à pessoa onde fica.` };
    const area = comFolga(caixa, formato);
    const editada = await ia.editarArea(jpeg, formato, area, promptDoObjeto(pedido));
    return { ok: true, jpeg: await remendar(jpeg, editada, [area], formato), area, problemas: [...opts.problemas] };
  }

  const { textos } = await ia.lerElementos(jpeg, formato);
  const bloco = blocoDoTexto(textos, pedido.atual);
  if (!bloco)
    return {
      ok: false,
      motivo: `Não achei "${pedido.atual}" na arte. ${textos.length ? `Os textos dela são: ${textos.map((t) => `"${t.texto.replace(/\n/g, " ")}"`).join(", ")}.` : "A leitura não achou texto nela."}`,
    };
  const area = areaDoTexto(bloco, pedido, formato);
  const gerar = async (lembrete?: string) =>
    remendar(jpeg, await ia.editarArea(jpeg, formato, area, promptDoTexto(pedido, lembrete)), [area], formato, { comTexto: true });
  // Lê só a faixa do texto: fora da área nada muda, e o logo colado não é texto pedido.
  const topo = Math.max(0, Math.round(bloco.y) - 6);
  const faixa = { x: area.x, largura: area.largura, y: topo, altura: Math.min(Math.round(bloco.altura) + 12, FORMATOS[formato].altura - topo) };
  const ler = async (nova: Uint8Array) => ia.lerTexto(await recortar(nova, faixa));
  const { gerada, problemas } = await gerarConferida(gerar, ler, [pedido.novo]);
  return { ok: true, jpeg: gerada, area, problemas: [...opts.problemas.filter((p) => p.regra !== REGRA_DO_TEXTO), ...problemas] };
}

type Bloco = Elementos["textos"][number];

const contarPalavras = (s: string) => s.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean).length;

/** O bloco lido que mais se parece com o texto que a pessoa citou. Precisa bater pelo menos metade das palavras. */
export function blocoDoTexto(textos: readonly Bloco[], atual: string): Bloco | null {
  const pedidas = contarPalavras(atual);
  let melhor: { bloco: Bloco; faltando: number; total: number } | null = null;
  for (const bloco of textos) {
    const divergencias = compararTexto([atual], [bloco.texto]);
    const faltando = divergencias.filter((d) => d.tipo === "faltando").length;
    if (!melhor || faltando < melhor.faltando || (faltando === melhor.faltando && divergencias.length < melhor.total))
      melhor = { bloco, faltando, total: divergencias.length };
  }
  return melhor && melhor.faltando <= pedidas / 2 ? melhor.bloco : null;
}

/** A caixa do texto com folga. Texto novo mais longo ganha a largura da arte inteira, menos a margem, para caber na mesma linha. */
function areaDoTexto(bloco: Bloco, pedido: { atual: string; novo: string }, formato: FormatoDoEstudio): Area {
  const area = comFolga(bloco, formato);
  if (pedido.novo.length <= pedido.atual.length) return area;
  return { ...area, x: MARGEM, largura: FORMATOS[formato].largura - 2 * MARGEM };
}

const recortar = (jpeg: Uint8Array, a: Area) =>
  sharp(jpeg).extract({ left: a.x, top: a.y, width: a.largura, height: a.altura }).jpeg({ quality: 90 }).toBuffer();

export function promptDoTexto(pedido: { atual: string; novo: string }, lembrete?: string): string {
  return [
    `Inside the transparent area of the mask, replace the text "${pedido.atual}" with exactly this text: "${pedido.novo}".`,
    "Keep the same typeface, weight, size, colour, letter spacing, line height and alignment as the original text, and keep the background behind it.",
    "Render every word exactly as given, in Brazilian Portuguese, accents included, and nothing else.",
    "Keep everything outside the mask exactly as it is. Do not add any logo or object.",
    ...(lembrete ? [lembrete] : []),
  ].join(" ");
}

export function promptDoObjeto(pedido: { objeto: string; mudanca: string }): string {
  return [
    `Inside the transparent area of the mask there is ${pedido.objeto}. Change only this: ${pedido.mudanca}.`,
    "Where something is removed, fill with the background that surrounds it, continuing its colour, texture, light and shapes.",
    "Keep everything outside the mask exactly as it is. Do not add any text or logo, and nothing beyond what was asked.",
  ].join(" ");
}

const Caixa = z.object({
  achou: z.boolean(),
  x: z.number(),
  y: z.number(),
  largura: z.number(),
  altura: z.number(),
});

const INSTRUCOES_DO_OBJETO = (largura: number, altura: number) => `
Você recebe uma arte de Instagram com ${largura}×${altura} px e a descrição de um objeto dela.
Devolva a caixa justa em volta do objeto, em px desta imagem, com a origem no canto de cima à esquerda.
Se o objeto não estiver na arte, achou é false e a caixa é zero.
`.trim();

const IA_DA_OPENAI: IaDoAjuste = {
  lerElementos: async (jpeg, formato) => lerElementosCom(await openai(), jpeg, formato),
  editarArea: async (jpeg, formato, area, prompt) => editarComMascara(await openai(), jpeg, formato, [area], prompt),
  lerTexto: lerTextoDaArte,
  async acharObjeto(jpeg, formato, objeto) {
    const { largura, altura } = FORMATOS[formato];
    const resposta = await (await openai()).responses.parse({
      model: MODELO_DE_TEXTO,
      reasoning: { effort: "low" },
      instructions: INSTRUCOES_DO_OBJETO(largura, altura),
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", detail: "high", image_url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` },
            { type: "input_text", text: objeto },
          ],
        },
      ],
      text: { format: zodTextFormat(Caixa, "caixa") },
    });
    const caixa = resposta.output_parsed;
    if (!caixa) throw new Error("O modelo não devolveu a caixa do objeto.");
    return caixa.achou && caixa.largura > 0 && caixa.altura > 0 ? { x: caixa.x, y: caixa.y, largura: caixa.largura, altura: caixa.altura } : null;
  },
};
