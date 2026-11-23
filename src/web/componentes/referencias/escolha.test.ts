import { expect, test } from "bun:test";
import { dadosDa, esperaDe, reduzir, triar, type Colada, type Escolha } from "./escolha";

const arquivo = (nome: string, tipo = "image/png", bytes = 10) => new File([new Uint8Array(bytes)], nome, { type: tipo });
const colada = (id: number, extra: Partial<Colada> = {}) => ({ id, arquivo: arquivo(`${id}.png`), previa: `blob:${id}`, estado: "subindo", ...extra }) as Colada;
const referencia = (id: string) => ({ id, arquivo: `${id}.jpg`, leitura: id, leituraEditadaPor: null, pilares: [], criadaPor: "a@b.c", criadaEm: "", removidaEm: null });

test("a fila recusa tipo errado, mais de 10 MB e o que passa de 3, dizendo o motivo de cada uma", () => {
  const { aceitos, avisos } = triar([arquivo("a.png"), arquivo("planta.pdf", "application/pdf"), arquivo("b.jpg", "image/jpeg"), arquivo("grande.png", "image/png", 10 * 1024 * 1024 + 1), arquivo("c.webp", "image/webp")], 2);
  expect(aceitos.map((f) => f.name)).toEqual(["a.png", "b.jpg"]);
  expect(avisos).toEqual([
    "planta.pdf não entrou: a imagem precisa ser PNG, JPEG ou WebP.",
    "grande.png não entrou: passa de 10 MB.",
    "Só 3 imagens por pedido. A quarta não entrou; tire uma da fila para trocar.",
  ]);
});

test("a mensagem espera a imagem subir, e só leva a chave do que subiu, nunca a prévia local", () => {
  let e: Escolha = { marcadas: [], coladas: [] };
  e = reduzir(e, { tipo: "colar", coladas: [colada(1), colada(2)] });
  e = reduzir(e, { tipo: "alternar", referencia: referencia("r1") });
  expect(esperaDe(e)).toBe("subindo");
  e = reduzir(e, { tipo: "subiu", id: 1, chave: "k1.png" });
  e = reduzir(e, { tipo: "falhou", id: 2, erro: "Erro 500" });
  expect(esperaDe(e)).toBe("falhou");
  e = reduzir(e, { tipo: "tirar", id: 2 });
  expect(esperaDe(e)).toBeNull();
  expect(dadosDa(e)).toEqual({ marcadas: ["r1"], coladas: ["k1.png"] });
  expect(dadosDa(reduzir(e, { tipo: "limpar" }))).toBeNull();
});

test("a quarta referência marcada não entra; desmarcar abre a vaga", () => {
  let e: Escolha = { marcadas: [], coladas: [] };
  for (const id of ["r1", "r2", "r3", "r4"]) e = reduzir(e, { tipo: "alternar", referencia: referencia(id) });
  expect(e.marcadas.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  e = reduzir(e, { tipo: "alternar", referencia: referencia("r2") });
  e = reduzir(e, { tipo: "alternar", referencia: referencia("r4") });
  expect(e.marcadas.map((r) => r.id)).toEqual(["r1", "r3", "r4"]);
});
