import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { primeira } from "../db";
import { q } from "../v2/banco";

/**
 * As chaves de IA que a equipe conecta pela tela de uso. A chave do banco vale mais que a do
 * ambiente: assim qualquer pessoa logada troca a chave sem mexer na Vercel. Sem nenhuma no banco,
 * vale OPENAI_API_KEY / ANTHROPIC_API_KEY como antes.
 */
export const PROVEDORES = ["openai", "anthropic"] as const;
export type Provedor = (typeof PROVEDORES)[number];
export const ehProvedor = (s: string): s is Provedor => (PROVEDORES as readonly string[]).includes(s);

const VARIAVEL: Record<Provedor, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

interface Guardada {
  cifrada: string;
  final: string;
  por: { nome: string; email: string };
  em: number;
}

/** GET /api/chaves. Nunca carrega a chave, só os 4 últimos caracteres. */
export type EstadoDaChave =
  | { provedor: Provedor; origem: "nenhuma" }
  | { provedor: Provedor; origem: "ambiente"; final: string }
  | { provedor: Provedor; origem: "equipe"; final: string; por: { nome: string; email: string }; em: number };

export type Recusa = { motivo: string };

const chaveDoBanco = (p: Provedor) => `chave_ia:${p}`;

function segredo(): Buffer {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET não definido.");
  return createHash("sha256").update(s).update("chaves-de-ia").digest();
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", segredo(), iv);
  const corpo = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), corpo]).toString("base64");
}

export function decifrar(cifrada: string): string {
  const b = Buffer.from(cifrada, "base64");
  const d = createDecipheriv("aes-256-gcm", segredo(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

/** As funções da Vercel não dividem memória: cada uma relê o banco a cada 30 s. */
const CACHE_MS = 30_000;
const cache = new Map<Provedor, { guardada: Guardada | null; lidaEm: number }>();

async function guardada(p: Provedor): Promise<Guardada | null> {
  const atual = cache.get(p);
  if (atual && Date.now() - atual.lidaEm < CACHE_MS) return atual.guardada;
  const linha = await primeira(q<{ valor: string }>`SELECT valor FROM configuracoes WHERE chave = ${chaveDoBanco(p)}`);
  const valor: Guardada | null = linha ? JSON.parse(linha.valor) : null;
  cache.set(p, { guardada: valor, lidaEm: Date.now() });
  return valor;
}

/** A chave que as chamadas de IA usam agora, ou undefined se não há nenhuma. */
export async function chaveDe(p: Provedor): Promise<string | undefined> {
  const g = await guardada(p);
  return g ? decifrar(g.cifrada) : process.env[VARIAVEL[p]] || undefined;
}

export async function estadoDaChave(p: Provedor): Promise<EstadoDaChave> {
  const g = await guardada(p);
  if (g) return { provedor: p, origem: "equipe", final: g.final, por: g.por, em: g.em };
  const doAmbiente = process.env[VARIAVEL[p]];
  return doAmbiente ? { provedor: p, origem: "ambiente", final: doAmbiente.slice(-4) } : { provedor: p, origem: "nenhuma" };
}

export const estadosDasChaves = () => Promise.all(PROVEDORES.map(estadoDaChave));

/** Pergunta ao provedor se a chave entra. Listar modelos não gasta crédito. */
async function testar(p: Provedor, chave: string): Promise<Recusa | null> {
  const res =
    p === "openai"
      ? await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(8000) })
      : await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": chave, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(8000),
        });
  if (res.ok) return null;
  if (res.status === 401) return { motivo: "O provedor recusou a chave. Confira se copiou ela inteira." };
  if (res.status === 403) return { motivo: "A chave existe, mas não tem permissão para usar os modelos." };
  if (res.status === 429) return { motivo: "A conta dessa chave está sem crédito ou no limite de uso." };
  return { motivo: `O provedor respondeu ${res.status}. Tente de novo em instantes.` };
}

const FORMATO: Record<Provedor, RegExp> = { openai: /^sk-[A-Za-z0-9_-]{20,}$/, anthropic: /^sk-ant-[A-Za-z0-9_-]{20,}$/ };

export async function conectarChave(p: Provedor, chave: string, por: { nome: string; email: string }): Promise<EstadoDaChave | Recusa> {
  const limpa = chave.trim();
  if (!FORMATO[p].test(limpa)) {
    return { motivo: p === "openai" ? "Uma chave da OpenAI começa com sk- e tem dezenas de caracteres." : "Uma chave da Anthropic começa com sk-ant-." };
  }
  const recusa = await testar(p, limpa).catch(() => ({ motivo: "Não deu para falar com o provedor agora. Tente de novo." }));
  if (recusa) return recusa;
  const g: Guardada = { cifrada: cifrar(limpa), final: limpa.slice(-4), por, em: Date.now() };
  await q`INSERT INTO configuracoes (chave, valor) VALUES (${chaveDoBanco(p)}, ${JSON.stringify(g)}) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`;
  cache.set(p, { guardada: g, lidaEm: Date.now() });
  return estadoDaChave(p);
}

export async function desconectarChave(p: Provedor): Promise<EstadoDaChave> {
  await q`DELETE FROM configuracoes WHERE chave = ${chaveDoBanco(p)}`;
  cache.set(p, { guardada: null, lidaEm: Date.now() });
  return estadoDaChave(p);
}
