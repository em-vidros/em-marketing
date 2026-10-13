import { Popover } from "@base-ui/react/popover";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import type { PostPronto } from "../../../agent/fila";
import type { Pilar, TipoMidia } from "../../../db";
import { PILARES, MIDIA } from "../peca";
import { diaPorExtenso, epochDe, minutosDaHora, minutosDe, momentoPorExtenso, textoDaHora, type Dia } from "./datas";
import { PASSADO } from "./arrasto";
import { useCalendario } from "./contexto";
import { Alerta, Relogio, Visto } from "./Item";
import { chaveDe, lugarDe, rotuloDe, tituloDe, tituloDoPost, type AgendadoPendente, type Chave, type ItemAgendado, type ItemCalendario, type ItemPauta, type Lugar } from "./itens";

/** O que o popover mostra, e onde se ancora (um seletor, para seguir o elemento entre renders). */
export type Aberto =
  | { tipo: "item"; chave: Chave; ancora: string }
  | { tipo: "nova"; lugar: Lugar }
  | { tipo: "mover"; item: AgendadoPendente; lugar: Lugar }
  | { tipo: "agendar"; post: PostPronto; lugar: Lugar; ancora: string }
  | { tipo: "dia"; dia: Dia; ancora: string };

export const seletorDe = (chave: string) => `[data-chave="${CSS.escape(chave)}"]`;

export function ancoraDe(a: Aberto): string {
  switch (a.tipo) {
    case "item":
    case "agendar":
    case "dia":
      return a.ancora;
    case "nova":
      return seletorDe("provisorio");
    case "mover":
      return seletorDe(chaveDe(a.item));
  }
}

export interface AcoesDaBolha {
  fechar: () => void;
  abrir: (a: Aberto) => void;
  /** O editor de pauta grava ao fechar: registra aqui o que fazer na hora. */
  aoFechar: RefObject<(() => void) | null>;
  criarPauta: (p: { dia: Dia; hora: string | null; titulo: string; pilar: Pilar | null; nota: string }) => Promise<ItemPauta | null>;
  mudarPauta: (p: ItemPauta, mudanca: Partial<Pick<ItemPauta, "dia" | "hora" | "titulo" | "pilar" | "nota">>) => void;
  apagarPauta: (p: ItemPauta) => void;
  criarComChefe: (p: ItemPauta) => void;
  confirmarMover: (a: AgendadoPendente, lugar: Lugar) => void;
  desistirDeMover: (a: AgendadoPendente) => void;
  /** Devolve o motivo da recusa, para a confirmação mostrar ao lado dos campos. */
  agendar: (post: PostPronto, midia: TipoMidia, publicaEm: number) => Promise<string | null>;
  cancelar: (a: ItemAgendado) => void;
}

/**
 * O popover do calendário, ancorado no item como o NSPopover do Mac: seta apontando para ele,
 * entra de 0,96 a 1 a partir da seta (estilo.css, .cal-popover) e sai só no fade. Esc fecha.
 * Fica montado durante a saída mostrando o último conteúdo.
 */
export function Bolha({ aberto, acoes }: { aberto: Aberto | null; acoes: AcoesDaBolha }) {
  const [mostrado, setMostrado] = useState(aberto);
  if (aberto && aberto !== mostrado) setMostrado(aberto);
  const atual = aberto ?? mostrado;
  const inicial = useRef<HTMLElement | null>(null);

  return (
    <Popover.Root open={aberto !== null} onOpenChange={(a) => !a && acoes.fechar()} onOpenChangeComplete={(a) => !a && setMostrado(null)}>
      <Popover.Portal>
        {atual && (
          <Popover.Positioner
            anchor={() => document.querySelector(ancoraDe(atual))}
            side="right"
            align="start"
            sideOffset={10}
            alignOffset={-8}
            collisionPadding={12}
            collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}
            className="z-50"
          >
            <Popover.Popup
              data-teclado="isolado"
              initialFocus={inicial}
              finalFocus={false}
              className="cal-popover w-[min(320px,calc(100vw-24px))] rounded-cartao border border-linha bg-superficie p-4 text-sm shadow-[0_12px_40px_rgb(15_13_10/0.14),0_1px_3px_rgb(15_13_10/0.08)] outline-none"
            >
              <Popover.Arrow className="cal-seta">
                <svg aria-hidden="true" width="16" height="8" viewBox="0 0 16 8">
                  <path d="M0 8 8 .5 16 8" fill="var(--color-superficie)" stroke="var(--color-linha-forte)" />
                </svg>
              </Popover.Arrow>
              <NoPopover.Provider value>
                <Conteudo key={chaveDoAberto(atual)} aberto={atual} acoes={acoes} inicial={inicial} />
              </NoPopover.Provider>
            </Popover.Popup>
          </Popover.Positioner>
        )}
      </Popover.Portal>
    </Popover.Root>
  );
}

const chaveDoAberto = (a: Aberto) =>
  a.tipo === "item" ? a.chave : a.tipo === "mover" ? `mover:${a.item.filaId}` : a.tipo === "agendar" ? `agendar:${a.post.postId}` : a.tipo === "dia" ? `dia:${a.dia}` : "nova";

function Conteudo({ aberto, acoes, inicial }: { aberto: Aberto; acoes: AcoesDaBolha; inicial: RefObject<HTMLElement | null> }) {
  const c = useCalendario();
  switch (aberto.tipo) {
    case "nova":
      return <EditorPauta lugar={aberto.lugar} acoes={acoes} inicial={inicial} />;
    case "mover":
      return <ConfirmarMover item={aberto.item} lugar={aberto.lugar} acoes={acoes} inicial={inicial} />;
    case "agendar":
      return <FormAgendar post={aberto.post} lugar={aberto.lugar} aoAgendar={acoes.agendar} aoCancelar={acoes.fechar} inicial={inicial} />;
    case "dia":
      return <ListaDoDia dia={aberto.dia} ancora={aberto.ancora} acoes={acoes} inicial={inicial} />;
    case "item": {
      const item = c.leitura.achar(aberto.chave);
      if (!item) return <p className="text-tinta-2">Este item saiu do calendário.</p>;
      if (item.tipo === "pauta") return <EditorPauta pauta={item} lugar={lugarDe(item)} acoes={acoes} inicial={inicial} />;
      if (item.tipo === "agendado") return <DetalheAgendado item={item} acoes={acoes} inicial={inicial} />;
      if (item.tipo === "publicado") return <DetalhePublicado item={item} inicial={inicial} />;
      return <DetalheData dia={item.dia} nome={item.nome} acoes={acoes} inicial={inicial} />;
    }
  }
}

const rotuloCampo = "text-xs font-medium text-tinta-2";
const campo =
  "h-9 w-full min-w-0 rounded-[10px] bg-superficie px-2.5 text-base text-tinta shadow-[inset_0_0_0_1px_var(--color-borda-campo)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-tinta)] sm:text-sm";
const botaoPrincipal = "pressiona inline-flex h-9 cursor-pointer items-center justify-center rounded-full bg-tinta px-4 font-medium text-sobre-tinta hover:bg-tinta/85";
const botaoSecundario = "pressiona inline-flex h-9 cursor-pointer items-center justify-center rounded-full px-3.5 font-medium text-tinta-2 hover:bg-hover hover:text-tinta";
const botaoPerigo = "pressiona inline-flex h-9 cursor-pointer items-center justify-center rounded-full px-3.5 font-medium text-erro hover:bg-erro/8";

/** Dentro do popover o título dá nome ao diálogo; na folha do celular o Dialog já tem o dele. */
const NoPopover = createContext(false);

function Titulo({ children }: { children: ReactNode }) {
  const classe = "text-[15px]/snug font-semibold text-pretty [overflow-wrap:anywhere]";
  return useContext(NoPopover) ? <Popover.Title className={classe}>{children}</Popover.Title> : <h3 className={classe}>{children}</h3>;
}

function Campos({ dia, hora, aoDia, aoHora, idBase, horaOpcional }: { dia: Dia; hora: string; aoDia: (d: Dia) => void; aoHora: (h: string) => void; idBase: string; horaOpcional?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_7.5rem] gap-2">
      <label htmlFor={`${idBase}-dia`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>Dia</span>
        <input id={`${idBase}-dia`} type="date" required value={dia} onChange={(e) => e.target.value && aoDia(e.target.value as Dia)} className={`${campo} tabular`} />
      </label>
      <label htmlFor={`${idBase}-hora`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>{horaOpcional ? "Hora (opcional)" : "Hora"}</span>
        <input id={`${idBase}-hora`} type="time" step={900} required={!horaOpcional} value={hora} onChange={(e) => aoHora(e.target.value)} className={`${campo} tabular`} />
      </label>
    </div>
  );
}

/** Pauta nova ou existente. Grava ao fechar, como o Calendário do Mac: Esc, clique fora ou Enter no título. */
function EditorPauta({ pauta, lugar, acoes, inicial }: { pauta?: ItemPauta; lugar: Lugar; acoes: AcoesDaBolha; inicial: RefObject<HTMLElement | null> }) {
  const id = useId();
  const [titulo, setTitulo] = useState(pauta?.titulo ?? "");
  const [dia, setDia] = useState<Dia>(lugar.dia);
  const [hora, setHora] = useState(lugar.minutos === null ? "" : textoDaHora(lugar.minutos));
  const [pilar, setPilar] = useState<Pilar | null>(pauta?.pilar ?? null);
  const [nota, setNota] = useState(pauta?.nota ?? "");
  const estado = useRef({ titulo, dia, hora, pilar, nota });
  estado.current = { titulo, dia, hora, pilar, nota };
  const feito = useRef(false);

  /** O que mudou, já no formato da API; título vazio não apaga o que havia. */
  function campos() {
    const s = estado.current;
    const horaValida = s.hora && minutosDaHora(s.hora) !== null ? s.hora : null;
    return { dia: s.dia, hora: horaValida, titulo: s.titulo.trim(), pilar: s.pilar, nota: s.nota.trim() };
  }

  function gravar() {
    if (feito.current) return;
    feito.current = true;
    const f = campos();
    if (!pauta) {
      if (f.titulo) void acoes.criarPauta(f);
      return;
    }
    const mudanca = Object.fromEntries(
      Object.entries({ ...f, titulo: f.titulo || pauta.titulo }).filter(([k, v]) => v !== pauta[k as keyof typeof f]),
    ) as Partial<typeof f>;
    if (Object.keys(mudanca).length) acoes.mudarPauta(pauta, mudanca);
  }

  useEffect(() => {
    acoes.aoFechar.current = gravar;
    return () => {
      if (acoes.aoFechar.current === gravar) acoes.aoFechar.current = null;
    };
  });

  async function comChefe() {
    feito.current = true;
    let alvo = pauta;
    const f = campos();
    if (!alvo) {
      if (!f.titulo) {
        feito.current = false;
        (inicial.current as HTMLInputElement | null)?.focus();
        return;
      }
      alvo = (await acoes.criarPauta(f)) ?? undefined;
    } else {
      feito.current = false;
      gravar();
    }
    acoes.aoFechar.current = null;
    acoes.fechar();
    if (alvo) acoes.criarComChefe(alvo);
  }

  return (
    <form
      onSubmit={(e) => (e.preventDefault(), acoes.fechar())}
      className="flex flex-col gap-3"
    >
      <Titulo>{pauta ? "Pauta" : "Nova pauta"}</Titulo>
      <label htmlFor={`${id}-titulo`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>Título</span>
        <input
          ref={inicial as RefObject<HTMLInputElement>}
          id={`${id}-titulo`}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Box de vidro entregue no Calhau"
          maxLength={200}
          autoComplete="off"
          className={campo}
        />
      </label>
      <Campos dia={dia} hora={hora} aoDia={setDia} aoHora={setHora} idBase={id} horaOpcional />
      <fieldset className="flex flex-col gap-1">
        <legend className={`${rotuloCampo} mb-1`}>Pilar</legend>
        <div className="flex flex-wrap gap-1.5">
          {[null, ...PILARES].map((p) => (
            <label key={p ?? "nenhum"} data-tom={p ?? "nenhum"} className="cal-chip">
              <input type="radio" name={`${id}-pilar`} checked={pilar === p} onChange={() => setPilar(p)} className="sr-only" />
              {p ? p.charAt(0) + p.slice(1).toLowerCase() : "Nenhum"}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${id}-nota`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>Nota</span>
        <textarea
          id={`${id}-nota`}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={3}
          maxLength={5000}
          className={`${campo} h-auto resize-none py-2 leading-snug`}
        />
      </label>
      <div className="flex items-center justify-between gap-2 pt-1">
        <button type="button" onClick={() => void comChefe()} className={botaoPrincipal}>
          {pauta?.conversaId ? "Abrir a conversa" : "Criar com o Chefe"}
        </button>
        {pauta ? (
          <button
            type="button"
            onClick={() => {
              feito.current = true;
              acoes.fechar();
              acoes.apagarPauta(pauta);
            }}
            className={botaoPerigo}
          >
            Apagar
          </button>
        ) : (
          <button type="submit" className={botaoSecundario}>
            Criar pauta
          </button>
        )}
      </div>
    </form>
  );
}

function Capa({ url, grande }: { url: string | null; grande?: boolean }) {
  if (!url) return null;
  return <img src={url} alt="" className={`flex-none rounded-[8px] object-cover outline outline-1 -outline-offset-1 outline-black/10 ${grande ? "h-20 w-16" : "h-10 w-8"}`} />;
}

function Cabecalho({ capa, titulo, linha }: { capa: string | null; titulo: string; linha: ReactNode }) {
  return (
    <div className="flex gap-3">
      <Capa url={capa} grande />
      <div className="flex min-w-0 flex-col gap-1">
        <Titulo>{titulo}</Titulo>
        <p className="text-[13px] text-tinta-2">{linha}</p>
      </div>
    </div>
  );
}

function DetalheAgendado({ item, acoes, inicial }: { item: ItemAgendado; acoes: AcoesDaBolha; inicial: RefObject<HTMLElement | null> }) {
  const quando = `${MIDIA[item.midia]} · ${momentoPorExtenso(item.publicaEm)}`;
  return (
    <div className="flex flex-col gap-3">
      <Cabecalho capa={item.capa} titulo={tituloDe(item)} linha={quando} />
      {item.status === "failed" ? (
        <>
          <div role="note" className="flex flex-col gap-1 rounded-[12px] bg-erro/6 p-3 text-erro">
            <span className="flex items-center gap-1.5 font-medium">
              <Alerta />A publicação falhou
            </span>
            <p className="line-clamp-6 text-[13px] text-tinta-2 [overflow-wrap:anywhere]">{item.erro ?? "O Instagram não disse o motivo."}</p>
          </div>
          <p className="text-[13px] text-pretty text-tinta-2">Para tentar de novo, agende o post outra vez pelos Prontos.</p>
          <div className="flex justify-end">
            <button ref={inicial as RefObject<HTMLButtonElement>} type="button" onClick={() => (acoes.fechar(), acoes.cancelar(item))} className={botaoSecundario}>
              Dispensar
            </button>
          </div>
        </>
      ) : item.status === "publishing" ? (
        <p className="flex items-center gap-1.5 text-tinta-2">
          <Relogio />
          Publicando agora.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-[13px] text-tinta-2">
            <Relogio />
            Agendado. Arraste no calendário para mudar o horário.
          </p>
          <div className="flex justify-end">
            <button ref={inicial as RefObject<HTMLButtonElement>} type="button" onClick={() => (acoes.fechar(), acoes.cancelar(item))} className={botaoPerigo}>
              Cancelar agendamento
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DetalhePublicado({ item, inicial }: { item: Extract<ItemCalendario, { tipo: "publicado" }>; inicial: RefObject<HTMLElement | null> }) {
  return (
    <div className="flex flex-col gap-3">
      <Cabecalho
        capa={item.capa}
        titulo={tituloDe(item)}
        linha={
          <span className="flex items-center gap-1.5">
            <Visto />
            Publicado · {MIDIA[item.midia]} · {momentoPorExtenso(item.publicadoEm)}
          </span>
        }
      />
      {item.link && (
        <a ref={inicial as RefObject<HTMLAnchorElement>} href={item.link} target="_blank" rel="noreferrer" className={`${botaoSecundario} self-end`}>
          Abrir no Instagram
        </a>
      )}
    </div>
  );
}

function DetalheData({ dia, nome, acoes, inicial }: { dia: Dia; nome: string; acoes: AcoesDaBolha; inicial: RefObject<HTMLElement | null> }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Titulo>{nome}</Titulo>
        <p className="text-[13px] text-tinta-2">{diaPorExtenso(dia)} · data do calendário editorial</p>
      </div>
      <button ref={inicial as RefObject<HTMLButtonElement>} type="button" onClick={() => acoes.abrir({ tipo: "nova", lugar: { dia, minutos: null } })} className={`${botaoSecundario} self-end`}>
        Criar pauta neste dia
      </button>
    </div>
  );
}

function ConfirmarMover({ item, lugar, acoes, inicial }: { item: AgendadoPendente; lugar: Lugar; acoes: AcoesDaBolha; inicial: RefObject<HTMLElement | null> }) {
  const novo = epochDe(lugar.dia, lugar.minutos ?? minutosDe(item.publicaEm));
  // Fechar sem escolher (Esc, clique fora) desiste e o item volta ao horário de antes.
  useEffect(() => {
    acoes.aoFechar.current = () => acoes.desistirDeMover(item);
    return () => void (acoes.aoFechar.current = null);
  });
  return (
    <div className="flex flex-col gap-3">
      <Titulo>Mover a publicação para {momentoPorExtenso(novo)}?</Titulo>
      <p className="text-[13px] text-pretty text-tinta-2 [overflow-wrap:anywhere]">
        Muda o horário em que {tituloDe(item)} sai no Instagram. Horário atual: {momentoPorExtenso(item.publicaEm)}.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={acoes.fechar} className={botaoSecundario}>
          Cancelar
        </button>
        <button
          ref={inicial as RefObject<HTMLButtonElement>}
          type="button"
          onClick={() => {
            acoes.aoFechar.current = null;
            acoes.fechar();
            acoes.confirmarMover(item, lugar);
          }}
          className={botaoPrincipal}
        >
          Mover
        </button>
      </div>
    </div>
  );
}

/** A confirmação de agendar um post pronto: dia, hora e mídia sempre à vista antes de gravar. */
export function FormAgendar({
  post,
  lugar,
  aoAgendar,
  aoCancelar,
  inicial,
}: {
  post: PostPronto;
  lugar: Lugar;
  aoAgendar: AcoesDaBolha["agendar"];
  aoCancelar: () => void;
  inicial?: RefObject<HTMLElement | null>;
}) {
  const c = useCalendario();
  const id = useId();
  const [dia, setDia] = useState<Dia>(lugar.dia);
  const [hora, setHora] = useState(textoDaHora(lugar.minutos ?? 18 * 60));
  const [midia, setMidia] = useState<TipoMidia>(post.midias[0] ?? "IMAGE");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const minutos = minutosDaHora(hora);
  const publicaEm = minutos === null ? null : epochDe(dia, minutos);
  const erroId = `${id}-erro`;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (publicaEm === null) return setErro("Escolha uma hora.");
    if (publicaEm <= Date.now()) return setErro(PASSADO);
    setErro(null);
    setEnviando(true);
    const falha = await aoAgendar(post, midia, publicaEm);
    setEnviando(false);
    if (falha) setErro(falha);
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      <Cabecalho capa={post.capa} titulo={tituloDoPost(post.headline, post.postId)} linha={`Pilar ${post.pilar.charAt(0) + post.pilar.slice(1).toLowerCase()}`} />
      <Campos dia={dia} hora={hora} aoDia={setDia} aoHora={setHora} idBase={id} />
      <fieldset className="flex flex-col gap-1">
        <legend className={`${rotuloCampo} mb-1`}>Mídia</legend>
        <div className="flex gap-1.5">
          {(["IMAGE", "STORIES"] as const).map((m) => {
            const pode = post.midias.includes(m);
            return (
              <label key={m} data-tom="nenhum" data-indisponivel={!pode || undefined} className="cal-chip">
                <input type="radio" name={`${id}-midia`} checked={midia === m} disabled={!pode} onChange={() => setMidia(m)} className="sr-only" />
                {MIDIA[m]}
              </label>
            );
          })}
        </div>
        {post.midias.length === 1 && <span className="text-xs text-tinta-3">Este post só tem peça de {MIDIA[post.midias[0]!].toLowerCase()}.</span>}
      </fieldset>
      <p aria-live="polite" className="text-[13px] text-pretty text-tinta-2 empty:hidden">
        {publicaEm !== null && `Vai para o ${MIDIA[midia]} · ${momentoPorExtenso(publicaEm, c.agora)}`}
      </p>
      <p id={erroId} role="alert" className="text-[13px] text-erro empty:hidden">
        {erro}
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={aoCancelar} className={botaoSecundario}>
          Cancelar
        </button>
        <button ref={inicial as RefObject<HTMLButtonElement>} type="submit" disabled={enviando} aria-describedby={erro ? erroId : undefined} className={botaoPrincipal}>
          {enviando ? "Agendando…" : "Agendar"}
        </button>
      </div>
    </form>
  );
}

function ListaDoDia({ dia, ancora, acoes, inicial }: { dia: Dia; ancora: string; acoes: AcoesDaBolha; inicial: RefObject<HTMLElement | null> }) {
  const c = useCalendario();
  const itens = c.leitura.porDia.get(dia) ?? [];
  return (
    <div className="flex flex-col gap-2">
      <Titulo>{diaPorExtenso(dia)}</Titulo>
      {itens.length === 0 ? (
        <p className="text-tinta-2">Nada marcado neste dia.</p>
      ) : (
        <ul className="-mx-2 flex max-h-[min(360px,50dvh)] flex-col overflow-y-auto overscroll-contain">
          {itens.map((i, n) => {
            const { minutos } = lugarDe(i);
            return (
              <li key={chaveDe(i)}>
                <button
                  ref={n === 0 ? (inicial as RefObject<HTMLButtonElement>) : undefined}
                  type="button"
                  aria-label={rotuloDe(i)}
                  onClick={() => acoes.abrir({ tipo: "item", chave: chaveDe(i), ancora })}
                  data-tom={i.tipo === "data" ? "data" : (i.tipo !== "publicado" && i.pilar) || "nenhum"}
                  className="cal-linha-lista realce flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 text-left hover:bg-hover"
                >
                  <span aria-hidden="true" className="cal-barra-lista" />
                  <span className="min-w-0 flex-1 truncate">{tituloDe(i)}</span>
                  <span className="flex-none text-xs text-tinta-3 tabular">{minutos === null ? "dia todo" : textoDaHora(minutos)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={() => acoes.abrir({ tipo: "nova", lugar: { dia, minutos: null } })} className={`${botaoSecundario} self-start`}>
        Nova pauta
      </button>
    </div>
  );
}
