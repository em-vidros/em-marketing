import { describe, expect, test } from "bun:test";
import { diaDe, diaPorExtenso, epochDe, minutosDe } from "./datas";

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
