import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PostPronto } from "../../agent/fila";
import { apiCalendario } from "../api";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { criarAgenda } from "../componentes/calendario/agenda";
import { Bolha, seletorDe, type Aberto, type AcoesDaBolha } from "../componentes/calendario/Bolha";
import { ContextoCalendario, PROVISORIO, type Calendario as Ctx, type Provisorio, type Selecao, type Visao } from "../componentes/calendario/contexto";
import { ano, diaDe, hoje, inicioDaSemana, nomeDaSemana, nomeDoMes, numeroDoDia, primeiroDoMes, somarDias, somarMeses, type Dia } from "../componentes/calendario/datas";
import { enviarAoAbrir } from "../componentes/calendario/enviarAoAbrir";
import { Horas } from "../componentes/calendario/Horas";
import { chaveDe, ehMovel, instanteDe, lugarDe, tituloDoPost, type Chave, type Lugar } from "../componentes/calendario/itens";
import { Mes, type PedidoDoMes } from "../componentes/calendario/Mes";
import { FolhaProntos, ListaProntos } from "../componentes/calendario/Prontos";
import { HORA_PADRAO, useArrasto } from "../componentes/calendario/useArrasto";
import { PASSADO } from "../componentes/calendario/arrasto";
import { Falha } from "../componentes/Falha";
import { mostrarAviso } from "../componentes/menu/Avisos";
import { pilhaDeDesfazer } from "../componentes/menu/desfazer";
import { Dica } from "../componentes/menu/Teclas";
import { Segmentado } from "../componentes/Segmentado";
import { useMedia } from "../media";
import { navegar } from "../rota";
import { useAtalho } from "../teclado/motor";

const VISOES = [
  { valor: "dia", rotulo: "Dia" },
  { valor: "semana", rotulo: "Semana" },
  { valor: "mes", rotulo: "Mês" },
] as const;

const COMPACTO = "(max-width: 39.99rem)";
/** A coluna de prontos cabe ao lado da grade daqui para cima; abaixo, vira folha. */
const LARGO = "(min-width: 80rem)";

const CHAVE_VISAO = "calendario:visao";
const CHAVE_PRONTOS = "calendario:prontos";

function lerLocal<T extends string>(chave: string, validos: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(chave);
    return validos.find((x) => x === v) ?? null;
  } catch {
    return null;
  }
}
function gravarLocal(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {}
}

/** A hora de agora, trocando a cada virada de minuto: a linha vermelha e o "já passou" usam esta. */
function useAgora() {
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const agendar = () => {
      timer = setTimeout(() => (setAgora(Date.now()), agendar()), 60_000 - (Date.now() % 60_000) + 50);
    };
    agendar();
    return () => clearTimeout(timer);
  }, []);
  return agora;
}

/** Os dias da semana ou do dia, a partir do dia de referência. */
const diasDa = (visao: Visao, dia: Dia): Dia[] =>
  visao === "dia" ? [dia] : Array.from({ length: 7 }, (_, i) => somarDias(inicioDaSemana(dia), i));

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Calendario({ abrirMenu }: { abrirMenu: () => void }) {
  useEffect(() => {
    document.title = "Calendário · EM Marketing";
  }, []);
  const compacto = useMedia(COMPACTO);
  const largo = useMedia(LARGO);
  const agora = useAgora();
  const hj = hoje(agora);

  const [agenda] = useState(() => criarAgenda(apiCalendario, mostrarAviso, pilhaDeDesfazer));
  const leitura = useSyncExternalStore(agenda.assinar, agenda.ler);

  const [visao, setVisaoCrua] = useState<Visao>(() => lerLocal(CHAVE_VISAO, ["dia", "semana", "mes"] as const) ?? (matchMedia(COMPACTO).matches ? "dia" : "mes"));
  const [dia, setDia] = useState<Dia>(hj);
  const [pedido, setPedido] = useState<PedidoDoMes>({ dia: hj, modo: "mes", n: 0 });
  const [mesVisivel, setMesVisivel] = useState<Dia>(primeiroDoMes(hj));
  const [selecao, setSelecao] = useState<Selecao>(null);
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [provisorio, setProvisorio] = useState<Provisorio | null>(null);
  const [prontosAberto, setProntosAberto] = useState(() => lerLocal(CHAVE_PRONTOS, ["0", "1"] as const) !== "0");
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [recusa, setRecusa] = useState<{ motivo: string; x: number; y: number } | null>(null);
  /** Navegar (‹ › Hoje, trocar de visão) marca a grade nova para os itens entrarem 50 ms depois dela. */
  const [entrando, setEntrando] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const aoFechar = useRef<(() => void) | null>(null);

  const dias = diasDa(visao, dia);
  const navegou = () => setEntrando((n) => n + 1);

  // Relê a cada minuto com a aba à vista: o Chefe agenda e publica enquanto a tela está aberta.
  useEffect(() => {
    const timer = setInterval(() => !document.hidden && agenda.reler(), 60_000);
    return () => clearInterval(timer);
  }, [agenda]);
  useEffect(() => {
    if (visao !== "mes") agenda.garantir(dias[0]!, dias.at(-1)!);
  }, [agenda, visao, dias[0]]);

  useEffect(() => {
    raiz.current?.focus({ preventScroll: true });
  }, []);

  // Como no Mac, a grade nova troca num corte seco e os itens aparecem uns 50 ms depois dela.
  useLayoutEffect(() => {
    if (!entrando) return;
    for (const el of raiz.current?.querySelectorAll(".cal-vista .cal-item") ?? [])
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 90, delay: 50, easing: "ease-out", fill: "backwards" });
  }, [entrando]);

  useEffect(() => {
    if (!recusa) return;
    const timer = setTimeout(() => setRecusa(null), 3500);
    return () => clearTimeout(timer);
  }, [recusa]);

  function setVisao(v: Visao, noDia?: Dia) {
    const alvo = noDia ?? selecao?.dia ?? (visao === "mes" ? (primeiroDoMes(hj) === mesVisivel ? hj : mesVisivel) : dia);
    setVisaoCrua(v);
    gravarLocal(CHAVE_VISAO, v);
    setDia(alvo);
    setPedido((p) => ({ dia: alvo, modo: "mes", n: p.n + 1 }));
    navegou();
  }

  function andarPeriodo(passo: 1 | -1) {
    if (visao === "mes") setPedido((p) => ({ dia: somarMeses(mesVisivel, passo), modo: "mes", n: p.n + 1 }));
    else setDia((d) => somarDias(d, passo * (visao === "semana" ? 7 : 1)));
    navegou();
  }

  function irParaHoje() {
    setDia(hj);
    setPedido((p) => ({ dia: hj, modo: "mes", n: p.n + 1 }));
    setSelecao({ tipo: "dia", dia: hj });
    navegou();
  }

  /** Traz o dia para a tela: no mês rola até a semana dele; na semana e no dia troca o período. */
  function mostrar(d: Dia) {
    if (visao === "mes") setPedido((p) => ({ dia: d, modo: "mostrar", n: p.n + 1 }));
    else if (!dias.includes(d)) setDia(d);
  }

  const selecionar = useCallback((s: Selecao) => setSelecao(s), []);

  // A seleção mora no foco: as setas, o Enter e o Delete partem do elemento focado.
  useEffect(() => {
    if (aberto) return;
    const el = elementoDa(selecao);
    if (el && document.activeElement !== el) el.focus({ preventScroll: visao === "mes" });
    // O elemento focado saiu da tela (troca de visão, item apagado): o foco volta para a tela, não para o body.
    else if (!el && (document.activeElement === document.body || !document.activeElement?.isConnected)) raiz.current?.focus({ preventScroll: true });
  });

  function elementoDa(s: Selecao): HTMLElement | null {
    const r = raiz.current;
    if (!r || !s) return null;
    if (s.tipo === "item") return r.querySelector<HTMLElement>(seletorDe(s.chave));
    if (s.tipo === "mais") return r.querySelector<HTMLElement>(`[data-mais="${s.dia}"]`);
    return r.querySelector<HTMLElement>(`[data-dia-foco="${s.dia}"]`);
  }

  // --- popover ---

  function abrir(a: Aberto) {
    const anterior = aoFechar.current;
    aoFechar.current = null;
    anterior?.();
    setAberto(a);
    if (a.tipo === "nova") setProvisorio({ lugar: a.lugar, titulo: "Nova pauta" });
    else if (!(a.tipo === "agendar" && a.ancora === seletorDe(PROVISORIO))) setProvisorio(null);
  }

  function fechar() {
    const f = aoFechar.current;
    aoFechar.current = null;
    f?.();
    setAberto(null);
    setProvisorio(null);
  }

  const abrirItem = (chave: Chave) => {
    const item = leitura.achar(chave);
    if (item) setSelecao({ tipo: "item", chave, dia: lugarDe(item).dia });
    abrir({ tipo: "item", chave, ancora: seletorDe(chave) });
  };
  const abrirDia = (d: Dia) => abrir({ tipo: "dia", dia: d, ancora: `[data-itens-de="${d}"]` });
  const criar = (lugar: Lugar) => {
    setSelecao({ tipo: "dia", dia: lugar.dia });
    abrir({ tipo: "nova", lugar });
  };
  const irParaDia = (d: Dia) => {
    setSelecao({ tipo: "dia", dia: d });
    setVisao("dia", d);
  };

  async function criarComChefe(p: Parameters<AcoesDaBolha["criarComChefe"]>[0]) {
    try {
      const r = await agenda.conversaDaPauta(p);
      navegar(`/c/${r.conversaId}`);
      if (r.vazia) enviarAoAbrir(r.conversaId, r.pedido);
    } catch (e) {
      mostrarAviso({ tipo: "erro", texto: `Não deu para abrir a conversa com o Chefe. ${e instanceof Error ? e.message : ""}` });
    }
  }

  const acoes: AcoesDaBolha = {
    fechar,
    abrir,
    aoFechar,
    criarPauta: async (p) => {
      const nova = await agenda.criarPauta(p);
      if (nova) setSelecao({ tipo: "item", chave: chaveDe(nova), dia: nova.dia });
      return nova;
    },
    mudarPauta: (p, m) => void agenda.mudarPauta(p, m),
    apagarPauta: (p) => {
      setSelecao({ tipo: "dia", dia: p.dia });
      void agenda.apagarPauta(p);
    },
    criarComChefe: (p) => void criarComChefe(p),
    confirmarMover: (a, lugar) => void agenda.mover(a, lugar),
    desistirDeMover: (a) => agenda.descartarPrevia(chaveDe(a)),
    agendar: async (post, midia, publicaEm) => {
      const falha = await agenda.agendar(post, midia, publicaEm);
      if (!falha) {
        fechar();
        setSelecao({ tipo: "dia", dia: diaDe(publicaEm) });
      }
      return falha;
    },
    cancelar: (a) => void agenda.cancelar(a),
  };

  // --- arrasto ---

  const arrasto = useArrasto({
    agenda,
    agora: () => Date.now(),
    preparar: (post, lugar) => setProvisorio({ lugar, titulo: tituloDoPost(post.headline, post.postId) }),
    confirmar: (fonte, lugar) => {
      if (fonte.tipo === "pronto") abrir({ tipo: "agendar", post: fonte.post, lugar, ancora: seletorDe(PROVISORIO) });
      else if (fonte.item.tipo === "agendado") {
        setSelecao({ tipo: "item", chave: chaveDe(fonte.item), dia: lugar.dia });
        abrir({ tipo: "mover", item: fonte.item, lugar });
      }
    },
    recusar: (motivo, r) => setRecusa({ motivo, x: r.left, y: r.bottom + 6 }),
  });

  const lugarPadrao: Lugar = { dia: selecao && selecao.dia > hj ? selecao.dia : somarDias(hj, 1), minutos: HORA_PADRAO };
  function escolherPronto(post: PostPronto) {
    abrir({ tipo: "agendar", post, lugar: lugarPadrao, ancora: `[data-pronto="${post.postId}"]` });
  }

  // --- teclado ---

  /** O que dá para selecionar dentro de um dia, na ordem da tela: itens e o "+N mais". */
  function navegaveis(d: Dia): Selecao[] {
    const r = raiz.current;
    if (!r) return [];
    return [...r.querySelectorAll<HTMLElement>(`[data-itens-de="${d}"] [data-chave], [data-itens-de="${d}"] [data-mais]`)]
      .filter((el) => el.dataset.chave !== PROVISORIO && el.closest(".cal-fantasma") === null)
      .map((el): Selecao => (el.dataset.mais ? { tipo: "mais", dia: d } : { tipo: "item", chave: el.dataset.chave as Chave, dia: d }))
      .filter((s, i, todos) => s?.tipo !== "mais" || todos.findIndex((t) => t?.tipo === "mais") === i);
  }
  const mesma = (a: Selecao, b: Selecao) => !!a && !!b && a.tipo === b.tipo && a.dia === b.dia && (a.tipo !== "item" || (b.tipo === "item" && a.chave === b.chave));

  function selecionarDia(d: Dia) {
    setSelecao({ tipo: "dia", dia: d });
    mostrar(d);
  }
  const diaDeBase = () => selecao?.dia ?? (visao === "mes" ? (primeiroDoMes(hj) === mesVisivel ? hj : mesVisivel) : dias.includes(hj) ? hj : dias[0]!);

  useAtalho("cal-hoje", irParaHoje);
  useAtalho("cal-dia", () => setVisao("dia"));
  useAtalho("cal-semana", () => setVisao("semana"));
  useAtalho("cal-mes", () => setVisao("mes"));
  useAtalho("cal-esquerda", () => (selecao ? selecionarDia(somarDias(selecao.dia, -1)) : andarPeriodo(-1)));
  useAtalho("cal-direita", () => (selecao ? selecionarDia(somarDias(selecao.dia, 1)) : andarPeriodo(1)));
  useAtalho("cal-cima", () => {
    if (!selecao) {
      if (visao !== "mes") return false;
      return selecionarDia(diaDeBase());
    }
    if (selecao.tipo === "dia") return visao === "mes" ? selecionarDia(somarDias(selecao.dia, -7)) : false;
    const lista = navegaveis(selecao.dia);
    const i = lista.findIndex((s) => mesma(s, selecao));
    setSelecao(i > 0 ? lista[i - 1]! : { tipo: "dia", dia: selecao.dia });
  });
  useAtalho("cal-baixo", () => {
    if (!selecao) {
      if (visao !== "mes") return false;
      return selecionarDia(diaDeBase());
    }
    const lista = navegaveis(selecao.dia);
    const i = selecao.tipo === "dia" ? -1 : lista.findIndex((s) => mesma(s, selecao));
    if (lista[i + 1]) return setSelecao(lista[i + 1]!);
    if (visao === "mes") return selecionarDia(somarDias(selecao.dia, 7));
  });
  useAtalho("cal-abrir", () => {
    if (!selecao) return false;
    if (selecao.tipo === "item") return abrirItem(selecao.chave);
    if (selecao.tipo === "mais") return abrirDia(selecao.dia);
    const primeiro = navegaveis(selecao.dia)[0];
    if (primeiro) setSelecao(primeiro);
    else criar({ dia: selecao.dia, minutos: null });
  });
  useAtalho("cal-nova-pauta", () => criar({ dia: diaDeBase(), minutos: null }));
  useAtalho("cal-limpar", () => {
    if (!selecao) return false;
    setSelecao(null);
    raiz.current?.focus({ preventScroll: true });
  });
  useAtalho("cal-apagar", () => {
    if (selecao?.tipo !== "item") return false;
    const item = leitura.achar(selecao.chave);
    if (item?.tipo !== "pauta") return false;
    setSelecao({ tipo: "dia", dia: item.dia });
    void agenda.apagarPauta(item);
  });

  /** ⌥ e as setas: pauta muda na hora; agendado pede a confirmação, como no arrasto. Sem animação, porque nasce do teclado. */
  function moverSelecionado(dias: number, minutos: number) {
    if (selecao?.tipo !== "item") return false;
    const item = leitura.achar(selecao.chave);
    if (!item || !ehMovel(item)) return false;
    const atual = lugarDe(item);
    if (minutos !== 0 && atual.minutos === null) return;
    const lugar: Lugar = { dia: somarDias(atual.dia, dias), minutos: atual.minutos === null ? null : atual.minutos + minutos };
    if (lugar.minutos !== null && (lugar.minutos < 0 || lugar.minutos > 1425)) return;
    if (instanteDe(lugar) <= Date.now()) {
      const r = elementoDa(selecao)?.getBoundingClientRect();
      if (r) setRecusa({ motivo: PASSADO, x: r.left, y: r.bottom + 6 });
      return;
    }
    setSelecao({ tipo: "item", chave: selecao.chave, dia: lugar.dia });
    mostrar(lugar.dia);
    if (item.tipo === "pauta") void agenda.mover(item, lugar);
    else {
      agenda.prever(item, lugar);
      abrir({ tipo: "mover", item, lugar });
    }
  }
  const passoVertical = () => (visao === "mes" ? ([7, 0] as const) : ([0, 15] as const));
  useAtalho("cal-mover-cedo", () => moverSelecionado(-passoVertical()[0], -passoVertical()[1]));
  useAtalho("cal-mover-tarde", () => moverSelecionado(passoVertical()[0], passoVertical()[1]));
  useAtalho("cal-mover-antes", () => moverSelecionado(-1, 0));
  useAtalho("cal-mover-depois", () => moverSelecionado(1, 0));

  // --- tela ---

  const ctx: Ctx = {
    leitura,
    agora,
    selecao,
    selecionar,
    abrirItem,
    abrirDia,
    criar,
    irParaDia,
    descer: arrasto.descer,
    arrastada: arrasto.arrastada,
    assentando: arrasto.assentando,
    alvo: arrasto.alvo,
    provisorio,
    compacto,
  };

  const mostrarColuna = largo && prontosAberto;
  const quantosProntos = leitura.prontos?.length ?? 0;
  const alternarProntos = () => {
    if (!largo) return setFolhaAberta(true);
    setProntosAberto((a) => (gravarLocal(CHAVE_PRONTOS, a ? "0" : "1"), !a));
  };

  return (
    <ContextoCalendario.Provider value={ctx}>
      <div ref={raiz} tabIndex={-1} data-escopo="calendario" className="flex min-h-0 min-w-0 flex-1 bg-superficie outline-none">
        <main id="conteudo" className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-none flex-col gap-2 px-4 pt-3 pb-2 sm:px-5">
            <div className="flex items-center gap-2">
              <BotaoMenu abrir={abrirMenu} />
              <div className="flex flex-1 justify-start sm:justify-center">
                <Segmentado tipo="abas" rotulo="Visão do calendário" opcoes={VISOES} valor={visao} aoMudar={(v) => setVisao(v)} idDoPainel="cal-painel" />
              </div>
              <button
                type="button"
                aria-pressed={largo ? prontosAberto : undefined}
                aria-haspopup={largo ? undefined : "dialog"}
                onClick={alternarProntos}
                className="pressiona flex h-9 flex-none cursor-pointer items-center gap-2 rounded-full border border-linha-forte px-3.5 text-[13px] font-medium text-tinta-2 hover:bg-hover hover:text-tinta aria-pressed:bg-ativo aria-pressed:text-tinta"
              >
                Prontos
                {quantosProntos > 0 && <span className="rounded-full bg-tinta px-1.5 text-[11px] leading-[18px] text-sobre-tinta tabular">{quantosProntos}</span>}
              </button>
            </div>
            <div className="flex items-end justify-between gap-3">
              <Titulo visao={visao} mes={visao === "mes" ? mesVisivel : primeiroDoMes(dias[Math.min(3, dias.length - 1)]!)} dia={dias[0]!} />
              <nav aria-label="Período" className="flex flex-none items-center gap-1">
                <Dica rotulo="Período anterior" atalho="cal-esquerda" lado="bottom">
                  <button type="button" aria-label="Período anterior" onClick={() => andarPeriodo(-1)} className="cal-nav">
                    <Seta direcao="esquerda" />
                  </button>
                </Dica>
                <Dica rotulo="Ir para hoje" atalho="cal-hoje" lado="bottom">
                  <button type="button" onClick={irParaHoje} className="cal-nav px-3.5 text-[13px] font-medium">
                    Hoje
                  </button>
                </Dica>
                <Dica rotulo="Próximo período" atalho="cal-direita" lado="bottom">
                  <button type="button" aria-label="Próximo período" onClick={() => andarPeriodo(1)} className="cal-nav">
                    <Seta direcao="direita" />
                  </button>
                </Dica>
              </nav>
            </div>
          </header>
          {leitura.erro && leitura.porDia.size === 0 && (
            <Falha className="px-5 pb-3" texto="Não deu para carregar o calendário." erro={leitura.erro} tentar={() => agenda.reler()} />
          )}
          <div id="cal-painel" role="tabpanel" aria-label={`Visão de ${VISOES.find((v) => v.valor === visao)!.rotulo.toLowerCase()}`} className="cal-vista flex min-h-0 flex-1 flex-col border-t border-linha-forte">
            {visao === "mes" ? (
              <Mes pedido={pedido} aoVerMes={setMesVisivel} aoVerFaixa={agenda.garantir} />
            ) : (
              <Horas dias={dias} />
            )}
          </div>
        </main>
        {mostrarColuna && (
          <aside aria-label="Prontos para agendar" className="flex w-[280px] flex-none flex-col border-l border-linha-forte bg-fundo">
            <h2 className="px-4 pt-4 pb-1 text-[13px] font-semibold">Prontos para agendar</h2>
            <p className="px-4 pb-2 text-xs text-pretty text-tinta-3">Arraste para um horário ou clique para escolher.</p>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <ListaProntos prontos={leitura.prontos} aoEscolher={escolherPronto} />
            </div>
          </aside>
        )}
      </div>
      {arrasto.fantasma}
      <Bolha aberto={aberto} acoes={acoes} />
      {!largo && (
        <FolhaProntos aberta={folhaAberta} fechar={() => setFolhaAberta(false)} prontos={leitura.prontos} lugarPadrao={lugarPadrao} agendar={acoes.agendar} />
      )}
      <div role="status" aria-live="polite" className="pointer-events-none fixed z-[60]" style={recusa ? { left: recusa.x, top: recusa.y } : { left: -9999, top: 0 }}>
        {recusa && <span className="cal-recusa">{recusa.motivo}</span>}
      </div>
    </ContextoCalendario.Provider>
  );
}

function Titulo({ visao, mes, dia }: { visao: Visao; mes: Dia; dia: Dia }) {
  return (
    <h1 className="min-w-0 truncate text-[22px]/tight tracking-[-0.02em] sm:text-[26px]">
      {visao === "dia" ? (
        <>
          <span className="font-semibold">
            {numeroDoDia(dia)} de {nomeDoMes(dia)}
          </span>{" "}
          <span className="font-normal">{ano(dia)}</span>
          <span className="mt-0.5 block text-[15px] font-normal tracking-normal text-tinta-2">{capitalizar(nomeDaSemana(dia))}</span>
        </>
      ) : (
        <>
          <span className="font-semibold">{capitalizar(nomeDoMes(mes))}</span> <span className="font-normal">{ano(mes)}</span>
        </>
      )}
    </h1>
  );
}

function Seta({ direcao }: { direcao: "esquerda" | "direita" }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={direcao === "esquerda" ? "M8.5 3 4.5 7l4 4" : "M5.5 3l4 4-4 4"} />
    </svg>
  );
}
