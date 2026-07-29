import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
import type { Brief } from "../art/pipeline";

export const TEXT_MODEL = "gemini-3.6-flash";

let _ai: GoogleGenAI | null = null;
const ai = () => (_ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

const voice = () => readFileSync("brand/voice.md", "utf8");

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

/** Headline que vai DENTRO da arte — sempre gerado antes da imagem (PRD §3.3). */
export async function definirHeadline(brief: Brief, formato: string): Promise<{ headline: string; apoio: string }> {
  const r: any = await ai().interactions.create({
    model: TEXT_MODEL,
    system_instruction: `Você escreve textos curtos que vão DENTRO de artes do Instagram da EM Vidros.\n${voice()}`,
    input: `Brief: ${JSON.stringify(brief)}. Formato: ${formato}.
Gere o texto da arte em JSON: {"headline": "...", "apoio": "..."}.
Headline: curta, impactante, português impecável. Apoio: 1 linha (em stories, ainda mais curto ou vazio). Responda SÓ o JSON.`,
  });
  const txt = textOf(r).replace(/```json?|```/g, "").trim();
  return JSON.parse(txt);
}

/** Legenda de publicação — SÓ quando o formato inclui Feed (US-4). */
export async function escreverLegenda(brief: Brief, headline: string): Promise<string> {
  const r: any = await ai().interactions.create({
    model: TEXT_MODEL,
    system_instruction: `Você escreve legendas do Instagram da EM Vidros.\n${voice()}`,
    input: `Brief: ${JSON.stringify(brief)}. Headline da arte: "${headline}".
Escreva a legenda: 50–100 palavras (sem contar hashtags), abertura → corpo → CTA → linha em branco → 5–10 hashtags, #EMVidros SEMPRE a primeira. Emojis com moderação; 🩵 é a assinatura. Regras por tipo estão no guia. Responda SÓ a legenda.`,
  });
  const legenda = textOf(r);
  if (!/#EMVidros/i.test(legenda)) throw new Error("Legenda sem #EMVidros");
  return legenda;
}
