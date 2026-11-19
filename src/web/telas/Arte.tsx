import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { Edicao } from "../../v2/artes";
import { FORMATOS, type Ajustes, type Camada } from "../../v2/camadas";
import { apiArtes, useApi, type ArteDaApi } from "../api";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Falha } from "../componentes/Falha";
import { aoClicarLink } from "../rota";
import { Controles } from "./arte/Controles";
import { ControlesDaCena } from "./arte/ControlesDaCena";
import { ListaDeCamadas } from "./arte/ListaDeCamadas";
import { tituloDa } from "./Artes";

// O Leafer só baixa quando uma arte abre.
const Tela = lazy(() => import("./arte/Tela"));

const ESPERA_PARA_GRAVAR = 450;

const REMOVIDO = { texto: "Texto removido.", logo: "Logo removido.", imagem: "Imagem removida.", forma: "Faixa removida." } as const;

type Gravacao = { tipo: "salvo" } | { tipo: "pendente" } | { tipo: "salvando" } | { tipo: "erro"; mensagem: string };

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
 * Grava camadas e ajustes depois de uma pausa na edição. Só a resposta do pedido mais novo vale.
 * `gravarAgora` espera o que estiver pendente ou em curso e devolve a arte gravada, ou null se falhou.
 */
function useGravacao(id: string, aoGravar: (arte: ArteDaApi) => void) {
  const [gravacao, setGravacao] = useState<Gravacao>({ tipo: "salvo" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendente = useRef<Edicao | null>(null);
  const emCurso = useRef<Promise<ArteDaApi | null> | null>(null);
  const ultimo = useRef(0);

  const gravarAgora = useCallback(async (): Promise<ArteDaApi | null> => {
    clearTimeout(timer.current);
    const edicao = pendente.current;
    if (!edicao) return emCurso.current;
    pendente.current = null;
    const pedido = ++ultimo.current;
    setGravacao({ tipo: "salvando" });
    const gravando = apiArtes.gravar(id, edicao).then(
      (gravada) => {
        if (pedido !== ultimo.current) return gravada;
        aoGravar(gravada);
        setGravacao({ tipo: "salvo" });
        return gravada;
      },
      (e: Error) => {
        if (pedido !== ultimo.current) return null;
        pendente.current ??= edicao;
        setGravacao({ tipo: "erro", mensagem: e.message });
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
  const [camadas, setCamadas] = useState(inicial.camadas);
  const [ajustes, setAjustes] = useState(inicial.ajustes);
  const [selecionada, setSelecionada] = useState<string | null>(inicial.camadas[0]?.id ?? null);
  const [removida, setRemovida] = useState<{ antes: Camada[]; camada: Camada } | null>(null);
  const [cena, setCena] = useState<{ tipo: "parada" } | { tipo: "gerando" } | { tipo: "erro"; mensagem: string }>({ tipo: "parada" });
  const { gravacao, agendar, gravarAgora } = useGravacao(arte.id, setArte);
  const camada = camadas.find((c) => c.id === selecionada) ?? null;
  const titulo = tituloDa({ ...arte, camadas });

  function mudarCamadas(novas: Camada[]) {
    setCamadas(novas);
    setRemovida(null);
    agendar({ camadas: novas, ajustes });
  }
  function mudarAjustes(novos: Ajustes) {
    setAjustes(novos);
    agendar({ camadas, ajustes: novos });
  }
  const mudar = (nova: Camada) => mudarCamadas(camadas.map((c) => (c.id === nova.id ? nova : c)));
  function acrescentar(nova: Camada) {
    mudarCamadas(nova.tipo === "forma" ? [nova, ...camadas] : [...camadas, nova]);
    setSelecionada(nova.id);
  }
  function remover(alvo: Camada) {
    mudarCamadas(camadas.filter((c) => c.id !== alvo.id));
    setRemovida({ antes: camadas, camada: alvo });
    setSelecionada(null);
  }
  function desfazerRemocao() {
    if (!removida) return;
    mudarCamadas(removida.antes);
    setSelecionada(removida.camada.id);
  }

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
    <main id="conteudo" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
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
        <span aria-live="off" className={`mr-auto ml-2 text-[13px] text-tinta-3 ${gravacao.tipo === "erro" ? "invisible" : ""}`}>
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
        {cena.tipo === "erro" && <Falha texto="Não deu para gerar outra cena. A arte continua com a cena de antes." erro={cena.mensagem} />}
      </div>
      <p role="status" className="px-4 pt-3 text-[13px] text-tinta-3 empty:hidden sm:px-6">
        {cena.tipo === "gerando" ? "Gerando outra cena com o mesmo pedido. Leva uns 30 segundos, e as camadas ficam como estão." : ""}
      </p>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className={`relative flex min-h-[60dvh] min-w-0 flex-1 items-center justify-center bg-painel p-7 transition-opacity duration-200 lg:min-h-0 ${cena.tipo === "gerando" ? "opacity-50" : ""}`}>
            <Suspense fallback={<Previa arte={arte} />}>
              <Tela
                formato={arte.formato}
                cena={arte.cena}
                camadas={camadas}
                ajustes={ajustes}
                selecionada={selecionada}
                selecionar={setSelecionada}
                mudar={mudar}
              />
            </Suspense>
        </div>
        <aside aria-label="Camadas" className="flex w-full flex-col gap-5 border-linha p-4 lg:w-[340px] lg:flex-none lg:overflow-y-auto lg:border-l">
          <ListaDeCamadas arteId={arte.id} camadas={camadas} selecionada={selecionada} selecionar={setSelecionada} acrescentar={acrescentar} formato={arte.formato} />
          {camada ? (
            <Controles key={camada.id} camada={camada} mudar={mudar} remover={() => remover(camada)} />
          ) : removida ? (
            <div className="flex items-center gap-3 border-t border-linha pt-4 text-sm">
              <span className="mr-auto min-w-0 truncate">{REMOVIDO[removida.camada.tipo]}</span>
              <button
                type="button"
                autoFocus
                onClick={desfazerRemocao}
                className="pressiona cursor-pointer rounded-full bg-linha px-3 py-1.5 text-[13px] font-medium hover:bg-linha-forte"
              >
                Desfazer
              </button>
            </div>
          ) : (
            <p className="border-t border-linha pt-4 text-sm text-tinta-3">Clique numa camada da arte ou da lista para editar. Dois cliques num texto editam direto na arte.</p>
          )}
          <ControlesDaCena ajustes={ajustes} mudar={mudarAjustes} />
        </aside>
      </div>
    </main>
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
