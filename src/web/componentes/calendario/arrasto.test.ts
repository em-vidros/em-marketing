import { describe, expect, test } from "bun:test";
import type { ItemAgendado, ItemPauta } from "../../../agent/calendario";
import type { PostPronto } from "../../../agent/fila";
import { PARADO, PASSADO, reduzir, type Arrasto, type Evento, type Fonte } from "./arrasto";
import { epochDe } from "./datas";
import { faixas } from "./itens";

const AGORA = epochDe("2026-10-13", 13 * 60);
const pauta: ItemPauta = { tipo: "pauta", id: 1, dia: "2026-10-14", hora: "10:00", titulo: "Box no Calhau", pilar: "PROVA", nota: "", conversaId: null };
const agendado = { tipo: "agendado", filaId: 7, postId: 3, publicaEm: epochDe("2026-10-15", 18 * 60), midia: "IMAGE", headline: "Box", pilar: "PROVA", capa: null, status: "pending", erro: null } satisfies ItemAgendado;
const pronto: PostPronto = { postId: 9, headline: "Espelho", pilar: "MARCA", capa: "/a.jpg", midias: ["IMAGE"] };

const caixa = { x: 100, y: 200, largura: 120, altura: 30 };
const rodar = (fonte: Fonte, ...eventos: Evento[]) =>
  [{ tipo: "descer", fonte, ponto: { x: 110, y: 210, t: 0 }, pegada: { x: 10, y: 10 }, caixa } satisfies Evento, ...eventos].reduce<Arrasto>(reduzir, PARADO);

describe("arrasto", () => {
  test("mexer menos que o limiar e soltar é um clique: nada levanta, nada muda", () => {
    const fim = rodar({ tipo: "item", item: pauta }, { tipo: "mover", ponto: { x: 112, y: 212, t: 20 }, alvo: { dia: "2026-10-20", minutos: 600 } }, { tipo: "soltar", ponto: { x: 112, y: 212, t: 40 }, agora: AGORA });
    expect(fim).toEqual(PARADO);
  });

  test("a pauta solta num horário futuro muda sem confirmação e herda a velocidade dos últimos quadros", () => {
    const fim = rodar(
      { tipo: "item", item: pauta },
      { tipo: "mover", ponto: { x: 110, y: 260, t: 100 }, alvo: { dia: "2026-10-14", minutos: 660 } },
      { tipo: "mover", ponto: { x: 110, y: 300, t: 300 }, alvo: { dia: "2026-10-14", minutos: 690 } },
      { tipo: "mover", ponto: { x: 110, y: 340, t: 340 }, alvo: { dia: "2026-10-14", minutos: 735 } },
      { tipo: "soltar", ponto: { x: 110, y: 360, t: 360 }, agora: AGORA },
    );
    expect(fim).toMatchObject({ fase: "soltando", soltura: { tipo: "mover", lugar: { dia: "2026-10-14", minutos: 735 } } });
    // Só os quadros de 300 a 360 ms entram: 60 px em 60 ms.
    expect(fim.fase === "soltando" && fim.velocidade).toEqual({ x: 0, y: 1000 });
  });

  test("soltar num horário que já passou volta ao lugar e diz por quê", () => {
    const fim = rodar({ tipo: "item", item: pauta }, { tipo: "mover", ponto: { x: 40, y: 210, t: 50 }, alvo: { dia: "2026-10-13", minutos: 12 * 60 } }, { tipo: "soltar", ponto: { x: 40, y: 210, t: 60 }, agora: AGORA });
    expect(fim).toMatchObject({ fase: "soltando", soltura: { tipo: "voltar", motivo: PASSADO } });
  });

  test("agendado e post pronto pedem confirmação; soltar no mesmo lugar só volta", () => {
    const mover = (alvo: { dia: "2026-10-16"; minutos: number }) => ({ tipo: "mover", ponto: { x: 300, y: 210, t: 50 }, alvo }) as const;
    const soltar = { tipo: "soltar", ponto: { x: 300, y: 210, t: 60 }, agora: AGORA } as const;
    expect(rodar({ tipo: "item", item: agendado }, mover({ dia: "2026-10-16", minutos: 1080 }), soltar)).toMatchObject({ soltura: { tipo: "confirmar" } });
    expect(rodar({ tipo: "pronto", post: pronto }, mover({ dia: "2026-10-16", minutos: 1080 }), soltar)).toMatchObject({ soltura: { tipo: "confirmar" } });
    expect(
      rodar({ tipo: "item", item: agendado }, { tipo: "mover", ponto: { x: 300, y: 210, t: 50 }, alvo: { dia: "2026-10-15", minutos: 1080 } }, soltar),
    ).toMatchObject({ soltura: { tipo: "voltar", motivo: null } });
  });
});

describe("faixas da grade de horas", () => {
  test("itens que se cruzam ficam lado a lado; o próximo sem cruzar volta à largura toda", () => {
    const f = faixas([
      { chave: "a", minutos: 600 },
      { chave: "b", minutos: 615 },
      { chave: "c", minutos: 630 },
      { chave: "d", minutos: 700 },
    ]);
    expect(Object.fromEntries(f)).toEqual({
      a: { faixa: 0, faixas: 2 },
      b: { faixa: 1, faixas: 2 },
      c: { faixa: 0, faixas: 2 },
      d: { faixa: 0, faixas: 1 },
    });
  });
});
