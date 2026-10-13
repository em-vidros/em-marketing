import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { diaPorExtenso, ehFimDeSemana, encaixarNoDia, hoje, minutosDe, numeroDoDia, semanaCurta, textoDaHora, type Dia } from "./datas";
import { useCalendario } from "./contexto";
import { BlocoProvisorio, Item } from "./Item";
import { chaveDe, DURACAO, faixas, lugarDe, MAX_FAIXAS, type ItemCalendario } from "./itens";
import { LIMIAR } from "./arrasto";
import { rotuloDoDia } from "./rotulos";

/** 1px por minuto: 60px por hora, e o encaixe de 15 minutos anda 15px. */
const HORA = 60;
/** Abre rolado até as 8:00, com um respiro em cima. */
const ABRE_EM = 8 * HORA - 8;
/** A largura mínima de uma faixa lado a lado para o título ainda caber. */
const LARGURA_DA_FAIXA = 60;
/** Na faixa de dia inteiro cabem 3 linhas; o resto vira "+N". */
const MAX_DIA_INTEIRO = 3;

/**
 * Semana ou dia: a grade de 24 horas com a faixa de dia inteiro em cima. Um contêiner só rola
 * nos dois eixos, com o cabeçalho e a coluna de horas grudados, para a semana no celular
 * rolar de lado dia a dia sem descolar do cabeçalho.
 */
export function Horas({ dias }: { dias: Dia[] }) {
  const c = useCalendario();
  const rolagem = useRef<HTMLDivElement>(null);
  const hj = hoje(c.agora);
  const agora = minutosDe(c.agora);
  const temHoje = dias.includes(hj);

  useLayoutEffect(() => {
    if (rolagem.current) rolagem.current.scrollTop = ABRE_EM;
  }, []);

  return (
    <div
      ref={rolagem}
      data-dias={dias.length}
      className="cal-horas min-h-0 flex-1 overflow-auto overscroll-contain"
      style={{ ["--colunas" as string]: dias.length }}
    >
      <div className="cal-grade grid min-h-full">
        <div aria-hidden="true" className="cal-canto sticky top-0 left-0 z-30 border-b border-linha-forte bg-superficie" />
        {dias.map((dia) => (
          <Cabeca key={dia} dia={dia} hj={hj} />
        ))}

        <div className="cal-canto-dia sticky left-0 z-30 flex items-start justify-end border-b-2 border-linha-forte bg-superficie pt-1.5 pr-2 text-[11px] text-tinta-3">
          dia todo
        </div>
        {dias.map((dia) => (
          <DiaInteiro key={dia} dia={dia} hj={hj} />
        ))}

        <div aria-hidden="true" className="sticky left-0 z-20 bg-superficie">
          <div className="relative h-[1440px]">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) =>
              temHoje && Math.abs(h * HORA - agora) < 14 ? null : (
                <span key={h} style={{ top: h * HORA - 7 }} className="absolute right-2 text-[11px] leading-[14px] text-tinta-3 tabular">
                  {textoDaHora(h * HORA)}
                </span>
              ),
            )}
            {temHoje && (
              <span style={{ top: agora - 9 }} className="cal-pilula-agora absolute right-1 tabular">
                {textoDaHora(agora)}
              </span>
            )}
          </div>
        </div>
        {dias.map((dia) => (
          <Coluna key={dia} dia={dia} hj={hj} agora={temHoje ? agora : null} />
        ))}
      </div>
    </div>
  );
}

function Cabeca({ dia, hj }: { dia: Dia; hj: Dia }) {
  const c = useCalendario();
  const ehHoje = dia === hj;
  return (
    <div className="cal-cabeca sticky top-0 z-20 flex items-end justify-center border-b border-linha-forte bg-superficie pb-1.5">
      <button
        type="button"
        onClick={() => c.irParaDia(dia)}
        aria-label={`Ver o dia: ${rotuloDoDia(dia, (c.leitura.porDia.get(dia) ?? []).length, hj)}`}
        className="pressiona flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[15px] text-tinta-2 hover:bg-hover"
      >
        <span>{semanaCurta(dia)}</span>
        <span className={ehHoje ? "cal-hoje" : "text-tinta tabular"}>{numeroDoDia(dia)}</span>
      </button>
    </div>
  );
}

const semHora = (i: ItemCalendario) => lugarDe(i).minutos === null;

function DiaInteiro({ dia, hj }: { dia: Dia; hj: Dia }) {
  const c = useCalendario();
  const itens = (c.leitura.porDia.get(dia) ?? []).filter(semHora);
  const provisorio = c.provisorio?.lugar.dia === dia && c.provisorio.lugar.minutos === null;
  const mostrar = itens.length > MAX_DIA_INTEIRO ? MAX_DIA_INTEIRO - 1 : itens.length;
  const alvo = c.alvo?.dia === dia && c.alvo.minutos === null;
  const selecionado = c.selecao?.tipo === "dia" && c.selecao.dia === dia;
  // Na semana, o dia selecionado mora aqui: é a faixa que recebe o foco, como a casa no mês.
  return (
    <div
      role="group"
      aria-label={`${rotuloDoDia(dia, (c.leitura.porDia.get(dia) ?? []).length, hj)}${selecionado ? ", selecionado" : ""}`}
      tabIndex={selecionado ? 0 : -1}
      data-dia={dia}
      data-dia-foco={dia}
      data-selecionado={selecionado || undefined}
      data-solta="dia"
      data-dia-inteiro
      data-itens-de={dia}
      data-fim-de-semana={ehFimDeSemana(dia) || undefined}
      data-alvo={alvo || undefined}
      onClick={() => c.selecionar({ tipo: "dia", dia })}
      onDoubleClick={() => c.criar({ dia, minutos: null })}
      className="cal-dia-inteiro sticky z-10 flex min-w-0 flex-col gap-0.5 border-b-2 border-l border-linha-forte p-0.5"
    >
      {itens.slice(0, mostrar).map((i) => (
        <Item key={chaveDe(i)} item={i} variante="pilula" />
      ))}
      {provisorio && <BlocoProvisorio variante="pilula" />}
      {itens.length > mostrar && (
        <button
          type="button"
          data-mais={dia}
          tabIndex={-1}
          aria-label={`+${itens.length - mostrar} mais, dia todo, ${diaPorExtenso(dia)}`}
          onClick={(e) => (e.stopPropagation(), c.abrirDia(dia))}
          className="cal-mais"
        >
          +{itens.length - mostrar} mais
        </button>
      )}
    </div>
  );
}

function Coluna({ dia, hj, agora }: { dia: Dia; hj: Dia; agora: number | null }) {
  const c = useCalendario();
  const comHora = (c.leitura.porDia.get(dia) ?? []).filter((i) => !semHora(i));
  const posicoes = faixas(comHora.map((i) => ({ chave: chaveDe(i), minutos: lugarDe(i).minutos! })));
  const [criando, setCriando] = useState<{ inicio: number; fim: number; ponto: number } | null>(null);
  // Cada faixa precisa de uns 60px para o título caber; numa coluna estreita sobram menos faixas e o resto vira "+N".
  const coluna = useRef<HTMLDivElement>(null);
  const [maxFaixas, setMaxFaixas] = useState(MAX_FAIXAS);
  useLayoutEffect(() => {
    const el = coluna.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setMaxFaixas(Math.max(1, Math.min(MAX_FAIXAS, Math.floor(el.clientWidth / LARGURA_DA_FAIXA)))));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const provisorio = c.provisorio?.lugar.dia === dia && c.provisorio.lugar.minutos !== null ? c.provisorio.lugar.minutos : null;
  const alvo = c.alvo?.dia === dia && c.alvo.minutos !== null ? c.alvo.minutos : null;

  const minutosEm = (e: { clientY: number; currentTarget: HTMLElement }) => e.clientY - e.currentTarget.getBoundingClientRect().top;

  function aoDescer(e: PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || e.button !== 0 || e.pointerType === "touch") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = encaixarNoDia(minutosEm(e) - 7);
    setCriando({ inicio: m, fim: m + 15, ponto: e.clientY });
  }
  function aoMover(e: PointerEvent<HTMLDivElement>) {
    if (!criando || Math.abs(e.clientY - criando.ponto) < LIMIAR) return;
    setCriando({ ...criando, fim: Math.max(criando.inicio + 15, encaixarNoDia(minutosEm(e) + 7)) });
  }
  function aoSubir(e: PointerEvent<HTMLDivElement>) {
    if (!criando) return;
    setCriando(null);
    if (Math.abs(e.clientY - criando.ponto) >= LIMIAR) c.criar({ dia, minutos: criando.inicio });
    else c.selecionar({ tipo: "dia", dia });
  }

  // Itens que passam da última faixa que cabe viram um "+N" no lugar dela, que abre só aquele grupo.
  const escondido = (f: { faixa: number; faixas: number }) => f.faixas > maxFaixas && f.faixa >= maxFaixas - 1;
  const grupos = new Map<number, { de: number; ate: number }>();
  const escondidos = new Map<number, { minutos: number; n: number }>();
  for (const i of comHora) {
    const f = posicoes.get(chaveDe(i))!;
    const m = lugarDe(i).minutos!;
    const g = grupos.get(f.grupo);
    grupos.set(f.grupo, { de: Math.min(g?.de ?? m, m), ate: Math.max(g?.ate ?? 0, m + DURACAO) });
    if (escondido(f)) {
      const atual = escondidos.get(f.grupo);
      escondidos.set(f.grupo, { minutos: Math.min(atual?.minutos ?? Infinity, m), n: (atual?.n ?? 0) + 1 });
    }
  }
  const largura = (faixas: number) => 100 / Math.min(faixas, maxFaixas);

  return (
    <div
      ref={coluna}
      data-dia={dia}
      data-solta="horas"
      data-itens-de={dia}
      data-fim-de-semana={ehFimDeSemana(dia) || undefined}
      onPointerDown={aoDescer}
      onPointerMove={aoMover}
      onPointerUp={aoSubir}
      onPointerCancel={() => setCriando(null)}
      onDoubleClick={(e) => e.target === e.currentTarget && c.criar({ dia, minutos: encaixarNoDia(minutosEm(e) - 7) })}
      className="cal-coluna relative h-[1440px] min-w-0 border-l border-linha-forte"
    >
      {comHora.map((i) => {
        const f = posicoes.get(chaveDe(i))!;
        if (escondido(f)) return null;
        const w = largura(f.faixas);
        return (
          <Item
            key={chaveDe(i)}
            item={i}
            variante="bloco"
            estilo={{ top: lugarDe(i).minutos!, height: DURACAO - 2, left: `calc(${f.faixa * w}% + 1px)`, width: `calc(${w}% - 3px)` }}
          />
        );
      })}
      {[...escondidos].map(([grupo, { minutos, n }]) => {
        const w = largura(maxFaixas + 1);
        const ancora = `${dia}-${grupo}`;
        return (
          <button
            key={grupo}
            type="button"
            data-mais={dia}
            data-mais-grupo={ancora}
            tabIndex={-1}
            aria-label={`+${n} itens, ${diaPorExtenso(dia)}, a partir das ${textoDaHora(minutos)}`}
            onClick={() => c.abrirDia(dia, { ancora: `[data-mais-grupo="${ancora}"]`, faixa: grupos.get(grupo) })}
            style={{ top: minutos, left: `calc(${(maxFaixas - 1) * w}% + 1px)`, width: `calc(${w}% - 3px)` }}
            className="cal-mais cal-mais-bloco"
          >
            +{n}
          </button>
        );
      })}
      {criando && (
        <div aria-hidden="true" data-tom="nenhum" style={{ top: criando.inicio, height: criando.fim - criando.inicio - 2 }} className="cal-item cal-bloco cal-provisorio">
          <span className="cal-hora tabular">{textoDaHora(criando.inicio)}</span>
        </div>
      )}
      {provisorio !== null && <BlocoProvisorio variante="bloco" estilo={{ top: provisorio, height: DURACAO - 2, left: 1, right: 2 }} />}
      {alvo !== null && (
        <div aria-hidden="true" style={{ top: alvo, height: DURACAO - 2 }} className="cal-alvo">
          <span className="tabular">{textoDaHora(alvo)}</span>
        </div>
      )}
      {agora !== null &&
        (dia === hj ? (
          <div aria-hidden="true" style={{ top: agora }} className="cal-agora" />
        ) : (
          <div aria-hidden="true" style={{ top: agora }} className="cal-agora-fraco" />
        ))}
    </div>
  );
}
