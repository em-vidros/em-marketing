import { GoogleGenAI } from "@google/genai";
import type { Formato } from "./generate";
import tokens from "../../brand/tokens.json";

export const REVIEW_MODEL = "gemini-3.6-flash";

let _ai: GoogleGenAI | null = null;
const ai = () => (_ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

export interface Violacao {
  criterio: string;
  problema: string;
}

export interface ArtReview {
  aprovada: boolean;
  score: number;
  violacoes: Violacao[];
}

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

function rubric(opts: { formato: Formato; headline: string; tema: string }): string {
  const fmt = tokens.formats[opts.formato];
  const zones = opts.formato === "stories" ? tokens.formats.stories.safeZones : null;
  const logo = zones
    ? `- Zonas seguras: nada essencial nos ${zones.topPx}px de topo nem nos ${zones.bottomPx}px de base.\n- Logo: ${fmt.logoPlacement}.`
    : `- Logo: ${fmt.logoPlacement}.`;
  return `Avalie esta arte de Instagram (${opts.formato === "feed" ? "Feed 4:5" : "Stories 9:16"}).

Tema pedido no brief: ${opts.tema}
Headline que deveria estar renderizado na arte: "${opts.headline}"

Regras do brandbook EM Vidros:
- Paleta: teal dominante obrigatório, família ${tokens.color.primary.tealEM} / ${tokens.color.accent.tealVivo} / ${tokens.color.primaryLight.tealClaro}. Nenhuma outra cor pode ser a dominante.
${logo}
- Texto: português impecável, zero erro ortográfico; o headline deve aparecer exatamente como escrito acima e ser legível em tela de celular.
- Aderência: a imagem corresponde ao tema pedido.

Responda SÓ um JSON válido, sem markdown:
{"score": <0-10>, "aprovada": <true|false>, "violacoes": [{"criterio": "<paleta|logo|texto|zonas|aderencia>", "problema": "<o que está errado e como corrigir>"}]}

Critério: aprovada=true somente se score >= 7 E nenhuma violação de paleta, logo ou texto. Seja rigoroso com erro de português e com logo redesenhado.`;
}

/** Juiz multimodal: avalia a arte contra os gates do PRD §3.4 (paleta, logo, grafia, zonas, aderência). */
export async function reviewArt(opts: {
  jpeg: Buffer;
  formato: Formato;
  headline: string;
  tema: string;
}): Promise<ArtReview> {
  const r: any = await ai().interactions.create({
    model: REVIEW_MODEL,
    system_instruction:
      "Você é o controle de qualidade visual da EM Vidros. Avalia artes contra o brandbook e responde SÓ o JSON pedido.",
    input: [
      { type: "image", data: opts.jpeg.toString("base64"), mime_type: "image/jpeg" },
      { type: "text", text: rubric(opts) },
    ] as any,
  });
  const txt = textOf(r).replace(/```json?|```/g, "").trim();
  return JSON.parse(txt) as ArtReview;
}

/** Instrução de edição dirigida: corrige só as violações, preservando o conceito aprovado. */
export function refineInstruction(violacoes: Violacao[]): string {
  const lista = violacoes.map((v) => `- ${v.criterio}: ${v.problema}`).join("\n");
  return `Corrija APENAS estes problemas na imagem, mantendo todo o resto idêntico (conceito, composição, cores, estilo):\n${lista}`;
}
