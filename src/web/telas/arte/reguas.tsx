import { useEffect, useRef, useState, type PointerEvent as EventoDePonteiro } from "react";
import type { Caixa } from "./operacoes";

/** Onde a arte está no painel: o canto dela, em px da tela, e quantos px da tela vale um px da arte. */
export interface Vista {
  x: number;
  y: number;
  escala: number;
}

/** Uma guia é uma linha do editor, nunca da arte: uma vertical fica num x da arte, uma horizontal num y. */
export interface Guia {
  id: string;
  orientacao: "vertical" | "horizontal";
  posicao: number;
}

export const ESPESSURA_DA_REGUA = 20;

const CORES = {
  fundo: "#FFFFFF",
  foraDaArte: "#F5F3F2",
  borda: "rgba(15, 13, 10, 0.1)",
  traco: "#A3A3A3",
  numero: "#696969",
  selecao: "rgba(99, 181, 175, 0.28)",
  numeroDaSelecao: "#2F646A",
};

const PASSOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];

type Arraste = { tipo: "parado" } | { tipo: "arrastando"; id: string | null; orientacao: Guia["orientacao"]; posicao: number; sobreARegua: boolean; ponteiro: { x: number; y: number } };

/** As guias de uma arte ficam neste navegador, por arte. Sem localStorage, valem só enquanto a página está aberta. */
export function useGuias(arteId: string) {
  const chave = `em-marketing:guias:${arteId}`;
  const [guias, setGuias] = useState<Guia[]>(() => lerGuias(chave));
  const [visiveis, setVisiveis] = useState(() => lerArmazenado("em-marketing:reguas") !== "0");

  useEffect(() => gravarArmazenado(chave, JSON.stringify(guias)), [chave, guias]);
  useEffect(() => gravarArmazenado("em-marketing:reguas", visiveis ? "1" : "0"), [visiveis]);

  return { guias, setGuias, visiveis, alternar: () => setVisiveis((v) => !v) };
}

/**
 * As réguas de cima e da esquerda, em px da arte, e as guias por cima do palco. Arrastar de uma régua cria uma guia;
 * arrastar uma guia de volta para a régua apaga.
 */
export function Reguas(props: { vista: Vista; tamanho: { largura: number; altura: number }; selecao: Caixa | null; guias: Guia[]; mudarGuias: (guias: Guia[]) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const [arraste, setArraste] = useState<Arraste>({ tipo: "parado" });
  const { vista } = props;

  function seguir(e: EventoDePonteiro, id: string | null, orientacao: Guia["orientacao"]) {
    const caixa = area.current?.getBoundingClientRect();
    if (!caixa) return;

    const ponteiro = { x: e.clientX - caixa.left, y: e.clientY - caixa.top };
    const vertical = orientacao === "vertical";
    const posicao = Math.round(vertical ? (ponteiro.x - vista.x) / vista.escala : (ponteiro.y - vista.y) / vista.escala);
    const sobreARegua = (vertical ? ponteiro.x : ponteiro.y) < ESPESSURA_DA_REGUA;

    setArraste({ tipo: "arrastando", id, orientacao, posicao, sobreARegua, ponteiro });
  }

  function comecar(e: EventoDePonteiro<HTMLElement>, id: string | null, orientacao: Guia["orientacao"]) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    seguir(e, id, orientacao);
  }

  function soltar() {
    if (arraste.tipo !== "arrastando") return;
    const outras = props.guias.filter((g) => g.id !== arraste.id);
    const solta = { id: arraste.id ?? crypto.randomUUID().slice(0, 8), orientacao: arraste.orientacao, posicao: arraste.posicao };
    props.mudarGuias(arraste.sobreARegua ? outras : [...outras, solta]);
    setArraste({ tipo: "parado" });
  }

  const arrastando = arraste.tipo === "arrastando" ? arraste : null;
  const visiveis = arrastando ? [...props.guias.filter((g) => g.id !== arrastando.id), { id: "arrastando", orientacao: arrastando.orientacao, posicao: arrastando.posicao }] : props.guias;
  const ondeSoltar = { onPointerMove: (e: EventoDePonteiro) => arrastando && seguir(e, arrastando.id, arrastando.orientacao), onPointerUp: soltar, onPointerCancel: () => setArraste({ tipo: "parado" }) };

  return (
    <div ref={area} className="pointer-events-none absolute inset-0 overflow-hidden">
      {visiveis.map((g) => (
        <LinhaDaGuia key={g.id} guia={g} vista={vista} apagando={g.id === "arrastando" && !!arrastando?.sobreARegua} comecar={(e) => comecar(e, g.id === "arrastando" ? null : g.id, g.orientacao)} {...ondeSoltar} />
      ))}
      <Regua orientacao="horizontal" {...props} comecar={(e) => comecar(e, null, "horizontal")} {...ondeSoltar} />
      <Regua orientacao="vertical" {...props} comecar={(e) => comecar(e, null, "vertical")} {...ondeSoltar} />
      <div aria-hidden="true" className="absolute top-0 left-0 border-r border-b border-linha-forte bg-superficie" style={{ width: ESPESSURA_DA_REGUA, height: ESPESSURA_DA_REGUA }} />
      {arrastando && !arrastando.sobreARegua && (
        <output
          className="absolute rounded-md bg-tinta px-1.5 py-0.5 text-[11px] font-medium text-white tabular"
          style={{ left: arrastando.ponteiro.x + 12, top: arrastando.ponteiro.y + 12 }}
        >
          {arrastando.orientacao === "vertical" ? "X" : "Y"} {arrastando.posicao}
        </output>
      )}
    </div>
  );
}

type Arrastavel = {
  comecar: (e: EventoDePonteiro<HTMLElement>) => void;
  onPointerMove: (e: EventoDePonteiro) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
};

function LinhaDaGuia({ guia, vista, apagando, comecar, ...eventos }: { guia: Guia; vista: Vista; apagando: boolean } & Arrastavel) {
  const vertical = guia.orientacao === "vertical";
  const onde = (vertical ? vista.x : vista.y) + guia.posicao * vista.escala;
  const ALCANCE = 7;

  return (
    <div
      role="separator"
      aria-orientation={guia.orientacao}
      aria-label={`Guia em ${vertical ? "X" : "Y"} ${guia.posicao}`}
      onPointerDown={comecar}
      {...eventos}
      className={`pointer-events-auto absolute flex justify-center ${vertical ? "top-0 bottom-0 cursor-col-resize" : "right-0 left-0 cursor-row-resize flex-col"}`}
      style={vertical ? { left: onde - ALCANCE / 2, width: ALCANCE } : { top: onde - ALCANCE / 2, height: ALCANCE }}
    >
      <div
        className={`${vertical ? "h-full w-px" : "h-px w-full"} ${apagando ? "opacity-30" : ""}`}
        style={{ backgroundImage: `linear-gradient(${vertical ? "to bottom" : "to right"}, #2F646A 0 6px, transparent 6px 10px)`, backgroundSize: vertical ? "1px 10px" : "10px 1px" }}
      />
    </div>
  );
}

function Regua(props: { orientacao: Guia["orientacao"]; vista: Vista; tamanho: { largura: number; altura: number }; selecao: Caixa | null } & Arrastavel) {
  const tela = useRef<HTMLCanvasElement>(null);
  const horizontal = props.orientacao === "horizontal";
  const { vista, selecao, tamanho } = props;
  const [comprimento, setComprimento] = useState(0);

  useEffect(() => {
    const canvas = tela.current;
    if (!canvas) return;
    const observador = new ResizeObserver(() => setComprimento(horizontal ? canvas.clientWidth : canvas.clientHeight));
    observador.observe(canvas);

    return () => observador.disconnect();
  }, [horizontal]);

  useEffect(() => {
    const canvas = tela.current;
    if (!canvas || !comprimento) return;
    const faixa = selecao ? (horizontal ? [selecao.x, selecao.x + selecao.largura] : [selecao.y, selecao.y + selecao.altura]) : null;
    desenharRegua(canvas, {
      comprimento,
      inicio: horizontal ? vista.x : vista.y,
      escala: vista.escala,
      limite: horizontal ? tamanho.largura : tamanho.altura,
      faixa,
      horizontal,
    });
  }, [comprimento, horizontal, vista, selecao, tamanho]);

  return (
    <canvas
      ref={tela}
      aria-hidden="true"
      title={`Arraste para criar uma guia ${horizontal ? "horizontal" : "vertical"}`}
      onPointerDown={props.comecar}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      className={`pointer-events-auto absolute ${horizontal ? "top-0 right-0 cursor-row-resize" : "bottom-0 left-0 cursor-col-resize"}`}
      style={horizontal ? { left: 0, height: ESPESSURA_DA_REGUA, width: "100%" } : { top: 0, width: ESPESSURA_DA_REGUA, height: "100%" }}
    />
  );
}

interface Desenho {
  comprimento: number;
  inicio: number;
  escala: number;
  limite: number;
  faixa: number[] | null;
  horizontal: boolean;
}

/** Desenha a régua deitada; a vertical é a mesma régua girada, com os números lidos de baixo para cima. */
function desenharRegua(canvas: HTMLCanvasElement, { comprimento, inicio, escala, limite, faixa, horizontal }: Desenho) {
  const densidade = window.devicePixelRatio || 1;
  const R = ESPESSURA_DA_REGUA;
  canvas.width = (horizontal ? comprimento : R) * densidade;
  canvas.height = (horizontal ? R : comprimento) * densidade;

  const contexto = canvas.getContext("2d");
  if (!contexto) return;

  if (horizontal) contexto.setTransform(densidade, 0, 0, densidade, 0, 0);
  else contexto.setTransform(0, densidade, densidade, 0, 0, 0);
  const tela = (valor: number) => inicio + valor * escala;

  pintar(contexto, CORES.foraDaArte, [0, 0, comprimento, R]);
  pintar(contexto, CORES.fundo, [tela(0), 0, limite * escala, R]);
  if (faixa) pintar(contexto, CORES.selecao, [tela(faixa[0]!), 0, (faixa[1]! - faixa[0]!) * escala, R]);
  pintar(contexto, CORES.borda, [0, R - 1, comprimento, 1]);

  desenharTracos(contexto, { comprimento, inicio, escala, horizontal, faixa });
  if (faixa) for (const valor of faixa) escreverNumero(contexto, Math.round(valor), tela(valor), CORES.numeroDaSelecao, true, horizontal);
}

function pintar(contexto: CanvasRenderingContext2D, cor: string, [x, y, largura, altura]: [number, number, number, number]) {
  contexto.fillStyle = cor;
  contexto.fillRect(x, y, largura, altura);
}

function desenharTracos(contexto: CanvasRenderingContext2D, { comprimento, inicio, escala, horizontal, faixa }: Omit<Desenho, "limite">) {
  const R = ESPESSURA_DA_REGUA;
  const passo = PASSOS.find((p) => p * escala >= 56) ?? PASSOS.at(-1)!;
  const divisoes = passo % 5 === 0 ? 5 : 2;
  const menor = passo / divisoes;

  const primeiro = Math.floor(-inicio / escala / menor) * menor;
  const ultimo = (comprimento - inicio) / escala;

  contexto.fillStyle = CORES.traco;
  for (let valor = primeiro; valor <= ultimo; valor += menor) {
    const onde = Math.round(inicio + valor * escala) + 0.5;
    const principal = Math.abs(valor / passo - Math.round(valor / passo)) < 1e-6;
    contexto.fillRect(onde - 0.5, principal ? 0 : R - 5, 1, principal ? R : 4);

    const perto = faixa?.some((borda) => Math.abs(inicio + borda * escala - onde) < 34) ?? false;
    if (principal && !perto) escreverNumero(contexto, Math.round(valor), onde + 3, CORES.numero, false, horizontal);
  }
}

function escreverNumero(contexto: CanvasRenderingContext2D, valor: number, onde: number, cor: string, destaque: boolean, horizontal: boolean) {
  const texto = String(valor);
  contexto.save();
  contexto.font = `${destaque ? 600 : 400} 10px Inter, ui-sans-serif, system-ui, sans-serif`;
  contexto.textBaseline = "top";

  const largura = contexto.measureText(texto).width;
  const x = destaque ? onde - largura / 2 : onde;
  if (destaque) pintar(contexto, CORES.fundo, [x - 3, 2, largura + 6, 12]);
  contexto.fillStyle = cor;

  // A régua vertical é a deitada espelhada na diagonal; ali o texto volta a ser girado, para ler de baixo para cima.
  const densidade = window.devicePixelRatio || 1;
  if (!horizontal) contexto.setTransform(0, -densidade, densidade, 0, 3 * densidade, (x + largura) * densidade);
  contexto.fillText(texto, horizontal ? x : 0, horizontal ? 3 : 0);
  contexto.restore();
}

function lerGuias(chave: string): Guia[] {
  try {
    const lidas: unknown = JSON.parse(lerArmazenado(chave) ?? "[]");
    return Array.isArray(lidas) ? lidas.filter(ehGuia) : [];
  } catch {
    return [];
  }
}

function ehGuia(valor: unknown): valor is Guia {
  if (typeof valor !== "object" || valor === null) return false;
  const { id, orientacao, posicao } = valor as Record<string, unknown>;
  return typeof id === "string" && (orientacao === "vertical" || orientacao === "horizontal") && typeof posicao === "number";
}

function lerArmazenado(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravarArmazenado(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    // Sem armazenamento (janela privada, bloqueio): as guias valem só nesta visita.
  }
}
