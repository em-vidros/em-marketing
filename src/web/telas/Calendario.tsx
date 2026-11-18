import { ptBR } from "date-fns/locale";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CalendarProvider, useCalendar } from "@/shadcn/calendar-provider";
import type { NewEventRange, ViewType } from "@/shadcn/calendar-types";
import { MonthView } from "@/shadcn/month-view";
import { TimeGrid } from "@/shadcn/time-grid";
import { apiCalendario } from "../api";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { criarAgenda, type Agenda, type Leitura } from "../componentes/calendario/agenda";
import { ano, hoje, nomeDaSemana, nomeDoMes, numeroDoDia, type Dia } from "../componentes/calendario/datas";
import { Detalhes } from "../componentes/calendario/Detalhes";
import { enviarAoAbrir } from "../componentes/calendario/enviarAoAbrir";
import { ConteudoDoEvento, MenuDoEvento } from "../componentes/calendario/Evento";
import {
  eventoDe,
  idDe,
  lugarDaParede,
  mudancaDe,
  RASCUNHO,
  rascunhoEm,
  remocaoDe,
  type EventoDoCalendario,
  type ItemNaTela,
  type Rascunho,
} from "../componentes/calendario/eventos";
import type { ItemPauta, Lugar } from "../componentes/calendario/itens";
import { Falha } from "../componentes/Falha";
import { mostrarAviso } from "../componentes/menu/Avisos";
import { pilhaDeDesfazer } from "../componentes/menu/desfazer";
import { Dica } from "../componentes/menu/Teclas";
import { Segmentado } from "../componentes/Segmentado";
import { navegar } from "../rota";
import { useAtalho } from "../teclado/motor";

type Visao = Extract<ViewType, "day" | "week" | "month">;

const VISOES = [
  { valor: "day", rotulo: "Dia" },
  { valor: "week", rotulo: "Semana" },
  { valor: "month", rotulo: "Mês" },
] as const satisfies readonly { valor: Visao; rotulo: string }[];

const CHAVE_VISAO = "calendario:visao";

function lerVisao(): Visao {
  try {
    const v = localStorage.getItem(CHAVE_VISAO);
    return VISOES.find((x) => x.valor === v)?.valor ?? "week";
  } catch {
    return "week";
  }
}

function gravarVisao(v: Visao) {
  try {
    localStorage.setItem(CHAVE_VISAO, v);
  } catch {}
}

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const diaDaParede = (d: Date) => lugarDaParede(d, true).dia;

/** O que os pedaços dentro do CalendarCN pedem à tela, fora o que vem do `useCalendar`. */
interface Tela {
  agenda: Agenda;
  leitura: Leitura;
  rascunho: Rascunho | null;
  setRascunho: (r: Rascunho | null) => void;
  remover: (item: ItemNaTela) => void;
  criarComChefe: (pauta: ItemPauta) => void;
}

export function Calendario({ abrirMenu }: { abrirMenu: () => void }) {
  useEffect(() => {
    document.title = "Calendário · EM Marketing";
  }, []);
  const [agenda] = useState(() => criarAgenda(apiCalendario, mostrarAviso, pilhaDeDesfazer));
  const leitura = useSyncExternalStore(agenda.assinar, agenda.ler);
  const [visao, setVisao] = useState<Visao>(lerVisao);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);

  const eventos = useMemo(() => {
    const itens: ItemNaTela[] = [...leitura.porDia.values()].flat();
    if (rascunho) itens.push(rascunho);
    return itens.map(eventoDe);
  }, [leitura, rascunho]);

  // Relê a cada minuto com a aba à vista: o Chefe agenda e publica enquanto a tela está aberta.
  useEffect(() => {
    const timer = setInterval(() => !document.hidden && agenda.reler(), 60_000);
    return () => clearInterval(timer);
  }, [agenda]);

  function criarEvento(range: NewEventRange): EventoDoCalendario | null {
    const r = rascunhoEm(lugarDaParede(range.start, false), Date.now());
    if ("recusa" in r) {
      mostrarAviso({ tipo: "erro", texto: r.recusa });
      return null;
    }
    setRascunho(r);

    return eventoDe(r);
  }

  function aoMudarEvento(evento: EventoDoCalendario) {
    const m = mudancaDe(evento, Date.now());
    if (m.tipo === "recusar") mostrarAviso({ tipo: "erro", texto: m.motivo });
    else if (m.tipo === "mover") void agenda.mover(m.item, m.lugar);
  }

  function remover(item: ItemNaTela) {
    const r = remocaoDe(item);
    if (r?.acao === "apagar-pauta") void agenda.apagarPauta(r.pauta);
    else if (r) void agenda.cancelar(r.agendado);
  }

  async function criarComChefe(pauta: ItemPauta) {
    try {
      const r = await agenda.conversaDaPauta(pauta);
      navegar(`/c/${r.conversaId}`);
      if (r.vazia) enviarAoAbrir(r.conversaId, r.pedido);
    } catch (e) {
      mostrarAviso({ tipo: "erro", texto: `Não deu para abrir a conversa com o Chefe. ${e instanceof Error ? e.message : ""}` });
    }
  }

  const tela: Tela = { agenda, leitura, rascunho, setRascunho, remover, criarComChefe: (p) => void criarComChefe(p) };

  return (
    <CalendarProvider<EventoDoCalendario>
      events={eventos}
      view={visao}
      onViewChange={(v) => {
        const nova = VISOES.find((x) => x.valor === v)?.valor ?? "week";
        setVisao(nova);
        gravarVisao(nova);
      }}
      locale={ptBR}
      hourCycle={24}
      weekStartsOn={0}
      createEvent={criarEvento}
      onEventUpdate={aoMudarEvento}
      onVisibleRangeChange={(r) => agenda.garantir(diaDaParede(r.start), diaDaParede(new Date(r.end.getTime() - 1)))}
      renderEventContent={ConteudoDoEvento}
      renderEventDetails={({ event, close }) => <DetalhesNoCalendario evento={event} fechar={close} tela={tela} />}
      renderEventContextMenu={({ event, close }) => <MenuNoCalendario evento={event} fechar={close} tela={tela} />}
    >
      <Corpo abrirMenu={abrirMenu} tela={tela} />
    </CalendarProvider>
  );
}

/** Seleciona um rascunho no lugar pedido, já no passo de anotar a ideia, ou avisa que o horário já passou. */
function useRascunhar(tela: Tela) {
  const { selectEvent } = useCalendar<EventoDoCalendario>();
  return (lugar: Lugar) => {
    const r = rascunhoEm(lugar, Date.now(), "ideia");
    if ("recusa" in r) return mostrarAviso({ tipo: "erro", texto: r.recusa });
    tela.setRascunho(r);
    selectEvent(RASCUNHO);
  };
}

function DetalhesNoCalendario({ evento, fechar, tela }: { evento: EventoDoCalendario; fechar: () => void; tela: Tela }) {
  const { selectEvent } = useCalendar<EventoDoCalendario>();
  const rascunhar = useRascunhar(tela);
  return (
    <Detalhes
      item={evento.item}
      acoes={{
        agenda: tela.agenda,
        prontos: tela.leitura.prontos,
        fechar,
        selecionar: (item) => selectEvent(idDe(item)),
        remover: (item) => {
          fechar();
          tela.remover(item);
        },
        rascunhar,
        criarComChefe: tela.criarComChefe,
      }}
    />
  );
}

function MenuNoCalendario({ evento, fechar, tela }: { evento: EventoDoCalendario; fechar: () => void; tela: Tela }) {
  const { selectEvent } = useCalendar<EventoDoCalendario>();
  return <MenuDoEvento evento={evento} fechar={fechar} abrir={() => selectEvent(evento.id)} remover={() => tela.remover(evento.item)} />;
}

function Corpo({ abrirMenu, tela }: { abrirMenu: () => void; tela: Tela }) {
  const cal = useCalendar<EventoDoCalendario>();
  const { view, selectedEventId, selectedEvent, clearSelection, visibleRange } = cal;
  const visao: Visao = view === "day" || view === "month" ? view : "week";

  const raiz = useRef<HTMLDivElement>(null);
  const rascunhar = useRascunhar(tela);
  const { rascunho, setRascunho } = tela;

  useEffect(() => {
    raiz.current?.focus({ preventScroll: true });
  }, []);

  // O rascunho só existe enquanto está selecionado: clicar fora ou em outro item o descarta.
  useEffect(() => {
    if (rascunho && selectedEventId !== RASCUNHO) setRascunho(null);
  }, [rascunho, selectedEventId, setRascunho]);

  /** O dia de hoje se está na tela; se não, o primeiro dia à vista. */
  function diaDeBase(): Dia {
    const hj = hoje();
    const inicio = diaDaParede(visibleRange.start);
    const fim = diaDaParede(new Date(visibleRange.end.getTime() - 1));

    return hj >= inicio && hj <= fim ? hj : inicio;
  }

  useAtalho("cal-hoje", cal.goToToday);
  useAtalho("cal-dia", () => cal.switchView("day"));
  useAtalho("cal-semana", () => cal.switchView("week"));
  useAtalho("cal-mes", () => cal.switchView("month"));

  useAtalho("cal-esquerda", cal.goToPrev);
  useAtalho("cal-direita", cal.goToNext);

  useAtalho("cal-nova-pauta", () => rascunhar({ dia: diaDeBase(), minutos: null }));
  useAtalho("cal-limpar", () => {
    if (!selectedEventId) return false;
    clearSelection();
  });
  useAtalho("cal-apagar", () => {
    const item = selectedEvent?.item;
    if (!item || !remocaoDe(item)) return false;
    clearSelection();
    tela.remover(item);
  });

  return (
    <div ref={raiz} tabIndex={-1} data-escopo="calendario" className="flex min-h-0 min-w-0 flex-1 flex-col bg-superficie outline-none">
      <header className="flex flex-none flex-col gap-2 px-4 pt-3 pb-2 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <BotaoMenu abrir={abrirMenu} />
          <div className="flex flex-1 justify-start sm:justify-center">
            <Segmentado tipo="abas" rotulo="Visão do calendário" opcoes={VISOES} valor={visao} aoMudar={cal.switchView} idDoPainel="cal-painel" />
          </div>
        </div>
        <div className="flex items-end justify-between gap-3">
          <Titulo visao={visao} dia={diaDaParede(cal.currentDate)} mes={cal.monthName} ano={cal.year} />
          <nav aria-label="Período" className="flex flex-none items-center gap-1">
            <Dica rotulo="Período anterior" atalho="cal-esquerda" lado="bottom">
              <button type="button" aria-label="Período anterior" onClick={cal.goToPrev} className="cal-nav">
                <Seta direcao="esquerda" />
              </button>
            </Dica>
            <Dica rotulo="Ir para hoje" atalho="cal-hoje" lado="bottom">
              <button type="button" onClick={cal.goToToday} className="cal-nav px-3.5 text-[13px] font-medium">
                Hoje
              </button>
            </Dica>
            <Dica rotulo="Próximo período" atalho="cal-direita" lado="bottom">
              <button type="button" aria-label="Próximo período" onClick={cal.goToNext} className="cal-nav">
                <Seta direcao="direita" />
              </button>
            </Dica>
          </nav>
        </div>
      </header>
      {tela.leitura.erro && tela.leitura.porDia.size === 0 && (
        <Falha className="px-5 pb-3" texto="Não deu para carregar o calendário." erro={tela.leitura.erro} tentar={() => tela.agenda.reler()} />
      )}
      <div id="cal-painel" role="tabpanel" aria-label={`Visão de ${VISOES.find((v) => v.valor === visao)!.rotulo.toLowerCase()}`} className="flex min-h-0 flex-1 flex-col border-t border-linha-forte">
        {visao === "month" ? <MonthView /> : <TimeGrid view={visao} scrollToHour={8} />}
      </div>
    </div>
  );
}

function Titulo({ visao, dia, mes, ano: doAno }: { visao: Visao; dia: Dia; mes: string; ano: string }) {
  return (
    <h1 className="min-w-0 text-[22px]/tight tracking-[-0.02em] text-balance sm:text-[26px]">
      {visao === "day" ? (
        <>
          <span className="font-semibold">
            {numeroDoDia(dia)} de {nomeDoMes(dia)}
          </span>
          <span className="font-normal max-sm:hidden"> {ano(dia)}</span>
          <span className="mt-0.5 block text-[15px] font-normal tracking-normal text-tinta-2">{capitalizar(nomeDaSemana(dia))}</span>
        </>
      ) : (
        <>
          <span className="font-semibold">{capitalizar(mes)}</span> <span className="font-normal">{doAno}</span>
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
