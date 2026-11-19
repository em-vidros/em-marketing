import { describe, expect, test } from "bun:test";
import type { Edicao } from "../../../v2/artes";
import { AJUSTES_NEUTROS } from "../../../v2/camadas";
import { historicoDe, JANELA_DO_GRUPO, LIMITE_DO_HISTORICO, reduzirHistorico, type AcaoDoHistorico, type Historico } from "./historico";

const comBrilho = (brilho: number): Edicao => ({ camadas: [], ajustes: { ...AJUSTES_NEUTROS, brilho } });
const editar = (brilho: number, quando: number, grupo?: string): AcaoDoHistorico => ({ tipo: "editar", edicao: comBrilho(brilho), grupo, quando });
const aplicar = (inicio: Historico, acoes: AcaoDoHistorico[]) => acoes.reduce(reduzirHistorico, inicio);
const brilhos = (h: Historico) => ({ passado: h.passado.map((e) => e.ajustes.brilho), presente: h.presente.ajustes.brilho, futuro: h.futuro.map((e) => e.ajustes.brilho) });

describe("histórico do editor", () => {
  test("edições do mesmo grupo dentro da janela viram um passo, e um desfazer volta ao começo delas", () => {
    const h = aplicar(historicoDe(comBrilho(1)), [editar(1.1, 0, "brilho"), editar(1.2, 100, "brilho"), editar(1.3, 200, "brilho")]);
    expect(brilhos(h)).toEqual({ passado: [1], presente: 1.3, futuro: [] });
    expect(brilhos(reduzirHistorico(h, { tipo: "desfazer" }))).toEqual({ passado: [], presente: 1, futuro: [1.3] });
  });

  test("uma pausa maior que a janela, outro grupo ou um desfazer no meio abrem um passo novo", () => {
    const h = aplicar(historicoDe(comBrilho(1)), [
      editar(1.1, 0, "brilho"),
      editar(1.2, JANELA_DO_GRUPO + 1, "brilho"),
      editar(1.3, JANELA_DO_GRUPO + 2, "texto"),
      editar(1.4, JANELA_DO_GRUPO + 3),
      editar(1.5, JANELA_DO_GRUPO + 4),
    ]);
    expect(brilhos(h).passado).toEqual([1, 1.1, 1.2, 1.3, 1.4]);

    const depoisDoDesfazer = aplicar(h, [{ tipo: "desfazer" }, editar(1.6, JANELA_DO_GRUPO + 5)]);
    expect(brilhos(depoisDoDesfazer)).toEqual({ passado: [1, 1.1, 1.2, 1.3, 1.4], presente: 1.6, futuro: [] });
  });

  test("um arraste de deslizante vira um passo mesmo com pausa no meio, e o arraste seguinte abre outro", () => {
    const gesto = (brilho: number, quando: number, id: string): AcaoDoHistorico => ({ tipo: "editar", edicao: comBrilho(brilho), grupo: `brilho:${id}`, gesto: true, quando });
    const h = aplicar(historicoDe(comBrilho(1)), [gesto(1.1, 0, "a"), gesto(1.2, JANELA_DO_GRUPO * 3, "a"), gesto(1.3, JANELA_DO_GRUPO * 3 + 10, "b")]);
    expect(brilhos(h)).toEqual({ passado: [1, 1.2], presente: 1.3, futuro: [] });
  });

  test("uma edição nova depois de desfazer apaga o que o refazer traria", () => {
    const h = aplicar(historicoDe(comBrilho(1)), [editar(1.1, 0), editar(1.2, 1), { tipo: "desfazer" }, { tipo: "desfazer" }]);
    expect(brilhos(h)).toEqual({ passado: [], presente: 1, futuro: [1.1, 1.2] });
    expect(brilhos(reduzirHistorico(h, { tipo: "refazer" }))).toEqual({ passado: [1], presente: 1.1, futuro: [1.2] });
    expect(brilhos(reduzirHistorico(h, editar(0.9, 2)))).toEqual({ passado: [1], presente: 0.9, futuro: [] });
  });

  test("guarda só os últimos passos, e desfazer ou refazer sem nada para mexer não muda o histórico", () => {
    const acoes = Array.from({ length: LIMITE_DO_HISTORICO + 20 }, (_, i) => editar(1 + (i + 1) / 1000, i));
    const h = aplicar(historicoDe(comBrilho(1)), acoes);
    expect(h.passado).toHaveLength(LIMITE_DO_HISTORICO);
    expect(reduzirHistorico(h, { tipo: "refazer" })).toBe(h);

    const vazio = historicoDe(comBrilho(1));
    expect(reduzirHistorico(vazio, { tipo: "desfazer" })).toBe(vazio);
  });
});
