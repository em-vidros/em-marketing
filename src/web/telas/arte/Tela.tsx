import { EditorEvent, EditorMoveEvent, EditorRotateEvent, EditorScaleEvent, InnerEditorEvent } from "@leafer-in/editor";
import "@leafer-in/text-editor";
import "@leafer-in/viewport";
import { App, MoveEvent, PointerEvent, RenderEvent, ZoomEvent, type IEditorConfig, type IUI } from "leafer-ui";
import { Snap } from "leafer-x-easy-snap";
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react";
import { FORMATOS, type Ajustes, type Camada, type Formato } from "../../../v2/camadas";
import { useAtalho } from "../../teclado/motor";
import { BarraDeZoom } from "./BarraDeZoom";
import type { Caixa } from "./operacoes";
import { camadaDoNo, desenharCena, montar, sincronizar, sincronizarGuias, type Montagem } from "./palco";
import { ESPESSURA_DA_REGUA, Reguas, useGuias, type Vista } from "./reguas";
import { carregarFontes, carregarImagem } from "./recursos";

export interface PropsDaTela {
  arteId: string;
  formato: Formato;
  cena: string;
  camadas: Camada[];
  ajustes: Ajustes;
  selecionada: string | null;
  selecionar: (id: string | null) => void;
  mudar: (camada: Camada) => void;
  ref?: Ref<ControleDaTela>;
}

/** O que o editor pede ao palco: a caixa medida de uma camada (a altura de um texto só existe depois das linhas). */
export interface ControleDaTela {
  medir: (id: string) => Caixa | null;
  focar: () => void;
}

interface Palco {
  app: App;
  montagem: Montagem;
  snap: Snap;
  view: HTMLElement;
}

const ACENTO = "#2F646A";

const SOMBRA_DA_ALCA = { x: 0, y: 1, blur: 3, color: "rgba(15, 13, 10, 0.28)" };

const ALCA = { fill: "#FFFFFF", stroke: "rgba(15, 13, 10, 0.16)", strokeWidth: 1, shadow: SOMBRA_DA_ALCA };

const ICONE_DE_GIRAR = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${ACENTO}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`,
)}`;

const EDITOR: IEditorConfig = {
  stroke: ACENTO,
  strokeWidth: 1.5,
  point: { ...ALCA, width: 13, height: 13, cornerRadius: 7 },
  middlePoint: { ...ALCA, width: 16, height: 6, cornerRadius: 3 },
  circle: { ...ALCA, fill: [{ type: "solid", color: "#FFFFFF" }, { type: "image", url: ICONE_DE_GIRAR, mode: "normal", align: "center" }], width: 22, height: 22, cornerRadius: 11 },
  circleDirection: "bottom",
  circleMargin: 18,
  hover: true,
  hoverStyle: { stroke: "#63B5AF", strokeWidth: 2 },
  keyEvent: false,
  skewable: false,
  flipable: false,
  multipleSelect: false,
  rotateGap: 5,
};

/** Distância, em px da tela, em que uma camada gruda numa borda, num centro ou numa guia. */
const ALCANCE_DO_IMA = 6;

const FOLGA = 48;

export default function Tela(props: PropsDaTela) {
  const caixa = useRef<HTMLDivElement>(null);
  const atuais = useRef(props);
  atuais.current = props;

  const palco = usePalco(caixa, props.formato, atuais);
  const { vista, selecao, encaixar, zoomPara } = useVista(palco, props.formato);
  const { guias, setGuias, visiveis, alternar } = useGuias(props.arteId);
  useAtalho("arte-reguas", alternar);

  const [imagem, setImagem] = useState<HTMLImageElement | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const { brilho, contraste, saturacao, desfoque, zoom, focoX, focoY } = props.ajustes;

  useImperativeHandle(props.ref, () => ({
    medir: (id) => {
      const no = palco?.montagem.nos.get(id);
      if (!no) return null;
      const { width, height } = no.getBounds("box", "inner");

      return { x: no.x ?? 0, y: no.y ?? 0, largura: width, altura: height };
    },
    focar: () => caixa.current?.focus({ preventScroll: true }),
  }));

  useEffect(() => {
    let viva = true;
    carregarImagem(props.cena).then(
      (carregada) => viva && setImagem(carregada),
      () => viva && setFalha("Não deu para carregar a cena."),
    );
    return () => void (viva = false);
  }, [props.cena]);

  useEffect(() => {
    if (palco && imagem) desenharCena(palco.montagem, imagem, atuais.current.ajustes);
  }, [palco, imagem, brilho, contraste, saturacao, desfoque, zoom, focoX, focoY]);

  useEffect(() => {
    if (!palco) return;
    sincronizar(palco.montagem, props.camadas);
    // A caixa de seleção guarda o tamanho do gesto; o texto que quebrou em outra linha muda a altura depois.
    if (palco.app.editor.element) palco.app.editor.update();
  }, [palco, props.camadas]);

  useEffect(() => {
    if (!palco) return;
    const no = props.selecionada ? palco.montagem.nos.get(props.selecionada) : undefined;
    if (no && palco.app.editor.element !== no) palco.app.editor.select(no);
    if (!no && palco.app.editor.element) palco.app.editor.cancel();
  }, [palco, props.selecionada, props.camadas]);

  useEffect(() => {
    if (palco) sincronizarGuias(palco.montagem, visiveis ? guias : []);
  }, [palco, guias, visiveis]);

  useEffect(() => palco?.snap.updateConfig({ snapSize: ALCANCE_DO_IMA / vista.escala }), [palco, vista.escala]);

  // O foco no palco liga as teclas do editor; não pode sair da edição de texto que o Leafer acabou de abrir.
  function focarSemRoubarTexto() {
    if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable) return;
    caixa.current?.focus({ preventScroll: true });
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden" onPointerDown={focarSemRoubarTexto}>
        <div ref={caixa} tabIndex={-1} aria-label="Arte" className="absolute inset-0 outline-none" />
        {palco && visiveis && <Reguas vista={vista} tamanho={FORMATOS[props.formato]} selecao={selecao} guias={guias} mudarGuias={setGuias} />}
        {(falha || !palco) && (
          <p role={falha ? "alert" : "status"} className="absolute inset-0 grid place-items-center bg-painel text-sm text-tinta-3">
            {falha ?? "Abrindo o editor…"}
          </p>
        )}
      </div>
      <BarraDeZoom escala={vista.escala} zoomPara={zoomPara} encaixar={encaixar} reguas={visiveis} alternarReguas={alternar} />
    </div>
  );
}

/** O palco só fica pronto depois das fontes, para o Leafer não medir o texto com a fonte de reserva. */
function usePalco(caixa: RefObject<HTMLDivElement | null>, formato: Formato, atuais: RefObject<PropsDaTela>) {
  const [palco, setPalco] = useState<Palco | null>(null);

  useEffect(() => {
    const view = caixa.current;
    if (!view) return;

    const app = new App({ view, tree: { type: "design" }, editor: EDITOR, zoom: { min: 0.05, max: 4 }, wheel: { zoomSpeed: 0.12 }, move: { holdSpaceKey: true } });
    const montagem = montar(app.tree, formato);
    const snap = new Snap(app, {
      parentContainer: montagem.quadro,
      attachEvents: ["move", "scale"],
      lineColor: "#E5399B",
      snapSize: ALCANCE_DO_IMA,
      distanceLabelStyle: { box: { fill: "#E5399B", cornerRadius: 4 }, text: { fill: "#FFFFFF", fontSize: 11, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 500, padding: [2, 5] } },
    });
    snap.enable(true);

    const desligar = [ligarEditor(app, montagem, atuais), desligarImaComTecla(snap)];
    let viva = true;
    void carregarFontes().then(() => viva && setPalco({ app, montagem, snap, view }));

    return () => {
      viva = false;
      for (const fn of desligar) fn();
      snap.enable(false);
      app.destroy();
      setPalco(null);
    };
  }, [caixa, formato, atuais]);

  return palco;
}

/**
 * Um gesto solta dezenas de eventos; a camada só é escrita quando o dedo sai, para o gesto inteiro virar um passo
 * do desfazer. A edição de texto na arte é escrita ao fechar.
 */
function ligarEditor(app: App, montagem: Montagem, atuais: RefObject<PropsDaTela>) {
  const editor = app.editor;
  const mexidos = new Set<string>();

  const idDo = (no: IUI | undefined) => [...montagem.nos].find(([, n]) => n === no)?.[0] ?? null;

  function escrever() {
    const { camadas, mudar } = atuais.current;
    for (const id of mexidos) {
      const camada = camadas.find((c) => c.id === id);
      const no = montagem.nos.get(id);
      if (camada && no) mudar(camadaDoNo(no, camada));
    }
    mexidos.clear();
  }

  function marcar(no: IUI | undefined) {
    const id = idDo(no);
    if (id) mexidos.add(id);
  }

  editor.on(EditorEvent.SELECT, () => {
    escrever();
    atuais.current.selecionar(idDo(editor.element));
  });
  editor.on([EditorMoveEvent.MOVE, EditorScaleEvent.SCALE, EditorRotateEvent.ROTATE], () => marcar(editor.element));
  app.on(PointerEvent.UP, escrever);
  editor.on(InnerEditorEvent.CLOSE, (e: InnerEditorEvent) => {
    marcar(e.editTarget);
    escrever();
  });

  return escrever;
}

/** Segurar ⌘ (Ctrl fora do Mac) enquanto arrasta solta a camada do ímã, como no Canva e no Figma. */
function desligarImaComTecla(snap: Snap) {
  const aoTeclar = (e: KeyboardEvent) => snap.enable(!(e.metaKey || e.ctrlKey));
  const religar = () => snap.enable(true);
  window.addEventListener("keydown", aoTeclar);
  window.addEventListener("keyup", aoTeclar);
  window.addEventListener("blur", religar);

  return () => {
    window.removeEventListener("keydown", aoTeclar);
    window.removeEventListener("keyup", aoTeclar);
    window.removeEventListener("blur", religar);
  };
}

/**
 * Onde a arte está no painel e o zoom. Abre encaixada, com folga para as alças e as réguas; enquanto ninguém
 * mexe no zoom, ela se reencaixa quando o painel muda de tamanho.
 */
function useVista(palco: Palco | null, formato: Formato) {
  const [vista, setVista] = useState<Vista>({ x: 0, y: 0, escala: 1 });
  const [selecao, setSelecao] = useState<Caixa | null>(null);
  const encaixada = useRef(true);

  function encaixar() {
    if (!palco) return;

    const { largura, altura } = FORMATOS[formato];
    const { clientWidth, clientHeight } = palco.view;
    const escala = Math.min((clientWidth - 2 * FOLGA - ESPESSURA_DA_REGUA) / largura, (clientHeight - 2 * FOLGA - ESPESSURA_DA_REGUA) / altura);
    const x = ESPESSURA_DA_REGUA + (clientWidth - ESPESSURA_DA_REGUA - largura * escala) / 2;
    const y = ESPESSURA_DA_REGUA + (clientHeight - ESPESSURA_DA_REGUA - altura * escala) / 2;

    palco.app.tree.set({ scale: escala, x, y });
    encaixada.current = true;
  }

  function zoomPara(escala: number) {
    if (!palco) return;

    const { app, view } = palco;
    const antiga = app.tree.scaleX ?? 1;
    const centro = { x: view.clientWidth / 2, y: view.clientHeight / 2 };
    const pontoDaArte = { x: (centro.x - (app.tree.x ?? 0)) / antiga, y: (centro.y - (app.tree.y ?? 0)) / antiga };

    app.tree.set({ scale: escala, x: centro.x - pontoDaArte.x * escala, y: centro.y - pontoDaArte.y * escala });
    encaixada.current = false;
  }

  const encaixarAtual = useRef(encaixar);
  encaixarAtual.current = encaixar;

  useEffect(() => {
    if (!palco) return;
    const { app, montagem, view } = palco;
    let quadro = 0;

    function ler() {
      quadro = 0;
      const lida = { x: app.tree.x ?? 0, y: app.tree.y ?? 0, escala: app.tree.scaleX ?? 1 };
      setVista((v) => (v.x === lida.x && v.y === lida.y && v.escala === lida.escala ? v : lida));

      const elemento = app.editor.element;
      const limites = elemento ? elemento.getBounds("box", montagem.quadro) : null;
      setSelecao((s) => (mesmaCaixa(s, limites) ? s : limites && { x: limites.x, y: limites.y, largura: limites.width, altura: limites.height }));
    }
    const agendar = () => (quadro ||= requestAnimationFrame(ler));
    const soltar = () => void (encaixada.current = false);

    encaixarAtual.current();
    const observador = new ResizeObserver(() => encaixada.current && encaixarAtual.current());
    observador.observe(view);

    app.tree.on(RenderEvent.END, agendar);
    app.sky.on(RenderEvent.END, agendar);
    app.tree.on([ZoomEvent.ZOOM, MoveEvent.MOVE], soltar);

    return () => {
      cancelAnimationFrame(quadro);
      observador.disconnect();
      app.tree.off(RenderEvent.END, agendar);
      app.sky.off(RenderEvent.END, agendar);
      app.tree.off([ZoomEvent.ZOOM, MoveEvent.MOVE], soltar);
    };
  }, [palco]);

  return { vista, selecao, encaixar, zoomPara };
}

function mesmaCaixa(caixa: Caixa | null, limites: { x: number; y: number; width: number; height: number } | null) {
  if (!caixa || !limites) return caixa === limites;
  return caixa.x === limites.x && caixa.y === limites.y && caixa.largura === limites.width && caixa.altura === limites.height;
}
