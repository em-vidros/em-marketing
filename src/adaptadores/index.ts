/**
 * Escolha dos adaptadores. Chave nova entra num arquivo deste diretório e nada mais
 * na árvore muda, que é a propriedade que `scripts/verificar/fronteira.ts` mantém
 * honesta.
 *
 * Os três perfis existem porque as chaves não chegam todas no mesmo dia. `ensaio`
 * é o que vai para produção enquanto falta DeepSeek e billing do Gemini: o Ricardo
 * roda o loop inteiro no celular com arte falsa, e só a arte é falsa.
 */

import { DeepSeekDiretorCriativo, DeepSeekRedator } from "./deepseek";
import {
  FakeDesigner,
  FakeDiretorCriativo,
  FakeDiretorDeArte,
  FakePortaLinear,
  FakePortaTelegram,
  FakeRedator,
} from "./fake";
import { GeminiDesigner, GeminiDiretorDeArte } from "./gemini";
import { LinearReal, TIME_EM_VIDROS } from "./linear";
import { TelegramReal } from "./telegram";
import type { Adaptadores } from "./tipos";

export const PERFIS = ["fake", "ensaio", "real"] as const;
export type Perfil = (typeof PERFIS)[number];

interface Peca {
  readonly nome: string;
  readonly variaveis: readonly string[];
}

const EXIGENCIAS: Record<Perfil, readonly Peca[]> = {
  fake: [],
  ensaio: [{ nome: "telegram", variaveis: ["TELEGRAM_BOT_TOKEN"] }],
  real: [
    { nome: "diretor criativo e redator (DeepSeek)", variaveis: ["DEEPSEEK_API_KEY"] },
    { nome: "designer e diretor de arte (Gemini)", variaveis: ["GEMINI_API_KEY"] },
    { nome: "telegram", variaveis: ["TELEGRAM_BOT_TOKEN"] },
    { nome: "linear", variaveis: ["LINEAR_API_KEY", "LINEAR_LABEL_ID"] },
  ],
};

/** Qual perfil este processo subiu. O servidor loga isto no boot. */
export function perfilAtual(): Perfil {
  const escolha = process.env.ADAPTADORES?.trim() || "fake";
  const perfil = PERFIS.find((p) => p === escolha);
  if (!perfil) throw new Error(`ADAPTADORES=${escolha} não existe. Use ${PERFIS.join(", ")}.`);
  return perfil;
}

/** Todas as variáveis que faltam de uma vez: descobrir uma por reinício é caro. */
function exigirAmbiente(perfil: Perfil): void {
  const faltando = EXIGENCIAS[perfil]
    .flatMap((peca) => peca.variaveis.map((variavel) => ({ peca: peca.nome, variavel })))
    .filter(({ variavel }) => !process.env[variavel]?.trim());
  if (faltando.length === 0) return;

  const lista = faltando.map(({ peca, variavel }) => `  ${variavel}  (${peca})`).join("\n");
  throw new Error(
    `ADAPTADORES=${perfil} exige ${faltando.length} variável(is) que não estão no ambiente:\n${lista}\n` +
      "Use ADAPTADORES=ensaio para rodar o loop com arte falsa e Telegram real, ou fake para rodar tudo offline.",
  );
}

function variavel(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) throw new Error(`${nome} não está no ambiente.`);
  return valor;
}

export function carregarAdaptadores(): Adaptadores {
  const perfil = perfilAtual();
  exigirAmbiente(perfil);

  if (perfil === "fake")
    return {
      criativo: new FakeDiretorCriativo(),
      redator: new FakeRedator(),
      designer: new FakeDesigner(),
      arte: new FakeDiretorDeArte(),
      telegram: new FakePortaTelegram(),
      linear: new FakePortaLinear(),
    };

  if (perfil === "ensaio")
    return {
      criativo: new FakeDiretorCriativo(),
      redator: new FakeRedator(),
      designer: new FakeDesigner(),
      arte: new FakeDiretorDeArte(),
      telegram: new TelegramReal(variavel("TELEGRAM_BOT_TOKEN")),
      linear: new FakePortaLinear(),
    };

  const deepseek = variavel("DEEPSEEK_API_KEY");
  const gemini = variavel("GEMINI_API_KEY");
  return {
    criativo: new DeepSeekDiretorCriativo(deepseek),
    redator: new DeepSeekRedator(deepseek),
    designer: new GeminiDesigner(gemini),
    arte: new GeminiDiretorDeArte(gemini),
    telegram: new TelegramReal(variavel("TELEGRAM_BOT_TOKEN")),
    linear: new LinearReal({
      chave: variavel("LINEAR_API_KEY"),
      teamId: process.env.LINEAR_TEAM_ID?.trim() || TIME_EM_VIDROS,
      labelId: variavel("LINEAR_LABEL_ID"),
    }),
  };
}
