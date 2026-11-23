import { expect, test } from "bun:test";
import { q } from "../v2/banco";
import { registrarUso } from "./uso";
import { informar, lerDaOpenAI, removerMovimento, saldo } from "./saldo";

// O relógio conta em ms: a espera tira o empate entre o movimento e a chamada.
const gastar = async (saidaNoLuna: number) => {
  await Bun.sleep(2);
  await registrarUso({ origem: "teste do saldo", modelo: "gpt-6-luna", entrada: 0, saida: saidaNoLuna, imagens: 0 });
  await Bun.sleep(2);
};

// 2 milhões de tokens de saída no Luna custam US$ 1.
test("o saldo é o último informado, mais os depósitos depois dele, menos o custo medido desde então", async () => {
  await gastar(2_000_000);
  const base = await informar({ tipo: "saldo", valor: 10 }, "ana@emvidros.com.br");
  await gastar(2_000_000);
  await informar({ tipo: "deposito", valor: 5 }, "ana@emvidros.com.br");
  await Bun.sleep(2);

  expect(await saldo()).toMatchObject({ estado: "ok", disponivel: 14, total: 15, gasto: 1, desde: base.em });

  // Corrigir o saldo zera a conta a partir dali.
  const correcao = await informar({ tipo: "saldo", valor: 12.5 }, "ana@emvidros.com.br");
  expect(await saldo()).toMatchObject({ disponivel: 12.5, gasto: 0, desde: correcao.em });

  // Remover a correção volta para a conta de antes, e restaurar traz a correção de novo.
  expect(await removerMovimento(correcao.id, true)).toBe(true);
  expect(await saldo()).toMatchObject({ disponivel: 14, desde: base.em });
  expect(await removerMovimento(correcao.id, false)).toBe(true);
  expect(await saldo()).toMatchObject({ disponivel: 12.5 });

  expect(await removerMovimento(crypto.randomUUID(), true)).toBe(false);
  expect(await removerMovimento("nao-e-uuid", true)).toBe(false);
  await q`DELETE FROM movimentos_do_saldo`;
  expect(await saldo()).toMatchObject({ estado: "sem-saldo", movimentos: [] });
});

test("lido da OpenAI: o disponível e o usado vêm do painel, e o desde é o depósito mais antigo", () => {
  const s = lerDaOpenAI({ total_available: 8.4, total_granted: 10, total_used: 1.6, grants: { data: [{ effective_at: 1_800_000_000 }, { effective_at: 1_700_000_000 }] } });
  expect(s).toMatchObject({ estado: "ok", origem: "openai", disponivel: 8.4, total: 10, gasto: 1.6, desde: 1_700_000_000_000, movimentos: [] });
});
