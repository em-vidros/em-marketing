import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createProviderRegistry } from "ai";

/** Os modelos que um bot pode usar. Um id fora desta lista não chega ao banco. */
export const MODELOS = [
  { id: "openai:gpt-6-luna", nome: "GPT-6 Luna" },
  { id: "anthropic:claude-opus-5-5", nome: "Claude Opus 5.5" },
  { id: "anthropic:claude-sonnet-5-5", nome: "Claude Sonnet 5.5" },
  { id: "anthropic:claude-haiku-5-5", nome: "Claude Haiku 5.5" },
] as const satisfies readonly { id: `${Provedor}:${string}`; nome: string }[];

type Provedor = "openai" | "anthropic";

export type ModelId = (typeof MODELOS)[number]["id"];

/** GET /api/modelos. `disponivel` é false quando falta a chave do provedor no servidor. */
export interface Modelo {
  id: ModelId;
  nome: string;
  disponivel: boolean;
}

const CHAVE: Record<Provedor, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

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
  openai: createOpenAI(),
  anthropic: createAnthropic(),
});

export const modelo = (id: ModelId) => registry.languageModel(id);
