import { expect, test } from "bun:test";
import { custoDe } from "./precos";

test("o custo separa cache, token de imagem e saída, e o modelo fora da tabela fica sem preço", () => {
  // 200 mil de entrada no Luna, 50 mil dela lida do cache, e 100 mil de saída.
  expect(custoDe({ modelo: "gpt-6-luna", entrada: 200_000, saida: 100_000, cacheLido: 50_000 })).toBeCloseTo((150_000 * 0.1 + 50_000 * 0.01 + 100_000 * 0.5) / 1e6, 10);
  // Arte com uma referência: 1.000 tokens de imagem a US$ 8 e 200 de texto a US$ 5 na entrada, 1.500 de saída a US$ 30.
  expect(custoDe({ modelo: "gpt-image-2.6-sunburst", entrada: 1_200, entradaImagem: 1_000, saida: 1_500 })).toBeCloseTo((200 * 5 + 1_000 * 8 + 1_500 * 30) / 1e6, 10);
  expect(custoDe({ modelo: "mock-model-id", entrada: 10, saida: 10 })).toBeNull();
});

test("o prompt longo paga a outra tarifa na chamada inteira", () => {
  const curta = custoDe({ modelo: "gpt-6-luna", entrada: 272_000, saida: 1_000 })!;
  const longa = custoDe({ modelo: "gpt-6-luna", entrada: 272_001, saida: 1_000 })!;
  expect(curta).toBeCloseTo((272_000 * 0.1 + 1_000 * 0.5) / 1e6, 10);
  expect(longa).toBeCloseTo((272_001 * 0.2 + 1_000 * 0.75) / 1e6, 10);
});
