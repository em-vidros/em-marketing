import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import tokens from "../../brand/tokens.json";

export type Formato = "feed" | "stories";

const FORMATS = {
  feed: { ar: "4:5" as const, w: 1080, h: 1350 },
  stories: { ar: "9:16" as const, w: 1080, h: 1920 },
};

export const IMAGE_MODEL = "gemini-3.1-flash-image";

let _ai: GoogleGenAI | null = null;
function ai() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _ai;
}

function logoBase64(variant: "cor" | "branco"): { data: string; mime: string } {
  const path = new URL(`../../brand/assets/logo-${variant}.png`, import.meta.url).pathname;
  return { data: readFileSync(path).toString("base64"), mime: "image/png" };
}

function extractImage(interaction: any): Buffer {
  const scan = (node: any): string | undefined => {
    if (!node || typeof node !== "object") return;
    if (node.type === "image" && typeof node.data === "string" && node.data.length > 1000) return node.data;
    for (const v of Array.isArray(node) ? node : Object.values(node)) {
      const hit = scan(v);
      if (hit) return hit;
    }
  };
  const data = scan(interaction.outputs ?? interaction.steps ?? interaction);
  if (!data) throw new Error("Nenhuma imagem na resposta da Interactions API");
  return Buffer.from(data, "base64");
}

export interface ArtResult {
  jpeg: Buffer;
  interactionId: string;
}

/**
 * Gera uma arte no formato pedido e normaliza para a dimensão exata
 * (resize cover + crop → JPEG q90 sRGB), conforme PRD §3.3.
 */
export async function generateArt(opts: {
  prompt: string;
  formato: Formato;
  logoVariant?: "cor" | "branco";
  previousInteractionId?: string;
}): Promise<ArtResult> {
  const f = FORMATS[opts.formato];
  const logo = logoBase64(opts.logoVariant ?? "cor");

  const interaction: any = await ai().interactions.create({
    model: IMAGE_MODEL,
    input: [
      { type: "image", data: logo.data, mime_type: logo.mime },
      { type: "text", text: opts.prompt },
    ] as any,
    response_format: { type: "image", aspect_ratio: f.ar, image_size: "2K" } as any,
    previous_interaction_id: opts.previousInteractionId,
    store: true,
  });

  const raw = extractImage(interaction);
  const jpeg = await sharp(raw)
    .resize(f.w, f.h, { fit: "cover", position: "attention" })
    .jpeg({ quality: tokens.output.quality })
    .toColorspace("srgb")
    .toBuffer();

  if (jpeg.byteLength > tokens.output.maxBytes)
    throw new Error(`JPEG acima de 8 MB: ${jpeg.byteLength}`);

  return { jpeg, interactionId: interaction.id };
}
