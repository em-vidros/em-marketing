import { EditorEvent, EditorMoveEvent, EditorRotateEvent, EditorScaleEvent, InnerEditorEvent } from "@leafer-in/editor";
import "@leafer-in/text-editor";
import { App, type IUI } from "leafer-ui";
import { useEffect, useRef, useState, type RefObject } from "react";
import { FORMATOS, type Ajustes, type Camada, type Formato } from "../../../v2/camadas";
import { camadaDoNo, desenharCena, montar, sincronizar, type Montagem } from "./palco";
import { carregarFontes, carregarImagem } from "./recursos";

export interface PropsDaTela {
  formato: Formato;
  cena: string;
  camadas: Camada[];
  ajustes: Ajustes;
  selecionada: string | null;
  selecionar: (id: string | null) => void;
  mudar: (camada: Camada) => void;
}

interface Palco {
  app: App;
  montagem: Montagem;
}

const ESPERA_PARA_ESCREVER = 120;

const EDITOR = {
  stroke: "#2F646A",
  pointFill: "#FFFFFF",
  pointSize: 9,
  hover: true,
  hoverStyle: { stroke: "#63B5AF" },
  skewable: false,
  flipable: false,
  multipleSelect: false,
  rotateGap: 5,
};

export default function Tela(props: PropsDaTela) {
  const caixa = useRef<HTMLDivElement>(null);
  const atuais = useRef(props);
  atuais.current = props;

  const palco = usePalco(caixa, props.formato, atuais);
  const [imagem, setImagem] = useState<HTMLImageElement | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const { brilho, contraste, saturacao, desfoque, zoom, focoX, focoY } = props.ajustes;

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

  return (
    <div className="absolute inset-0">
      <div ref={caixa} className="absolute inset-0" />
      {(falha || !palco) && (
        <p role={falha ? "alert" : "status"} className="absolute inset-0 grid place-items-center bg-painel text-sm text-tinta-3">
          {falha ?? "Abrindo o editor…"}
        </p>
      )}
    </div>
  );
}

/** O palco só fica pronto depois das fontes, para o Leafer não medir o texto com a fonte de reserva. */
function usePalco(caixa: RefObject<HTMLDivElement | null>, formato: Formato, atuais: RefObject<PropsDaTela>) {
  const [palco, setPalco] = useState<Palco | null>(null);

  useEffect(() => {
    const view = caixa.current;
    if (!view) return;

    const app = new App({ view, editor: EDITOR });
    const montagem = montar(app.tree, formato);
    const desligar = [ligarEditor(app, montagem, atuais), encaixar(app, view, formato)];
    let viva = true;
    void carregarFontes().then(() => viva && setPalco({ app, montagem }));

    return () => {
      viva = false;
      for (const fn of desligar) fn();
      app.destroy();
      setPalco(null);
    };
  }, [caixa, formato, atuais]);

  return palco;
}

/** Um gesto solta dezenas de eventos; a camada só é escrita depois que eles param. */
function ligarEditor(app: App, montagem: Montagem, atuais: RefObject<PropsDaTela>) {
  const editor = app.editor;
  const mexidos = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

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
    if (!id) return;
    mexidos.add(id);
    clearTimeout(timer);
    timer = setTimeout(escrever, ESPERA_PARA_ESCREVER);
  }

  const aoMexer = () => marcar(editor.element);
  editor.on(EditorEvent.SELECT, () => atuais.current.selecionar(idDo(editor.element)));
  editor.on([EditorMoveEvent.MOVE, EditorScaleEvent.SCALE, EditorRotateEvent.ROTATE], aoMexer);
  editor.on(InnerEditorEvent.CLOSE, (e: InnerEditorEvent) => marcar(e.editTarget));

  return () => {
    clearTimeout(timer);
    escrever();
  };
}

/**
 * O Leafer ocupa o painel inteiro e a arte fica no meio, em px de 1080, com a raiz escalada para caber.
 * A folga em volta deixa as alças do editor ao alcance quando uma camada encosta na borda da arte.
 */
function encaixar(app: App, view: HTMLElement, formato: Formato) {
  const { largura, altura } = FORMATOS[formato];
  const FOLGA = 28;
  const observador = new ResizeObserver(() => {
    const escala = Math.min((view.clientWidth - 2 * FOLGA) / largura, (view.clientHeight - 2 * FOLGA) / altura);
    app.tree.set({ scale: escala, x: (view.clientWidth - largura * escala) / 2, y: (view.clientHeight - altura * escala) / 2 });
  });
  observador.observe(view);

  return () => observador.disconnect();
}
