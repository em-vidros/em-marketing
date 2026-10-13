import { animate, useReducedMotion, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { diaPorExtenso, diasEntre, ehFimDeSemana, hoje, inicioDaSemana, mesCurto, numeroDoDia, primeiroDoMes, somarDias, type Dia } from "./datas";
import { useCalendario } from "./contexto";
import { BlocoProvisorio, Item, Ponto } from "./Item";
import { chaveDe, type ItemCalendario } from "./itens";
import { rotuloDoDia, SEMANA } from "./rotulos";

/** Pedido de rolagem vindo de fora: ir ao mês (‹ › Hoje) ou só mostrar um dia que a seleção alcançou. */
export interface PedidoDoMes {
  dia: Dia;
  modo: "mes" | "mostrar";
  /** Muda a cada pedido, para repetir o mesmo dia. */
  n: number;
}

/** Semanas montadas de uma vez; perto da borda a janela recentra sem a pessoa ver. */
const SEMANAS = 80;
const MEIO = 30;
const BORDA = 8;
const LINHAS = 6;
/** O número do dia ocupa o topo da casa; cada linha de item tem 18px e 2px de respiro. */
const TOPO = 28;
const LINHA = 20;

/** A mola do encaixe, medida no Calendário do Mac: sem passar do ponto, assenta em ~0,3 s. */
const ENCAIXE = { type: "spring", bounce: 0, duration: 0.3 } as const;

/**
 * O mês como rolagem contínua por semana, como no Mac: 6 linhas que dividem a altura, e ao
 * parar de rolar a grade encaixa na semana mais perto com uma mola criticamente amortecida.
 * O título acompanha o mês que ocupa mais casas na tela.
 */
export function Mes({ pedido, aoVerMes, aoVerFaixa }: { pedido: PedidoDoMes; aoVerMes: (mes: Dia) => void; aoVerFaixa: (de: Dia, ate: Dia) => void }) {
  const c = useCalendario();
  const reduzir = useReducedMotion();
  const rolagem = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState(0);
  /** A barra de rolagem que ocupa espaço (Windows): o cabeçalho dos dias recua o mesmo tanto. */
  const [barra, setBarra] = useState(0);
  const linha = altura / LINHAS;
  const [inicio, setInicio] = useState(() => somarDias(inicioDaSemana(primeiroDoMes(pedido.dia)), -MEIO * 7));
  /** O scrollTop a aplicar depois do render que trocou a janela. */
  const topoPendente = useRef<number | null>(MEIO);
  const mola = useRef<AnimationPlaybackControls | null>(null);
  const [mesVisivel, setMesVisivel] = useState<Dia>(primeiroDoMes(pedido.dia));
  const hj = hoje(c.agora);

  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setAltura(el.clientHeight);
      setBarra(el.offsetWidth - el.clientWidth);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const semanaDe = (dia: Dia) => Math.floor(diasEntre(inicio, dia) / 7);

  // Rolar até um mês (corte seco, como no Mac) ou só até a semana que a seleção alcançou.
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el || !linha) return;
    mola.current?.stop();
    const alvo = pedido.modo === "mes" ? inicioDaSemana(primeiroDoMes(pedido.dia)) : inicioDaSemana(pedido.dia);
    let indice = semanaDe(alvo);
    if (pedido.modo === "mostrar") {
      const topo = Math.round(el.scrollTop / linha);
      if (indice >= topo && indice < topo + LINHAS) return;
      indice = indice < topo ? indice : indice - LINHAS + 1;
    }
    if (indice < BORDA || indice > SEMANAS - LINHAS - BORDA) {
      setInicio(somarDias(inicio, (indice - MEIO) * 7));
      topoPendente.current = MEIO;
      return;
    }
    el.scrollTop = indice * linha;
    // Só um pedido novo rola; a altura entra para atender o primeiro assim que houver medida.
  }, [pedido.n, linha > 0]);

  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el || !linha || topoPendente.current === null) return;
    el.scrollTop = topoPendente.current * linha;
    topoPendente.current = null;
    ler();
  }, [inicio, linha]);

  // Mantém a semana do topo quando a janela muda de altura.
  const linhaAntes = useRef(linha);
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (el && linhaAntes.current && linha && linhaAntes.current !== linha) el.scrollTop = Math.round(el.scrollTop / linhaAntes.current) * linha;
    linhaAntes.current = linha;
  }, [linha]);

  /** O mês com mais casas entre as 42 visíveis vira o título; e a faixa visível vai para a leitura. */
  function ler() {
    const el = rolagem.current;
    if (!el || !linha) return;
    const topo = Math.round(el.scrollTop / linha);
    const de = somarDias(inicio, topo * 7);
    const contagem = new Map<Dia, number>();
    for (let i = 0; i < LINHAS * 7; i++) {
      const m = primeiroDoMes(somarDias(de, i));
      contagem.set(m, (contagem.get(m) ?? 0) + 1);
    }
    const mes = [...contagem].sort((a, b) => b[1] - a[1])[0]![0];
    setMesVisivel(mes);
    aoVerMes(mes);
    aoVerFaixa(somarDias(de, -7), somarDias(de, LINHAS * 7 + 6));
  }

  function encaixar() {
    const el = rolagem.current;
    if (!el || !linha) return;
    const topo = Math.round(el.scrollTop / linha);
    if (topo < BORDA || topo > SEMANAS - LINHAS - BORDA) {
      setInicio(somarDias(inicio, (topo - MEIO) * 7));
      topoPendente.current = MEIO;
      return;
    }
    const alvo = topo * linha;
    if (Math.abs(alvo - el.scrollTop) < 0.5) return;
    if (reduzir) {
      el.scrollTop = alvo;
      return;
    }
    mola.current = animate(el.scrollTop, alvo, { ...ENCAIXE, onUpdate: (v) => (el.scrollTop = v) });
  }

  // O encaixe espera a rolagem parar de vez, inércia do trackpad incluída.
  const espera = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const quadro = useRef(0);
  function aoRolar() {
    cancelAnimationFrame(quadro.current);
    quadro.current = requestAnimationFrame(ler);
    // Durante um arrasto a grade fica onde a pessoa deixou; encaixar moveria o dia sob o ponteiro.
    if (c.arrastando) return;
    if (mola.current?.state === "running") return;
    clearTimeout(espera.current);
    espera.current = setTimeout(encaixar, 160);
  }
  const pararMola = () => mola.current?.stop();
  useEffect(() => {
    if (c.arrastando) {
      clearTimeout(espera.current);
      mola.current?.stop();
      return;
    }
    espera.current = setTimeout(encaixar, 160);
    return () => clearTimeout(espera.current);
  }, [c.arrastando]);
  useEffect(() => () => (clearTimeout(espera.current), mola.current?.stop()), []);

  const semanas = Array.from({ length: SEMANAS }, (_, i) => somarDias(inicio, i * 7));
  const capacidade = Math.max(0, Math.floor((linha - TOPO) / LINHA));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div aria-hidden="true" style={{ paddingRight: barra }} className="grid flex-none grid-cols-7 border-b border-linha-forte">
        {SEMANA.map((d) => (
          <span key={d} className="truncate px-2 pb-1.5 text-right text-[13px] text-tinta-3">
            {d}
          </span>
        ))}
      </div>
      <div
        ref={rolagem}
        role="grid"
        aria-label={`Mês de ${rotuloDoMes(mesVisivel)}`}
        onScroll={aoRolar}
        onWheel={pararMola}
        onTouchStart={pararMola}
        onPointerDown={pararMola}
        onKeyDown={pararMola}
        className="cal-mes min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {linha > 0 &&
          semanas.map((semana) => (
            <div key={semana} role="row" style={{ height: linha }} className="grid grid-cols-7 border-b border-linha-forte">
              {Array.from({ length: 7 }, (_, d) => {
                const dia = somarDias(semana, d);
                return <Casa key={dia} dia={dia} hj={hj} mes={mesVisivel} capacidade={capacidade} />;
              })}
            </div>
          ))}
      </div>
    </div>
  );
}

const rotuloDoMes = (mes: Dia) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.parse(`${mes}T12:00:00Z`));

function Casa({ dia, hj, mes, capacidade }: { dia: Dia; hj: Dia; mes: Dia; capacidade: number }) {
  const c = useCalendario();
  const itens = c.leitura.porDia.get(dia) ?? [];
  const provisorio = c.provisorio?.lugar.dia === dia;
  const selecionado = c.selecao?.tipo === "dia" && c.selecao.dia === dia;
  const foraDoMes = primeiroDoMes(dia) !== mes;
  const ehHoje = dia === hj;
  const alvo = c.alvo?.dia === dia;
  const n = itens.length + (provisorio ? 1 : 0);
  // Se não cabe tudo, a última linha vira "+N mais".
  const mostrar = n > capacidade ? Math.max(0, capacidade - 1) : n;
  const visiveis = itens.slice(0, provisorio ? Math.max(0, mostrar - 1) : mostrar);
  const escondidos = itens.length - visiveis.length;
  const tabulavel = selecionado || (c.selecao === null && ehHoje);

  return (
    <div
      role="gridcell"
      data-dia={dia}
      data-dia-foco={dia}
      data-solta="dia"
      data-itens-de={dia}
      data-fim-de-semana={ehFimDeSemana(dia) || undefined}
      data-fora={foraDoMes || undefined}
      data-alvo={alvo || undefined}
      aria-selected={selecionado}
      aria-label={rotuloDoDia(dia, itens.length, hj)}
      tabIndex={tabulavel ? 0 : -1}
      onClick={() => (c.compacto ? c.abrirDia(dia) : c.selecionar({ tipo: "dia", dia }))}
      onDoubleClick={() => c.criar({ dia, minutos: null })}
      className="cal-casa relative flex min-w-0 flex-col gap-0.5 border-r border-linha-forte px-1 pb-1 last:border-r-0"
    >
      <span className="flex h-[26px] flex-none items-center justify-end gap-1 pr-0.5 text-[13px]">
        {numeroDoDia(dia) === 1 && <span className="cal-num-mes">{mesCurto(dia)}</span>}
        <span className={ehHoje ? "cal-hoje" : "cal-num tabular"}>{numeroDoDia(dia)}</span>
      </span>
      {c.compacto ? (
        <span className="flex flex-wrap justify-center gap-[3px] px-0.5">
          {itens.slice(0, 4).map((i) => (
            <Ponto key={chaveDe(i)} item={i} />
          ))}
        </span>
      ) : (
        <>
          {visiveis.map((i) => (
            <Item key={chaveDe(i)} item={i} variante={lugarSemHora(i) ? "pilula" : "linha"} />
          ))}
          {provisorio && <BlocoProvisorio variante="linha" />}
          {escondidos > 0 && (
            <button
              type="button"
              data-mais={dia}
              tabIndex={c.selecao?.tipo === "mais" && c.selecao.dia === dia ? 0 : -1}
              aria-label={`+${escondidos} mais, ${diaPorExtenso(dia)}`}
              onClick={(e) => (e.stopPropagation(), c.abrirDia(dia))}
              onDoubleClick={(e) => e.stopPropagation()}
              className="cal-mais"
            >
              +{escondidos} mais
            </button>
          )}
        </>
      )}
    </div>
  );
}

const lugarSemHora = (i: ItemCalendario) => i.tipo === "data" || (i.tipo === "pauta" && i.hora === null);
