import { describe, expect, test } from "bun:test";
import { compararTexto } from "./conferencia";

describe("compararTexto", () => {
  test("maiúscula, espaço sobrando e pontuação não contam", () => {
    expect(compararTexto(["Vidro temperado: 8 mm.", "Peça o orçamento"], ["VIDRO   TEMPERADO 8 MM", "peça o orçamento!"])).toEqual([]);
  });

  test("a ordem dos blocos lidos não conta", () => {
    expect(compararTexto(["Título", "Apoio da arte"], ["Apoio da arte", "Título"])).toEqual([]);
  });

  test("letra trocada e acento errado viram palavra trocada", () => {
    expect(compararTexto(["Vidro temperado não estilhaça"], ["Vidor temperado nao estilhaça"])).toEqual([
      { tipo: "trocada", pedida: "Vidro", lida: "Vidor" },
      { tipo: "trocada", pedida: "não", lida: "nao" },
    ]);
  });

  test("palavra faltando e palavra sobrando", () => {
    expect(compararTexto(["O box certo para o banheiro"], ["O box para o banheiro novo"])).toEqual([
      { tipo: "faltando", pedida: "certo" },
      { tipo: "sobrando", lida: "novo" },
    ]);
  });

  test("palavra repetida conta cada vez que aparece", () => {
    expect(compararTexto(["vidro e vidro"], ["vidro e"])).toEqual([{ tipo: "faltando", pedida: "vidro" }]);
  });

  test("arte sem texto falta tudo", () => {
    expect(compararTexto(["Vidro"], [])).toEqual([{ tipo: "faltando", pedida: "Vidro" }]);
  });
});
