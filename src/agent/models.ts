import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { chaveDe, type Provedor } from "../domain/chaves";

/** Os modelos que um bot pode usar. Um id fora desta lista não chega ao banco. */
export const MODELOS = [
  { id: "openai:gpt-6-luna", nome: "GPT-6 Luna" },
  { id: "anthropic:claude-opus-5-5", nome: "Claude Opus 5.5" },
  { id: "anthropic:claude-sonnet-5-5", nome: "Claude Sonnet 5.5" },
  { id: "anthropic:claude-haiku-5-5", nome: "Claude Haiku 5.5" },
] as const satisfies readonly { id: `${Provedor}:${string}`; nome: string }[];

export type ModelId = (typeof MODELOS)[number]["id"];

/** GET /api/modelos. `disponivel` é false quando não há chave do provedor, nem da equipe nem do servidor. */
export interface Modelo {
  id: ModelId;
  nome: string;
  disponivel: boolean;
}

const provedorDe = (id: ModelId) => id.slice(0, id.indexOf(":")) as Provedor;

export const ehModelId = (s: string): s is ModelId => MODELOS.some((m) => m.id === s);

/** Lido a cada chamada: a equipe pode conectar uma chave sem mudar o código. */
export async function modelos(): Promise<Modelo[]> {
  const comChave = new Set(await Promise.all((["openai", "anthropic"] as const).map(async (p) => ((await chaveDe(p)) ? p : null))));
  return MODELOS.map((m) => ({ ...m, disponivel: comChave.has(provedorDe(m.id)) }));
}

/** Por que um bot não pode usar este modelo, ou null se pode. */
export async function problemaDoModelo(id: string): Promise<string | null> {
  const m = (await modelos()).find((x) => x.id === id);
  if (!m) return `Modelo desconhecido: ${id}.`;
  if (!m.disponivel) return `O ${m.nome} não está disponível: falta conectar uma chave da ${provedorDe(m.id) === "openai" ? "OpenAI" : "Anthropic"} em Uso da API.`;
  return null;
}

/** O provedor nasce a cada turno com a chave do momento: trocar a chave vale no turno seguinte. */
export async function modelo(id: ModelId): Promise<LanguageModel> {
  const p = provedorDe(id);
  const nome = id.slice(id.indexOf(":") + 1);
  const apiKey = await chaveDe(p);
  return p === "openai" ? createOpenAI({ apiKey })(nome) : createAnthropic({ apiKey })(nome);
}
