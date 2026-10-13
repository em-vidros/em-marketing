import { describe, expect, test } from "bun:test";
import { diaDe, diaPorExtenso, encaixarNoDia, epochDe, gradeDoMes, inicioDaSemana, minutosDe, somarMeses } from "./datas";

describe("dia de São Paulo", () => {
  test("23:59 em São Paulo ainda é o mesmo dia, mesmo já sendo o dia seguinte em UTC", () => {
    const quaseMeiaNoite = Date.parse("2026-10-14T02:59:00Z");
    const meiaNoite = Date.parse("2026-10-14T03:00:00Z");
    expect([diaDe(quaseMeiaNoite), minutosDe(quaseMeiaNoite)]).toEqual(["2026-10-13", 23 * 60 + 59]);
    expect([diaDe(meiaNoite), minutosDe(meiaNoite)]).toEqual(["2026-10-14", 0]);
    expect(epochDe("2026-10-16", 18 * 60)).toBe(Date.parse("2026-10-16T18:00:00-03:00"));
  });

  test("o texto do dia leva o ano só fora do ano de hoje", () => {
    const agora = Date.parse("2026-10-13T12:00:00-03:00");
    expect(diaPorExtenso("2026-10-16", agora)).toBe("sexta, 16 de outubro");
    expect(diaPorExtenso("2027-01-04", agora)).toBe("segunda, 4 de janeiro de 2027");
  });
});

describe("semana e mês", () => {
  test("a semana começa no domingo, inclusive quando o dia já é domingo", () => {
    expect(inicioDaSemana("2026-10-13")).toBe("2026-10-11");
    expect(inicioDaSemana("2026-10-11")).toBe("2026-10-11");
    expect(inicioDaSemana("2026-10-17")).toBe("2026-10-11");
  });

  test("o mês tem sempre 6 linhas, completando com o mês anterior e o seguinte", () => {
    const outubro = gradeDoMes("2026-10-13");
    const fevereiro = gradeDoMes("2026-02-20");
    expect([outubro.length, outubro[0], outubro.at(-1)]).toEqual([42, "2026-09-27", "2026-11-07"]);
    // Fevereiro de 2026 começa num domingo: a primeira linha já é do mês.
    expect([fevereiro[0], fevereiro.at(-1)]).toEqual(["2026-02-01", "2026-03-14"]);
    expect(new Set(outubro).size).toBe(42);
  });

  test("somar meses parte do dia 1, sem pular fevereiro a partir de um dia 31", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-01");
    expect(somarMeses("2026-12-15", 1)).toBe("2027-01-01");
    expect(somarMeses("2026-01-10", -1)).toBe("2025-12-01");
  });
});

describe("encaixe de 15 minutos", () => {
  test("arredonda para o quarto de hora mais perto e não sai do dia", () => {
    const casos: [number, number][] = [
      [7, 0],
      [8, 15],
      [52, 45],
      [53, 60],
      [-20, 0],
      [1439, 1425],
    ];
    expect(casos.map(([m]) => encaixarNoDia(m))).toEqual(casos.map(([, e]) => e));
  });
});
