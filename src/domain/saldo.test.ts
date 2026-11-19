import { expect, test } from "bun:test";
import { contaDe, type Lancamento } from "./saldo";

const l = (tipo: Lancamento["tipo"], valor: number, em: number): Lancamento => ({ tipo, valor, em, por: "bi@emvidros.com.br" });

test.each([
  { caso: "só depósitos: soma todos e conta do primeiro", lista: [l("deposito", 20, 300), l("deposito", 50, 100)], creditado: 70, desde: 100 },
  { caso: "saldo e depois depósito: parte do saldo e soma o depósito", lista: [l("deposito", 25, 300), l("saldo", 10, 200)], creditado: 35, desde: 200 },
  { caso: "depósito antes do último saldo já está dentro dele", lista: [l("saldo", 40, 200), l("deposito", 50, 100)], creditado: 40, desde: 200 },
])("$caso", ({ lista, creditado, desde }) => {
  const conta = contaDe(lista)!;
  expect({ creditado: conta.creditado, desde: conta.desde, ultimo: conta.ultimoDeposito?.valor }).toEqual({
    creditado,
    desde,
    ultimo: lista.find((x) => x.tipo === "deposito")?.valor,
  });
});
