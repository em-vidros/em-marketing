import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createProviderRegistry } from "ai";

/** Os modelos que um bot pode usar. Um id fora desta lista não chega ao banco. */
export const MODELOS = [
  { id: "google:gemini-3.6-flash", nome: "Gemini 3.6 Flash" },
  { id: "anthropic:claude-opus-5-5", nome: "Claude Opus 5.5" },
  { id: "anthropic:claude-sonnet-5-5", nome: "Claude Sonnet 5.5" },
  { id: "anthropic:claude-haiku-5-5", nome: "Claude Haiku 5.5" },
] as const satisfies readonly { id: `${Provedor}:${string}`; nome: string }[];

type Provedor = "google" | "anthropic";

export type ModelId = (typeof MODELOS)[number]["id"];

/** GET /api/modelos. `disponivel` é false quando falta a chave do provedor no servidor. */
export interface Modelo {
  id: ModelId;
  nome: string;
  disponivel: boolean;
}

/** A chave do Gemini já se chama GEMINI_API_KEY no .env; o provider esperaria GOOGLE_GENERATIVE_AI_API_KEY. */
const CHAVE: Record<Provedor, string> = { google: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

const provedorDe = (id: ModelId) => id.slice(0, id.indexOf(":")) as Provedor;

export const ehModelId = (s: string): s is ModelId => MODELOS.some((m) => m.id === s);

/** Lido a cada chamada: a chave pode entrar no ambiente sem mudar o código. */
export const modelos = (env: Record<string, string | undefined> = process.env): Modelo[] =>
  MODELOS.map((m) => ({ ...m, disponivel: Boolean(env[CHAVE[provedorDe(m.id)]]) }));

/** Por que um bot não pode usar este modelo, ou null se pode. */
export function problemaDoModelo(id: string): string | null {
  const m = modelos().find((x) => x.id === id);
  if (!m) return `Modelo desconhecido: ${id}.`;
  if (!m.disponivel) return `O ${m.nome} não está disponível: falta a chave ${CHAVE[provedorDe(m.id)]} no servidor.`;
  return null;
}

const registry = createProviderRegistry({
  google: createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY }),
  anthropic: createAnthropic(),
});

export const modelo = (id: ModelId) => registry.languageModel(id);
