import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createProviderRegistry } from "ai";

export type ModelId = `${"google" | "anthropic"}:${string}`;

/** A chave do Gemini já se chama GEMINI_API_KEY no .env; o provider esperaria GOOGLE_GENERATIVE_AI_API_KEY. */
const registry = createProviderRegistry({
  google: createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY }),
  anthropic: createAnthropic(),
});

export const modelo = (id: ModelId) => registry.languageModel(id);
