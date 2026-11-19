import { Redo02Icon, Undo02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { Edicao } from "../../v2/artes";
import { FORMATOS } from "../../v2/camadas";
import { apiArtes, ErroDeApi, useApi, type ArteDaApi } from "../api";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Falha } from "../componentes/Falha";
import { Dica } from "../componentes/menu/Teclas";
import { aoClicarLink } from "../rota";
import type { AtalhoId } from "../teclado/atalhos";
import { useAtalhosDoEditor } from "./arte/atalhosDoEditor";
import { BarraDeContexto } from "./arte/BarraDeContexto";
import { ControlesDaCena } from "./arte/ControlesDaCena";
import { PainelElementos, PainelTexto, PainelUploads } from "./arte/Insercao";
import { ListaDeCamadas } from "./arte/ListaDeCamadas";
import type { Caixa } from "./arte/operacoes";
import { PainelPosicao } from "./arte/PainelPosicao";
import type { ControleDaTela } from "./arte/Tela";
import { Gaveta, Trilho } from "./arte/Trilho";
import { useEditor, type Painel } from "./arte/useEditor";
import { tituloDa } from "./Artes";

// O Leafer só baixa quando uma arte abre.
const Tela = lazy(() =>
  import("./arte/Tela").then((modulo) => {
    guardar(() => sessionStorage.removeItem(CHAVE_DA_RECARGA));
    return modulo;
  }, recarregarUmaVez),
);

const CHAVE_DA_RECARGA = "arte:recarregou-por-chunk";

const guardar = (acao: () => void) => {
  try {
    acao();
  } catch {}
};

/**
 * Depois de um deploy, uma aba aberta antes dele pede um chunk que não existe mais. Recarregar uma vez traz o
 * index.html novo; se falhar de novo, o erro vai para o LimiteDeErro.
 */
function recarregarUmaVez(erro: unknown): never {
  let jaRecarregou = true;
  guardar(() => (jaRecarregou = sessionStorage.getItem(CHAVE_DA_RECARGA) === "1"));
  if (!jaRecarregou) {
    guardar(() => sessionStorage.setItem(CHAVE_DA_RECARGA, "1"));
    location.reload();
  }
  throw erro;
}

const ESPERA_PARA_GRAVAR = 450;

type Gravacao = { tipo: "salvo" } | { tipo: "pendente" } | { tipo: "salvando" } | { tipo: "erro"; mensagem: string } | { tipo: "conflito"; mensagem: string };

export function Arte({ id, abrirMenu }: { id: string; abrirMenu: () => void }) {
  const [carga, tentar] = useApi<ArteDaApi>(`/api/artes/${id}`);
  useEffect(() => {
    document.title = `${carga.estado === "pronto" ? tituloDa(carga.dados) : "Arte"} · EM Marketing`;
  }, [carga]);

  if (carga.estado === "pronto") return <Editor inicial={carga.dados} abrirMenu={abrirMenu} />;
  return (
    <main id="conteudo" className="flex-1 px-4 pt-3 sm:px-6 md:pt-10">
      <BotaoMenu abrir={abrirMenu} />
      {carga.estado === "carregando" ? (
        <p className="text-tinta-3">Carregando…</p>
      ) : (
        <Falha texto="Não deu para abrir a arte." erro={carga.erro} tentar={tentar} />
      )}
    </main>
  );
}

/**
 * Grava camadas e ajustes depois de uma pausa na edição. Uma gravação espera a anterior, porque cada
 * uma manda a versão que a anterior devolveu. Se outra pessoa gravou no meio, para e avisa em vez de sobrescrever.
 * `gravarAgora` espera o que estiver pendente ou em curso e devolve a arte gravada, ou null se falhou.
 */
function useGravacao(arte: ArteDaApi, aoGravar: (arte: ArteDaApi) => void) {
  const [gravacao, setGravacao] = useState<Gravacao>({ tipo: "salvo" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendente = useRef<Edicao | null>(null);
  const emCurso = useRef<Promise<ArteDaApi | null> | null>(null);
  const base = useRef(arte.atualizadaEm);
  base.current = arte.atualizadaEm;
  const travada = useRef(false);
  const { id } = arte;

  const gravarAgora = useCallback(async (): Promise<ArteDaApi | null> => {
    clearTimeout(timer.current);
    await emCurso.current;
    const edicao = pendente.current;
    if (!edicao || travada.current) return emCurso.current;
    pendente.current = null;
    setGravacao({ tipo: "salvando" });
    const gravando = apiArtes.gravar(id, edicao, base.current).then(
      (gravada) => {
        base.current = gravada.atualizadaEm;
        aoGravar(gravada);
        setGravacao(pendente.current ? { tipo: "pendente" } : { tipo: "salvo" });
        return gravada;
      },
      (e: Error) => {
        pendente.current ??= edicao;
        if (e instanceof ErroDeApi && e.status === 409) {
          travada.current = true;
          setGravacao({ tipo: "conflito", mensagem: e.message });
        } else setGravacao({ tipo: "erro", mensagem: e.message });
        return null;
      },
    );
    emCurso.current = gravando;
    return gravando;
  }, [id, aoGravar]);

  const agendar = useCallback(
    (edicao: Edicao) => {
      pendente.current = edicao;
      setGravacao({ tipo: "pendente" });
      clearTimeout(timer.current);
      timer.current = setTimeout(gravarAgora, ESPERA_PARA_GRAVAR);
    },
    [gravarAgora],
  );

  useEffect(() => () => void gravarAgora(), [gravarAgora]);
  return { gravacao, agendar, gravarAgora };
}

function Editor({ inicial, abrirMenu }: { inicial: ArteDaApi; abrirMenu: () => void }) {
  const [arte, setArte] = useState(inicial);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [cena, setCena] = useState<{ tipo: "parada" } | { tipo: "gerando" } | { tipo: "erro"; mensagem: string }>({ tipo: "parada" });
  const { gravacao, agendar, gravarAgora } = useGravacao(arte, setArte);
  const editor = useEditor({ inicial: { camadas: inicial.camadas, ajustes: inicial.ajustes }, formato: arte.formato, gravar: agendar });
  const tela = useRef<ControleDaTela>(null);
  const focarPalco = () => tela.current?.focar();
  const titulo = tituloDa({ ...arte, camadas: editor.camadas });
  useAtalhosDoEditor(editor, focarPalco);

  async function gerarNovaCena() {
    setCena({ tipo: "gerando" });
    await gravarAgora();
    try {
      setArte(await apiArtes.novaCena(arte.id));
      setCena({ tipo: "parada" });
    } catch (e) {
      setCena({ tipo: "erro", mensagem: (e as Error).message });
    }
  }

  /** O link já aponta para o PNG gravado. Com edição pendente, grava primeiro e baixa a versão nova. */
  async function baixar(e: MouseEvent<HTMLAnchorElement>) {
    if (gravacao.tipo === "salvo") return;
    e.preventDefault();
    const gravada = await gravarAgora();
    if (!gravada) return;
    const link = Object.assign(document.createElement("a"), { href: apiArtes.png(gravada), download: e.currentTarget.download });
    link.click();
  }

  return (
    <main id="conteudo" data-escopo="arte" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-linha px-4 py-3 sm:px-6">
        <BotaoMenu abrir={abrirMenu} />
        <nav aria-label="Caminho" className="flex items-center gap-1.5 text-sm">
          <a href="/artes" onClick={aoClicarLink} className="rounded-md px-1.5 py-1 text-tinta-3 hover:bg-hover hover:text-tinta">
            Artes
          </a>
          <span aria-hidden="true" className="text-tinta-4">
            /
          </span>
        </nav>
        <h1 title={titulo} className="min-w-0 max-w-[40ch] truncate text-sm font-medium">
          {titulo}
        </h1>
        <div className="ml-2 flex items-center gap-0.5">
          <BotaoDoHistorico rotulo="Desfazer" atalho="desfazer" icone={Undo02Icon} disabled={!editor.podeDesfazer} onClick={editor.desfazer} />
          <BotaoDoHistorico rotulo="Refazer" atalho="refazer" icone={Redo02Icon} disabled={!editor.podeRefazer} onClick={editor.refazer} />
        </div>
        <span aria-live="off" className={`mr-auto ml-1 text-[13px] text-tinta-3 ${gravacao.tipo === "erro" || gravacao.tipo === "conflito" ? "invisible" : ""}`}>
          {gravacao.tipo === "salvo" ? "Salvo" : "Salvando…"}
        </span>
        <button
          type="button"
          onClick={gerarNovaCena}
          disabled={cena.tipo === "gerando"}
          className="pressiona cursor-pointer rounded-full bg-linha px-4 py-2 text-sm font-medium hover:bg-linha-forte disabled:cursor-default disabled:opacity-50"
        >
          {cena.tipo === "gerando" ? "Gerando cena…" : "Nova cena"}
        </button>
        <a
          href={apiArtes.png(arte)}
          download={`arte-${arte.id.slice(0, 8)}.png`}
          onClick={baixar}
          className="pressiona rounded-full bg-tinta px-4 py-2 text-sm font-medium text-sobre-tinta"
        >
          Baixar PNG
        </a>
      </header>
      <div role="alert" className="empty:hidden flex flex-col gap-2 px-4 pt-3 sm:px-6">
        {gravacao.tipo === "erro" && <Falha texto="A última edição não foi salva." erro={gravacao.mensagem} tentar={() => void gravarAgora()} />}
        {gravacao.tipo === "conflito" && (
          <Falha texto="Suas últimas edições não foram salvas." erro={`${gravacao.mensagem} Recarregue para ver a versão dela.`} rotulo="Recarregar" tentar={() => location.reload()} />
        )}
        {cena.tipo === "erro" && <Falha texto="Não deu para gerar outra cena. A arte continua com a cena de antes." erro={cena.mensagem} />}
      </div>
      <p role="status" className="px-4 pt-3 text-[13px] text-tinta-3 empty:hidden sm:px-6">
        {cena.tipo === "gerando" ? "Gerando outra cena com o mesmo pedido. Leva uns 30 segundos, e as camadas ficam como estão." : ""}
      </p>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Trilho aberto={painel} abrir={setPainel} />
        {painel && (
          <Gaveta painel={painel} fechar={() => setPainel(null)}>
            <ConteudoDoPainel painel={painel} arte={arte} editor={editor} medir={(id) => tela.current?.medir(id) ?? null} />
          </Gaveta>
        )}
        <div className="flex min-h-[70dvh] min-w-0 flex-1 flex-col max-lg:order-1 lg:min-h-0">
          <BarraDeContexto
            camada={editor.camada}
            acoes={editor.acoes}
            cheia={editor.cheia}
            posicaoAberta={painel === "posicao"}
            alternarPosicao={() => setPainel((p) => (p === "posicao" ? null : "posicao"))}
            aoAgir={focarPalco}
          />
          <div className={`relative min-h-0 flex-1 bg-painel transition-opacity duration-200 ${cena.tipo === "gerando" ? "opacity-50" : ""}`}>
            <Suspense fallback={<Previa arte={arte} />}>
              <Tela
                ref={tela}
                arteId={arte.id}
                formato={arte.formato}
                cena={arte.cena}
                camadas={editor.camadas}
                ajustes={editor.ajustes}
                selecionada={editor.selecionada}
                selecionar={editor.selecionar}
                mudar={editor.acoes.mudar}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </main>
  );
}

function ConteudoDoPainel({ painel, arte, editor, medir }: { painel: Painel; arte: ArteDaApi; editor: ReturnType<typeof useEditor>; medir: (id: string) => Caixa | null }) {
  const insercao = { formato: arte.formato, camadas: editor.camadas, cheia: editor.cheia, acrescentar: editor.acoes.acrescentar };
  switch (painel) {
    case "elementos":
      return <PainelElementos {...insercao} />;
    case "texto":
      return <PainelTexto {...insercao} />;
    case "uploads":
      return <PainelUploads {...insercao} arteId={arte.id} />;
    case "camadas":
      return <ListaDeCamadas camadas={editor.camadas} selecionada={editor.selecionada} selecionar={editor.selecionar} reordenar={editor.acoes.reordenar} />;
    case "cena":
      return <ControlesDaCena ajustes={editor.ajustes} mudar={editor.acoes.mudarAjustes} />;
    case "posicao": {
      const indice = editor.camadas.findIndex((c) => c.id === editor.selecionada);
      return <PainelPosicao camada={editor.camada} acoes={editor.acoes} total={editor.camadas.length} indice={indice} medir={medir} />;
    }
  }
}

function BotaoDoHistorico({ rotulo, atalho, icone, ...resto }: { rotulo: string; atalho: AtalhoId; icone: IconSvgElement; disabled: boolean; onClick: () => void }) {
  return (
    <Dica rotulo={rotulo} atalho={atalho} lado="bottom">
      <button
        type="button"
        aria-label={rotulo}
        {...resto}
        className="pressiona grid size-9 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hover hover:text-tinta disabled:cursor-default disabled:text-tinta-4 disabled:hover:bg-transparent"
      >
        <HugeiconsIcon icon={icone} size={18} strokeWidth={1.6} />
      </button>
    </Dica>
  );
}

/** O PNG do servidor enquanto o editor carrega, no mesmo tamanho que a tela vai ter. */
function Previa({ arte }: { arte: ArteDaApi }) {
  const { largura, altura } = FORMATOS[arte.formato];
  return (
    <img
      src={apiArtes.png(arte)}
      alt={`Arte: ${tituloDa(arte)}`}
      className="max-h-full w-auto max-w-full"
      style={{ aspectRatio: `${largura} / ${altura}` }}
    />
  );
}
