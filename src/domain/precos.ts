/**
 * Preço em US$ por milhão de tokens, na tarifa padrão. Conferidos em 23/11/2026 em
 * developers.openai.com/api/docs/pricing e platform.claude.com/docs/en/about-claude/pricing.
 * Quando um preço mudar, só as chamadas novas pagam o novo: o custo de cada chamada fica gravado.
 */
interface Tarifa {
  entrada: number;
  cacheLido: number;
  cacheEscrito: number;
  saida: number;
  /** Só nos modelos de imagem: o token de imagem na entrada custa diferente do de texto. */
  entradaImagem?: number;
}

/** Acima do limite de entrada, a chamada inteira paga a outra tarifa. */
interface Preco {
  tarifa: Tarifa;
  longa?: { acimaDe: number; tarifa: Tarifa };
}

const PRECOS: Record<string, Preco> = {
  "gpt-6-luna": {
    tarifa: { entrada: 0.1, cacheLido: 0.01, cacheEscrito: 0.125, saida: 0.5 },
    longa: { acimaDe: 272_000, tarifa: { entrada: 0.2, cacheLido: 0.02, cacheEscrito: 0.25, saida: 0.75 } },
  },
  "gpt-image-2.6-sunburst": { tarifa: { entrada: 5, cacheLido: 1.25, cacheEscrito: 5, saida: 30, entradaImagem: 8 } },
  "claude-opus-5-5": { tarifa: { entrada: 4, cacheLido: 0.2, cacheEscrito: 5, saida: 20 } },
  "claude-sonnet-5-5": { tarifa: { entrada: 2, cacheLido: 0.1, cacheEscrito: 2.5, saida: 10 } },
  "claude-haiku-5-5": {
    tarifa: { entrada: 0.1, cacheLido: 0.01, cacheEscrito: 0.125, saida: 0.5 },
    longa: { acimaDe: 100_000, tarifa: { entrada: 0.5, cacheLido: 0.05, cacheEscrito: 0.625, saida: 2.5 } },
  },
};

/** O que uma chamada consumiu. `entrada` é o total, e já inclui o cache e os tokens de imagem. */
export interface Consumo {
  modelo: string;
  entrada: number;
  saida: number;
  cacheLido?: number;
  cacheEscrito?: number;
  entradaImagem?: number;
}

/** US$ de uma chamada, ou null quando o modelo não está na tabela. */
export function custoDe(c: Consumo): number | null {
  const preco = PRECOS[c.modelo];
  if (!preco) return null;
  const t = preco.longa && c.entrada > preco.longa.acimaDe ? preco.longa.tarifa : preco.tarifa;
  const cacheLido = c.cacheLido ?? 0;
  const cacheEscrito = c.cacheEscrito ?? 0;
  const imagem = t.entradaImagem === undefined ? 0 : (c.entradaImagem ?? 0);
  const texto = Math.max(0, c.entrada - cacheLido - cacheEscrito - imagem);
  const tokens = texto * t.entrada + cacheLido * t.cacheLido + cacheEscrito * t.cacheEscrito + imagem * (t.entradaImagem ?? 0) + c.saida * t.saida;
  return tokens / 1_000_000;
}
