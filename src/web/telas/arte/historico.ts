import { useCallback, useRef, useState } from "react";
import type { Edicao } from "../../../v2/artes";

/**
 * O histórico de desfazer do editor: as edições de antes, a em vigor e as desfeitas que o refazer traz de volta.
 * `ultima` guarda o grupo e a hora da edição em vigor, para a próxima do mesmo grupo se juntar a ela.
 */
export interface Historico {
  passado: Edicao[];
  presente: Edicao;
  futuro: Edicao[];
  ultima: { grupo: string; quando: number } | null;
}

/**
 * `grupo` junta edições seguidas do mesmo campo. Com `gesto`, o grupo é um arraste só (do aperto ao soltar) e junta
 * mesmo com pausas no meio; sem ele, junta só dentro da janela.
 */
export type AcaoDoHistorico = { tipo: "editar"; edicao: Edicao; grupo?: string; gesto?: boolean; quando: number } | { tipo: "desfazer" } | { tipo: "refazer" };

export const LIMITE_DO_HISTORICO = 100;

/** Edições do mesmo grupo (uma digitação, um deslizante) com menos que isto entre elas viram um passo só. */
export const JANELA_DO_GRUPO = 500;

export const historicoDe = (presente: Edicao): Historico => ({ passado: [], presente, futuro: [], ultima: null });

export function reduzirHistorico(historico: Historico, acao: AcaoDoHistorico): Historico {
  switch (acao.tipo) {
    case "editar":
      return editar(historico, acao);
    case "desfazer": {
      const anterior = historico.passado.at(-1);
      if (!anterior) return historico;
      return { passado: historico.passado.slice(0, -1), presente: anterior, futuro: [historico.presente, ...historico.futuro], ultima: null };
    }
    case "refazer": {
      const [seguinte, ...resto] = historico.futuro;
      if (!seguinte) return historico;
      return { passado: [...historico.passado, historico.presente], presente: seguinte, futuro: resto, ultima: null };
    }
  }
}

function editar(historico: Historico, { edicao, grupo, gesto, quando }: Extract<AcaoDoHistorico, { tipo: "editar" }>): Historico {
  if (edicao === historico.presente) return historico;

  const ultima = grupo === undefined ? null : { grupo, quando };
  const dentroDaJanela = gesto || (historico.ultima !== null && quando - historico.ultima.quando < JANELA_DO_GRUPO);
  const mesmoGrupo = grupo !== undefined && historico.ultima?.grupo === grupo && dentroDaJanela;
  if (mesmoGrupo) return { ...historico, presente: edicao, futuro: [], ultima };

  return { passado: [...historico.passado, historico.presente].slice(-LIMITE_DO_HISTORICO), presente: edicao, futuro: [], ultima };
}

/**
 * O histórico como estado do editor. A edição lê o presente mais novo, não o da última renderização, para duas
 * edições seguidas no mesmo evento não se sobrescreverem. `aoMudar` recebe cada presente novo, para gravar.
 */
export function useHistorico(inicial: Edicao, aoMudar: (edicao: Edicao) => void) {
  const [historico, setHistorico] = useState(() => historicoDe(inicial));
  const atual = useRef(historico);
  const avisar = useRef(aoMudar);
  avisar.current = aoMudar;

  const despachar = useCallback((acao: AcaoDoHistorico) => {
    const proximo = reduzirHistorico(atual.current, acao);
    if (proximo === atual.current) return;

    const mudou = proximo.presente !== atual.current.presente;
    atual.current = proximo;
    setHistorico(proximo);
    if (mudou) avisar.current(proximo.presente);
  }, []);

  const editar = useCallback(
    (mudanca: (presente: Edicao) => Edicao, grupo?: string, gesto?: boolean) =>
      despachar({ tipo: "editar", edicao: mudanca(atual.current.presente), grupo, gesto, quando: performance.now() }),
    [despachar],
  );
  const desfazer = useCallback(() => despachar({ tipo: "desfazer" }), [despachar]);
  const refazer = useCallback(() => despachar({ tipo: "refazer" }), [despachar]);

  return { historico, editar, desfazer, refazer };
}
