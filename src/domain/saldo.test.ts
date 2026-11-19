import { expect, test } from "bun:test";
import { lerResposta } from "./saldo";

test("o saldo traz o disponível e os depósitos do mais novo para o mais velho, em ms", () => {
  const s = lerResposta(
    {
      total_granted: 15,
      total_used: 11.56,
      total_available: 3.44,
      grants: {
        data: [
          { grant_amount: 5, used_amount: 5, effective_at: 1_700_000_000, expires_at: null },
          { grant_amount: 10, used_amount: 6.56, effective_at: 1_760_000_000, expires_at: 1_790_000_000 },
        ],
      },
    },
    42,
  );
  expect(s).toEqual({
    estado: "ok",
    disponivel: 3.44,
    depositado: 15,
    usado: 11.56,
    lidoEm: 42,
    depositos: [
      { valor: 10, usado: 6.56, em: 1_760_000_000_000, expiraEm: 1_790_000_000_000 },
      { valor: 5, usado: 5, em: 1_700_000_000_000, expiraEm: null },
    ],
  });
});
