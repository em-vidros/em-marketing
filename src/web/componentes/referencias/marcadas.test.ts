import { expect, test } from "bun:test";
import type { ReferenciaDaApi } from "../../api";
import { alternada } from "./marcadas";

const ref = (id: string) => ({ id }) as ReferenciaDaApi;

test("marcar uma referência de uma conversa vale para o próximo pedido, até 3", () => {
  let lista: readonly ReferenciaDaApi[] = [];
  for (const id of ["r1", "r2", "r3", "r4"]) lista = alternada(lista, ref(id));
  expect(lista.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  expect(alternada(lista, ref("r4"))).toBe(lista);
  expect(alternada(lista, ref("r2")).map((r) => r.id)).toEqual(["r1", "r3"]);
});
