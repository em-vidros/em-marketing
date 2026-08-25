/**
 * Escolha dos adaptadores. Chave nova entra num arquivo deste diretório e nada
 * mais na árvore muda, que é a propriedade que `scripts/verificar/fronteira.ts`
 * mantém honesta.
 */

import type { Adaptadores } from "./tipos";
import {
  FakeDesigner,
  FakeDiretorCriativo,
  FakeDiretorDeArte,
  FakePortaLinear,
  FakePortaTelegram,
  FakeRedator,
} from "./fake";

const CHAVES_REAIS = ["DEEPSEEK_API_KEY", "GEMINI_API_KEY"] as const;

export function carregarAdaptadores(): Adaptadores {
  const escolha = process.env.ADAPTADORES ?? "fake";

  if (escolha === "fake")
    return {
      criativo: new FakeDiretorCriativo(),
      redator: new FakeRedator(),
      designer: new FakeDesigner(),
      arte: new FakeDiretorDeArte(),
      telegram: new FakePortaTelegram(),
      linear: new FakePortaLinear(),
    };

  if (escolha === "real") {
    const faltando = CHAVES_REAIS.filter((chave) => !process.env[chave]);
    if (faltando.length)
      throw new Error(
        `ADAPTADORES=real exige ${faltando.join(" e ")} no ambiente. ` +
          "Sem chave, deixe ADAPTADORES vazio ou fake: o caminho inteiro roda offline.",
      );
    throw new Error("ADAPTADORES=real chega na Fase 2. Na Fase 1 só existe fake.");
  }

  throw new Error(`ADAPTADORES=${escolha} não existe. Use fake ou real.`);
}
