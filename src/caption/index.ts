import { GoogleGenAI } from "@google/genai";
import type { Brief } from "../art/pipeline";
import { VOZ } from "../brand";
import { validarLegenda, validarTextoDaArte, temErro, formatarProblemas, type Problema } from "../brand/validate";

export const TEXT_MODEL = "gemini-3.6-flash";

let _ai: GoogleGenAI | null = null;
const ai = () => (_ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

function textOf(interaction: any): string {
  const parts: string[] = [];
  const scan = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    for (const v of Array.isArray(n) ? n : Object.values(n)) scan(v);
  };
  scan(interaction.outputs ?? interaction.steps ?? interaction);
  return parts.join("").trim();
}

/**
 * Gera, valida contra o checklist do capítulo 16 e devolve para reescrita quando
 * há erro. Duas tentativas: o modelo erra a norma com frequência suficiente para
 * compensar o retry, e raramente erra duas vezes a mesma regra depois de vê-la.
 */
async function gerarValidando(
  system: string,
  prompt: string,
  validar: (saida: string) => Problema[],
  tentativas = 2,
): Promise<{ texto: string; problemas: Problema[] }> {
  let previousId: string | undefined;
  let texto = "";
  let problemas: Problema[] = [];

  for (let i = 0; i < tentativas; i++) {
    const r: any = await ai().interactions.create({
      model: TEXT_MODEL,
      system_instruction: system,
      input:
        i === 0
          ? prompt
          : `A versão anterior viola o brandbook:\n${formatarProblemas(problemas)}\n\nReescreva corrigindo TODOS os itens marcados como [erro]. Mesmo brief, mesma intenção. Responda só o texto final.`,
      previous_interaction_id: previousId,
      store: true,
    });
    previousId = r.id;
    texto = textOf(r);
    problemas = validar(texto);
    if (!temErro(problemas)) break;
  }
  return { texto, problemas };
}

const SYSTEM_TEXTO = () =>
  [
    "Você escreve o texto do Instagram da EM Vidros. O brandbook abaixo é normativo:",
    'onde ele diz "nunca", é nunca. Você será validado por código contra o checklist do capítulo 16.',
    VOZ(),
  ].join("\n");

/** Headline que vai DENTRO da arte — sempre gerado antes da imagem (PRD §3.3). */
export async function definirHeadline(
  brief: Brief,
  formato: string,
): Promise<{ headline: string; apoio: string; problemas: Problema[] }> {
  const { texto, problemas } = await gerarValidando(
    SYSTEM_TEXTO(),
    `Brief: ${JSON.stringify(brief)}. Formato: ${formato}.
Gere o texto que vai DENTRO da arte, em JSON: {"headline": "...", "apoio": "..."}.
Headline curto e concreto, português impecável, no máximo 8 palavras. Apoio: 1 linha (em stories, vazio).
Emoji é proibido na arte (§11.2). Unidades como "10 mm", "6, 8 e 10 mm". Responda SÓ o JSON.`,
    (saida) => {
      try {
        const { headline, apoio } = JSON.parse(saida.replace(/```json?|```/g, "").trim());
        return validarTextoDaArte(headline ?? "", apoio ?? "");
      } catch {
        return [{ regra: "formato", severidade: "erro", detalhe: "resposta não é JSON válido." }];
      }
    },
  );

  const { headline, apoio } = JSON.parse(texto.replace(/```json?|```/g, "").trim());
  return { headline, apoio: apoio ?? "", problemas };
}

/** Legenda de publicação — SÓ quando o formato inclui Feed (US-4). */
export async function escreverLegenda(
  brief: Brief,
  headline: string,
): Promise<{ legenda: string; problemas: Problema[] }> {
  const { texto, problemas } = await gerarValidando(
    SYSTEM_TEXTO(),
    `Brief: ${JSON.stringify(brief)}. Headline da arte: "${headline}". Pilar: ${brief.pilar}.
Escreva a legenda seguindo a estrutura fixa do §10.1:
gancho (1 linha, no máximo 8 palavras, sem emoji, sem pergunta genérica) → linha em branco →
corpo (2 a 4 linhas, uma ideia por linha) → linha em branco →
${brief.pilar === "MARCA" ? "SEM CTA (§10.3: post do pilar MARCA não leva CTA)" : "1 CTA, um único pedido"} → linha em branco →
bloco de no máximo 5 hashtags, #EMVidros a primeira.
Responda SÓ a legenda.`,
    (saida) => validarLegenda(saida, { pilar: brief.pilar }),
  );

  return { legenda: texto, problemas };
}
