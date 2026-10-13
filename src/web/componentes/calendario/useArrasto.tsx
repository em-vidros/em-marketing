import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent as PointerDoReact } from "react";
import type { PostPronto } from "../../../agent/fila";
import type { Agenda } from "./agenda";
import { PARADO, reduzir as transicao, type Arrasto, type Caixa, type Evento, type Fonte, type Ponto } from "./arrasto";
import { encaixarNoDia, numeroDoDia, semanaCurta, textoDaHora, type Dia } from "./datas";
import { PROVISORIO } from "./contexto";
import { chaveDe, DURACAO, lugarDe, mesmoLugar, tituloDoPost, type Lugar } from "./itens";

/** Post pronto solto num dia sem hora (mês, dia inteiro) sugere 18:00; a confirmação deixa trocar. */
export const HORA_PADRAO = 18 * 60;

/** Soltar herda a velocidade do ponteiro, com um quique leve porque o gesto teve impulso (apple-design). */
const MOLA_POSICAO = { type: "spring", bounce: 0.15, duration: 0.3 } as const;
/** Escala e sombra levantam e assentam sem quique. */
const MOLA_FORMA = { type: "spring", bounce: 0, duration: 0.25 } as const;
const FADE = { duration: 0.15, ease: "easeOut" } as const;

/** Perto da borda da grade, arrastar rola a grade. */
const BORDA_ROLAGEM = 48;

const ROTULO_PRONTO = { largura: 220, altura: 40, pegada: 14 };

interface Opcoes {
  agenda: Agenda;
  agora: () => number;
  /** Antes de assentar: o post pronto vira o bloco provisório onde a mola vai pousar. */
  preparar: (post: PostPronto, lugar: Lugar) => void;
  /** Depois de assentar: agendado e post pronto abrem a confirmação. */
  confirmar: (fonte: Fonte, lugar: Lugar) => void;
  recusar: (motivo: string, onde: DOMRect) => void;
}

function alvoEm(x: number, y: number, a: Extract<Arrasto, { fase: "pressionado" | "arrastando" }>): Lugar | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof HTMLElement) || !el.dataset.solta) continue;
    const dia = el.dataset.dia as Dia;
    if (el.dataset.solta === "horas") return { dia, minutos: encaixarNoDia(y - a.pegada.y - el.getBoundingClientRect().top) };
    if (a.fonte.tipo === "pronto") return { dia, minutos: HORA_PADRAO };
    const { item } = a.fonte;
    // Pauta solta na faixa de dia inteiro perde a hora; agendado não tem dia inteiro e mantém a dele.
    if (item.tipo === "pauta" && "diaInteiro" in el.dataset) return { dia, minutos: null };
    return { dia, minutos: lugarDe(item).minutos };
  }
  return null;
}

type Retangulo = { left: number; top: number; width: number; height: number };

/** Onde o item vai pousar, lido da grade sob o ponteiro antes do render que o põe lá. */
function caixaDoEncaixe(p: { x: number; y: number }, lugar: Lugar): Retangulo | null {
  const el = document.elementsFromPoint(p.x, p.y).find((e): e is HTMLElement => e instanceof HTMLElement && !!e.dataset.solta);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Os blocos se posicionam dentro da borda da coluna: soma a borda e desconta a sobra de 3px.
  if (el.dataset.solta === "horas" && lugar.minutos !== null)
    return { left: r.left + el.clientLeft + 1, top: r.top + el.clientTop + lugar.minutos, width: el.clientWidth - 3, height: DURACAO - 2 };
  return { left: r.left + 4, top: r.top + 28, width: r.width - 8, height: 18 };
}

const mesmaCaixa = (a: Retangulo, b: Retangulo) =>
  Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;

const proximoQuadro = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * O arrasto na tela: captura o ponteiro, segue 1:1 respeitando onde o item foi pego, levanta
 * o fantasma com escala 1,02 e sombra, e ao soltar assenta com uma mola que parte da
 * velocidade do ponteiro. O original fica esmaecido no lugar até o fantasma pousar no destino.
 */
export function useArrasto(o: Opcoes) {
  const reduzirMovimento = useReducedMotion();
  const estado = useRef<Arrasto>(PARADO);
  const [vista, setVista] = useState<Arrasto>(PARADO);
  const [assentando, setAssentando] = useState<string | null>(null);
  const opcoes = useRef(o);
  opcoes.current = o;
  const origem = useRef<HTMLElement | null>(null);
  const conteudo = useRef<HTMLDivElement>(null);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const limpar = useRef<() => void>(() => {});

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const largura = useMotionValue(0);
  const altura = useMotionValue(0);
  const escala = useMotionValue(1);
  const sombra = useMotionValue(0);
  const opacidade = useMotionValue(1);
  const boxShadow = useTransform(sombra, (s) => `0 8px 24px rgb(0 0 0 / ${(0.16 * s).toFixed(3)})`);

  function despachar(e: Evento): Arrasto {
    const antes = estado.current;
    const depois = transicao(antes, e);
    estado.current = depois;
    const mudouAlvo = antes.fase === "arrastando" && depois.fase === "arrastando" && !mesmoAlvo(antes.alvo, depois.alvo);
    if (antes.fase !== depois.fase || mudouAlvo) setVista(depois);
    return depois;
  }

  function levantar(a: Extract<Arrasto, { fase: "arrastando" }>) {
    largura.jump(a.caixa.largura);
    altura.jump(a.caixa.altura);
    escala.jump(1);
    sombra.jump(0);
    opacidade.jump(1);
    const caixa = conteudo.current;
    if (caixa && a.fonte.tipo === "item" && origem.current) {
      const copia = origem.current.cloneNode(true) as HTMLElement;
      for (const atributo of ["data-chave", "data-estado", "tabindex", "id", "style", "aria-label"]) copia.removeAttribute(atributo);
      caixa.replaceChildren(copia);
    }
    if (reduzirMovimento) {
      sombra.jump(1);
      return;
    }
    animate(escala, 1.02, MOLA_FORMA);
    animate(sombra, 1, MOLA_FORMA);
  }

  /** Sem `v`, a mola parte da velocidade que o valor já tem: é o redirecionamento no meio do caminho. */
  async function molaPara(r: Retangulo, v?: { x: number; y: number }) {
    if (reduzirMovimento) {
      await animate(opacidade, 0, FADE);
      return;
    }
    await Promise.all([
      animate(x, r.left, v ? { ...MOLA_POSICAO, velocity: v.x } : MOLA_POSICAO),
      animate(y, r.top, v ? { ...MOLA_POSICAO, velocity: v.y } : MOLA_POSICAO),
      animate(largura, r.width, MOLA_FORMA),
      animate(altura, r.height, MOLA_FORMA),
      animate(escala, 1, MOLA_FORMA),
      animate(sombra, 0, MOLA_FORMA),
    ]);
  }

  async function assentar(a: Extract<Arrasto, { fase: "soltando" }>) {
    const { soltura, fonte, velocidade } = a;
    const o = opcoes.current;
    if (soltura.tipo === "voltar") {
      const el = fonte.tipo === "item" ? document.querySelector(`[data-chave="${chaveDe(fonte.item)}"]`) : null;
      const r = el?.getBoundingClientRect() ?? new DOMRect(a.caixa.x, a.caixa.y, a.caixa.largura, a.caixa.altura);
      await molaPara(r, velocidade);
      if (soltura.motivo) o.recusar(soltura.motivo, r);
      terminar();
      return;
    }
    const destino = fonte.tipo === "item" ? chaveDe(fonte.item) : PROVISORIO;
    if (fonte.tipo === "pronto") o.preparar(fonte.post, soltura.lugar);
    else if (soltura.tipo === "mover") void o.agenda.mover(fonte.item, soltura.lugar);
    else o.agenda.prever(fonte.item, soltura.lugar);
    // A mola sai no mesmo quadro em que o ponteiro soltou, rumo ao encaixe calculado da grade;
    // depois do render ela é redirecionada para o elemento de verdade, sem perder a velocidade.
    const estimada = reduzirMovimento ? null : caixaDoEncaixe(a.ponto, soltura.lugar);
    const indo = estimada ? molaPara(estimada, velocidade) : null;
    setAssentando(destino);
    await proximoQuadro();
    const real = document.querySelector(`[data-chave="${destino}"]`)?.getBoundingClientRect();
    if (!real) await animate(opacidade, 0, FADE);
    else if (indo && estimada && mesmaCaixa(real, estimada)) await indo;
    else await molaPara(real, estimada ? undefined : velocidade);
    setAssentando(null);
    terminar();
    if (soltura.tipo === "confirmar") o.confirmar(fonte, soltura.lugar);
  }

  function terminar() {
    despachar({ tipo: "assentou" });
    conteudo.current?.replaceChildren();
    origem.current = null;
  }

  function rolarNaBorda() {
    const a = estado.current;
    const p = ultimo.current;
    if (a.fase !== "arrastando" || !p) return;
    const grade = document.querySelector<HTMLElement>(".cal-horas, .cal-mes");
    if (grade) {
      const r = grade.getBoundingClientRect();
      // Só rola com o ponteiro dentro da grade: vindo da coluna de prontos, ele passa por cima dela.
      const dentro = p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      const passo = !dentro ? 0 : p.y < r.top + BORDA_ROLAGEM ? p.y - r.top - BORDA_ROLAGEM : p.y > r.bottom - BORDA_ROLAGEM ? p.y - r.bottom + BORDA_ROLAGEM : 0;
      if (passo !== 0) {
        grade.scrollTop += passo / 4;
        despachar({ tipo: "mover", ponto: { ...p, t: performance.now() }, alvo: alvoEm(p.x, p.y, a) });
      }
    }
    requestAnimationFrame(rolarNaBorda);
  }

  function descer(e: PointerDoReact<HTMLElement>, fonte: Fonte) {
    if (e.button !== 0 || estado.current.fase !== "parado") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const pronto = fonte.tipo === "pronto";
    const pegada = pronto ? { x: ROTULO_PRONTO.pegada, y: ROTULO_PRONTO.pegada } : { x: e.clientX - r.left, y: e.clientY - r.top };
    const caixa: Caixa = pronto
      ? { x: e.clientX - pegada.x, y: e.clientY - pegada.y, largura: ROTULO_PRONTO.largura, altura: ROTULO_PRONTO.altura }
      : { x: r.left, y: r.top, largura: r.width, altura: r.height };
    origem.current = el;
    el.setPointerCapture(e.pointerId);
    despachar({ tipo: "descer", fonte, ponto: { x: e.clientX, y: e.clientY, t: e.timeStamp }, pegada, caixa });

    const aoMover = (ev: PointerEvent) => {
      const a = estado.current;
      if (a.fase !== "pressionado" && a.fase !== "arrastando") return;
      const ponto: Ponto = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
      ultimo.current = ponto;
      const depois = despachar({ tipo: "mover", ponto, alvo: alvoEm(ponto.x, ponto.y, a) });
      if (depois.fase !== "arrastando") return;
      if (a.fase === "pressionado") {
        levantar(depois);
        requestAnimationFrame(rolarNaBorda);
      }
      x.set(ponto.x - depois.pegada.x);
      y.set(ponto.y - depois.pegada.y);
    };
    const aoSoltar = (ev: PointerEvent) => {
      limpar.current();
      const depois = despachar({ tipo: "soltar", ponto: { x: ev.clientX, y: ev.clientY, t: ev.timeStamp }, agora: opcoes.current.agora() });
      if (depois.fase !== "soltando") return;
      // O clique que o navegador manda logo depois de soltar não pode abrir nem selecionar nada.
      const engolir = (c: MouseEvent) => (c.stopPropagation(), c.preventDefault());
      window.addEventListener("click", engolir, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", engolir, { capture: true }));
      void assentar(depois);
    };
    const aoCancelar = () => {
      limpar.current();
      const depois = despachar({ tipo: "cancelar" });
      if (depois.fase === "soltando") void assentar(depois);
    };
    const aoTeclar = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      aoCancelar();
    };
    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSoltar);
    window.addEventListener("pointercancel", aoCancelar);
    window.addEventListener("keydown", aoTeclar, { capture: true });
    limpar.current = () => {
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSoltar);
      window.removeEventListener("pointercancel", aoCancelar);
      window.removeEventListener("keydown", aoTeclar, { capture: true });
    };
  }

  useEffect(() => () => limpar.current(), []);

  const visivel = vista.fase === "arrastando" || vista.fase === "soltando";
  const alvo = vista.fase === "arrastando" ? vista.alvo : null;

  const fantasma = (
    <motion.div
      aria-hidden="true"
      className="cal-fantasma"
      data-visivel={visivel || undefined}
      style={{
        x,
        y,
        width: largura,
        height: altura,
        scale: escala,
        boxShadow,
        opacity: opacidade,
        transformOrigin: vista.fase === "parado" ? undefined : `${vista.pegada.x}px ${vista.pegada.y}px`,
      }}
    >
      {vista.fase !== "parado" && vista.fonte.tipo === "pronto" && <RotuloPronto post={vista.fonte.post} />}
      <div ref={conteudo} className="contents" />
      {alvo && <span className="cal-fantasma-hora tabular">{textoDoAlvo(alvo)}</span>}
    </motion.div>
  );

  return {
    descer,
    fantasma,
    alvo,
    assentando,
    arrastada: vista.fase === "arrastando" || vista.fase === "soltando" ? (vista.fonte.tipo === "item" ? chaveDe(vista.fonte.item) : null) : null,
  };
}

const mesmoAlvo = (a: Lugar | null, b: Lugar | null) => (a && b ? mesmoLugar(a, b) : a === b);

const textoDoAlvo = (l: Lugar) => `${semanaCurta(l.dia)} ${numeroDoDia(l.dia)}${l.minutos === null ? "" : `, ${textoDaHora(l.minutos)}`}`;

function RotuloPronto({ post }: { post: PostPronto }) {
  return (
    <div data-tom={post.pilar} className="cal-item cal-pronto-fantasma">
      <img src={post.capa} alt="" draggable={false} className="cal-capa" />
      <span className="min-w-0 flex-1 truncate font-semibold">{tituloDoPost(post.headline, post.postId)}</span>
    </div>
  );
}
