import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { epochDe } from "./datas";
import { ehIdeia, eventoDe, mudancaDe, paraParede, rascunhoEm, remocaoDe, type EventoDoCalendario } from "./eventos";
import type { ItemAgendado, ItemCalendario, ItemPauta } from "./itens";

// Um fuso longe de São Paulo: a grade tem que mostrar a hora de São Paulo mesmo assim.
const fusoDoProcesso = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Asia/Tokyo";
});
afterAll(() => {
  if (fusoDoProcesso === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDoProcesso;
});

const AGORA = epochDe("2026-11-17", 12 * 60);

const pauta: ItemPauta = { tipo: "pauta", id: 1, dia: "2026-11-19", hora: "14:00", titulo: "Depoimento", pilar: "PROVA", nota: "", conversaId: null };

const agendado = (status: ItemAgendado["status"]): ItemAgendado => ({
  tipo: "agendado",
  filaId: 2,
  fonte: { tipo: "post", postId: 5 },
  publicaEm: epochDe("2026-11-26", 10 * 60),
  midia: "IMAGE",
  titulo: "Box no Calhau",
  pilar: "GENTE",
  capa: null,
  status,
  erro: status === "failed" ? "(#190) token" : null,
});

const publicado: ItemCalendario = { tipo: "publicado", publicacaoId: 3, fonte: { tipo: "post", postId: 3 }, publicadoEm: epochDe("2026-11-16", 10 * 60), midia: "IMAGE", titulo: "Feito", pilar: "MARCA", capa: null, link: "https://www.instagram.com/p/x/" };
const data: ItemCalendario = { tipo: "data", dia: "2026-11-20", id: null, mmdd: "11-20", ano: null, nome: "Consciência Negra", teste: "regiao", porque: "" };

/** O evento como o CalendarCN devolve depois de um arrasto: o item antigo com o início novo. */
const arrastado = (item: ItemCalendario, inicio: Date, isAllDay = false): EventoDoCalendario => ({ ...eventoDe(item), start: inicio, isAllDay });

describe("regras por tipo", () => {
  test("o que arrasta, o que sai do calendário, a cor e o que é só ideia em cada item", () => {
    const casos: [string, ItemCalendario, boolean, string | null, string, boolean][] = [
      ["pauta", pauta, true, "apagar-pauta", "green", true],
      ["agendado pendente", agendado("pending"), true, "cancelar", "blue", false],
      ["agendado publicando", agendado("publishing"), false, null, "blue", false],
      ["agendado que falhou", agendado("failed"), false, "dispensar", "red", false],
      ["publicado", publicado, false, null, "orange", false],
      ["data editorial fixa", data, false, null, "yellow", false],
      ["data da equipe", { ...data, id: 7 }, false, "apagar-data", "yellow", false],
    ];
    const visto = casos.map(([nome, item]) => {
      const e = eventoDe(item);
      return [nome, item, e.draggable, remocaoDe(item)?.acao ?? null, e.color, ehIdeia(item)];
    });
    expect(visto).toEqual(casos);
  });

  test("nenhum item muda de tamanho: post e pauta têm hora, não duração", () => {
    expect([pauta, agendado("pending"), publicado, data].every((i) => eventoDe(i).resizable === false)).toBe(true);
  });
});

describe("hora de parede", () => {
  test("o agendado das 10:00 de São Paulo aparece às 10:00, num bloco de meia hora", () => {
    const e = eventoDe(agendado("pending"));
    expect([e.start.getDate(), e.start.getHours(), e.start.getMinutes()]).toEqual([26, 10, 0]);
    expect(e.end.getTime() - e.start.getTime()).toBe(30 * 60_000);
  });

  test("às 23:45 o bloco termina na meia-noite e o item fica no mesmo dia", () => {
    const e = eventoDe({ ...pauta, hora: "23:45" });
    expect([e.end.getDate(), e.end.getHours(), e.end.getMinutes()]).toEqual([20, 0, 0]);
    expect(e.isAllDay).toBeUndefined();
  });

  test("a data editorial ocupa o dia inteiro, de 00:00 a 23:59 do mesmo dia", () => {
    const e = eventoDe(data);
    expect([e.isAllDay, e.start.getDate(), e.end.getDate(), e.end.getHours(), e.end.getMinutes()]).toEqual([true, 20, 20, 23, 59]);
  });
});

describe("arrastar vira mudança na agenda", () => {
  test("agendado pendente arrastado para o futuro vira mover, com o lugar em São Paulo", () => {
    expect(mudancaDe(arrastado(agendado("pending"), paraParede("2026-11-27", 15 * 60 + 30)), AGORA)).toMatchObject({
      tipo: "mover",
      lugar: { dia: "2026-11-27", minutos: 15 * 60 + 30 },
    });
  });

  test("pauta de dia inteiro arrastada no mês continua de dia inteiro", () => {
    const semHora: ItemPauta = { ...pauta, hora: null };
    expect(mudancaDe(arrastado(semHora, paraParede("2026-11-21", 0), true), AGORA)).toMatchObject({ tipo: "mover", lugar: { dia: "2026-11-21", minutos: null } });
  });

  test("arrastar para o passado é recusado com o motivo", () => {
    const m = mudancaDe(arrastado(pauta, paraParede("2026-11-17", 9 * 60)), AGORA);
    expect(m).toEqual({ tipo: "recusar", motivo: "Esse horário já passou. Escolha um horário no futuro." });
  });

  test("soltar no mesmo lugar, ou mexer no que não arrasta, não muda nada", () => {
    expect(mudancaDe(arrastado(pauta, paraParede("2026-11-19", 14 * 60)), AGORA)).toEqual({ tipo: "nada" });
    expect(mudancaDe(arrastado(agendado("publishing"), paraParede("2026-11-27", 10 * 60)), AGORA)).toEqual({ tipo: "nada" });
  });
});

test("clicar num horário vazio no passado recusa o rascunho", () => {
  expect(rascunhoEm({ dia: "2026-11-17", minutos: 11 * 60 }, AGORA)).toEqual({ recusa: "Esse horário já passou. Escolha um horário no futuro." });
  expect(rascunhoEm({ dia: "2026-11-17", minutos: 13 * 60 }, AGORA)).toEqual({ tipo: "rascunho", lugar: { dia: "2026-11-17", minutos: 13 * 60 }, abreEm: "escolha" });
});
