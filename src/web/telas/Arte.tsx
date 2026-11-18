import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { FONTES, FORMATOS, linhasEstimadas, PROPORCAO_DO_LOGO, type Camada, type Fonte } from "../../v2/camadas";
import { apiArtes, useApi, type ArteDaApi } from "../api";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Falha } from "../componentes/Falha";
import { Segmentado } from "../componentes/Segmentado";
import { aoClicarLink } from "../rota";
import { tituloDa } from "./Artes";

/** As cores do brandbook (tokens.json, `color`), com o nome que o manual dá a cada uma. */
const PALETA = [
  { hex: "#2F646A", nome: "Teal profundo" },
  { hex: "#63B5AF", nome: "Teal claro" },
  { hex: "#414141", nome: "Grafite" },
  { hex: "#FFFFFF", nome: "Branco" },
  { hex: "#F0EFEA", nome: "Off-white" },
  { hex: "#E4E1D8", nome: "Areia" },
  { hex: "#D8D5CE", nome: "Linha" },
  { hex: "#8A8A8A", nome: "Cinza médio" },
];

const ESPERA_PARA_GRAVAR = 450;

const TIPO = { texto: "Texto", logo: "Logo", forma: "Faixa" } as const;
const REMOVIDO = { texto: "Texto removido.", logo: "Logo removido.", forma: "Faixa removida." } as const;

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
 * Grava as camadas depois de uma pausa na edição. Só a resposta do pedido mais novo vale.
 * `gravarAgora` espera o que estiver pendente ou em curso e devolve a arte gravada, ou null se falhou.
 */
function useGravacao(id: string, aoGravar: (arte: ArteDaApi) => void) {
  const [gravacao, setGravacao] = useState<Gravacao>({ tipo: "salvo" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendentes = useRef<Camada[] | null>(null);
  const emCurso = useRef<Promise<ArteDaApi | null> | null>(null);
  const ultimo = useRef(0);

  const gravarAgora = useCallback(async (): Promise<ArteDaApi | null> => {
    clearTimeout(timer.current);
    const camadas = pendentes.current;
    if (!camadas) return emCurso.current;
    pendentes.current = null;
    const pedido = ++ultimo.current;
    setGravacao({ tipo: "salvando" });
    const gravando = apiArtes.trocarCamadas(id, camadas).then(
      (gravada) => {
        if (pedido !== ultimo.current) return gravada;
        aoGravar(gravada);
        setGravacao({ tipo: "salvo" });
        return gravada;
      },
      (e: Error) => {
        if (pedido !== ultimo.current) return null;
        pendentes.current ??= camadas;
        setGravacao({ tipo: "erro", mensagem: e.message });
        return null;
      },
    );
    emCurso.current = gravando;
    return gravando;
  }, [id, aoGravar]);

  const agendar = useCallback(
    (camadas: Camada[]) => {
      pendentes.current = camadas;
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
  const [selecionada, setSelecionada] = useState<string | null>(inicial.camadas[0]?.id ?? null);
  const [removida, setRemovida] = useState<{ antes: Camada[]; camada: Camada } | null>(null);
  const [cena, setCena] = useState<{ tipo: "parada" } | { tipo: "gerando" } | { tipo: "erro"; mensagem: string }>({ tipo: "parada" });
  const { gravacao, agendar, gravarAgora } = useGravacao(arte.id, setArte);
  const camada = camadas.find((c) => c.id === selecionada) ?? null;
  const titulo = tituloDa({ ...arte, camadas });

  function mudarCamadas(novas: Camada[]) {
    setCamadas(novas);
    setRemovida(null);
    agendar(novas);
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
        <Preview arte={arte} camadas={camadas} selecionada={selecionada} selecionar={setSelecionada} gerando={cena.tipo === "gerando"} />
        <aside aria-label="Camadas" className="flex w-full flex-col gap-5 border-linha p-4 lg:w-[340px] lg:flex-none lg:overflow-y-auto lg:border-l">
          <ListaDeCamadas camadas={camadas} selecionada={selecionada} selecionar={setSelecionada} acrescentar={acrescentar} formato={arte.formato} />
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
            <p className="border-t border-linha pt-4 text-sm text-tinta-3">Clique numa camada da arte ou da lista para editar.</p>
          )}
        </aside>
      </div>
    </main>
  );
}

const alturaDa = (c: Camada) =>
  c.tipo === "forma" ? c.altura : c.tipo === "logo" ? c.largura * PROPORCAO_DO_LOGO : c.tamanho * c.entrelinha * linhasEstimadas(c.texto, c.fonte, c.tamanho, c.largura);

const descricaoDa = (c: Camada) => (c.tipo === "texto" ? c.texto : c.tipo === "logo" ? (c.variante === "cor" ? "Colorido" : "Branco") : c.cor);

function Preview(props: { arte: ArteDaApi; camadas: Camada[]; selecionada: string | null; selecionar: (id: string) => void; gerando: boolean }) {
  const { largura, altura } = FORMATOS[props.arte.formato];
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  return (
    <div className="flex min-h-[60dvh] flex-1 items-center justify-center bg-painel p-6 lg:min-h-0">
      <div
        className="relative w-full"
        style={{ aspectRatio: `${largura} / ${altura}`, maxWidth: `min(100%, calc((100dvh - 9rem) * ${largura / altura}))` }}
      >
        <img
          src={apiArtes.png(props.arte)}
          alt={`Arte: ${tituloDa(props.arte)}`}
          className={`absolute inset-0 size-full rounded-item shadow-[0_1px_3px_rgb(0_0_0/0.08)] transition-opacity duration-200 ${props.gerando ? "opacity-50" : ""}`}
        />
        {props.camadas.map((c) => (
          <button
            key={c.id}
            type="button"
            tabIndex={-1}
            aria-label={`Selecionar ${TIPO[c.tipo].toLowerCase()}: ${descricaoDa(c)}`}
            aria-pressed={c.id === props.selecionada}
            onClick={() => props.selecionar(c.id)}
            className="absolute cursor-pointer rounded-[3px] hover:shadow-[0_0_0_1px_#fff,0_0_0_2px_var(--color-tinta)] aria-pressed:shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--color-tinta)]"
            style={{ left: pct(c.x, largura), top: pct(c.y, altura), width: pct(c.largura, largura), height: pct(alturaDa(c), altura) }}
          />
        ))}
      </div>
    </div>
  );
}

function ListaDeCamadas(props: {
  camadas: Camada[];
  selecionada: string | null;
  selecionar: (id: string) => void;
  acrescentar: (c: Camada) => void;
  formato: ArteDaApi["formato"];
}) {
  const { largura, altura } = FORMATOS[props.formato];
  const novoId = () => crypto.randomUUID().slice(0, 8);
  const novoTexto = (): Camada => ({
    id: novoId(),
    tipo: "texto",
    texto: "Texto novo",
    fonte: "Poppins",
    peso: 500,
    tamanho: 40,
    entrelinha: 1.3,
    cor: "#414141",
    alinhamento: "esquerda",
    x: 80,
    y: Math.round(altura / 2),
    largura: largura - 160,
  });
  const novaFaixa = (): Camada => ({ id: novoId(), tipo: "forma", cor: "#2F646A", x: 0, y: altura - 320, largura, altura: 320, raio: 0 });
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <h2 className="mr-auto text-xs text-tinta-3">Camadas</h2>
        <button type="button" aria-label="Adicionar texto" onClick={() => props.acrescentar(novoTexto())} className={BOTAO_PEQUENO}>
          + Texto
        </button>
        <button type="button" aria-label="Adicionar faixa" onClick={() => props.acrescentar(novaFaixa())} className={BOTAO_PEQUENO}>
          + Faixa
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {[...props.camadas].reverse().map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-pressed={c.id === props.selecionada}
              onClick={() => props.selecionar(c.id)}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-item px-2.5 py-2 text-left text-sm hover:bg-hover aria-pressed:bg-ativo"
            >
              <span className="w-12 flex-none text-[11px] text-tinta-3">{TIPO[c.tipo]}</span>
              <span className="min-w-0 truncate">{descricaoDa(c)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const BOTAO_PEQUENO = "pressiona cursor-pointer rounded-full bg-linha px-3 py-1 text-[13px] font-medium hover:bg-linha-forte";

function Controles({ camada: c, mudar, remover }: { camada: Camada; mudar: (c: Camada) => void; remover: () => void }) {
  const posicao = (
    <div className="grid grid-cols-3 gap-2">
      <Numero rotulo="X" valor={c.x} min={-2000} max={4000} aoMudar={(x) => mudar({ ...c, x })} />
      <Numero rotulo="Y" valor={c.y} min={-2000} max={4000} aoMudar={(y) => mudar({ ...c, y })} />
      <Numero rotulo="Largura" valor={c.largura} min={20} max={4000} aoMudar={(largura) => mudar({ ...c, largura })} />
    </div>
  );
  return (
    <section aria-label={`Editar ${TIPO[c.tipo].toLowerCase()}`} className="flex flex-col gap-4 border-t border-linha pt-4">
      {c.tipo === "texto" && <ControlesDeTexto camada={c} mudar={mudar} />}
      {c.tipo === "logo" && (
        <Segmentado
          tipo="alternar"
          rotulo="Versão do logo"
          opcoes={[
            { valor: "cor", rotulo: "Colorido" },
            { valor: "branca", rotulo: "Branco" },
          ]}
          valor={c.variante}
          aoMudar={(variante) => mudar({ ...c, variante })}
        />
      )}
      {c.tipo === "forma" && <Cor valor={c.cor} aoMudar={(cor) => mudar({ ...c, cor })} />}
      {posicao}
      {c.tipo === "forma" && (
        <div className="grid grid-cols-2 gap-2">
          <Numero rotulo="Altura" valor={c.altura} min={1} max={4000} aoMudar={(altura) => mudar({ ...c, altura })} />
          <Numero rotulo="Arredondamento" valor={c.raio} min={0} max={12} aoMudar={(raio) => mudar({ ...c, raio })} />
        </div>
      )}
      <button type="button" onClick={remover} className="pressiona cursor-pointer self-start rounded-full px-3 py-1.5 text-[13px] font-medium text-erro hover:bg-hover">
        Remover {TIPO[c.tipo].toLowerCase()}
      </button>
    </section>
  );
}

function ControlesDeTexto({ camada: c, mudar }: { camada: Extract<Camada, { tipo: "texto" }>; mudar: (c: Camada) => void }) {
  return (
    <>
      <Campo rotulo="Texto">
        {(id) => (
          <textarea
            id={id}
            value={c.texto}
            rows={3}
            maxLength={400}
            onChange={(e) => mudar({ ...c, texto: e.target.value })}
            className="w-full resize-none rounded-item border border-borda-campo bg-transparent px-3 py-2 text-sm"
          />
        )}
      </Campo>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Campo rotulo="Fonte">
          {(id) => (
            <select
              id={id}
              value={c.fonte}
              onChange={(e) => {
                const fonte = e.target.value as Fonte;
                mudar({ ...c, fonte, peso: Number(Object.keys(FONTES[fonte])[0]) });
              }}
              className="w-full cursor-pointer rounded-item border border-borda-campo bg-transparent px-2.5 py-2 text-sm"
            >
              {Object.keys(FONTES).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          )}
        </Campo>
        <Campo rotulo="Peso">
          {(id) => (
            <select
              id={id}
              value={c.peso}
              onChange={(e) => mudar({ ...c, peso: Number(e.target.value) })}
              className="cursor-pointer rounded-item border border-borda-campo bg-transparent px-2.5 py-2 text-sm tabular"
            >
              {Object.keys(FONTES[c.fonte]).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          )}
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Numero rotulo="Tamanho" valor={c.tamanho} min={12} max={400} aoMudar={(tamanho) => mudar({ ...c, tamanho })} />
        <Numero rotulo="Entrelinha" valor={c.entrelinha} min={0.8} max={2.5} passo={0.05} aoMudar={(entrelinha) => mudar({ ...c, entrelinha })} />
      </div>
      <Cor valor={c.cor} aoMudar={(cor) => mudar({ ...c, cor })} />
      <Segmentado
        tipo="alternar"
        rotulo="Alinhamento"
        opcoes={[
          { valor: "esquerda", rotulo: "Esquerda" },
          { valor: "centro", rotulo: "Centro" },
          { valor: "direita", rotulo: "Direita" },
        ]}
        valor={c.alinhamento}
        aoMudar={(alinhamento) => mudar({ ...c, alinhamento })}
      />
    </>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-tinta-3">
        {rotulo}
      </label>
      {children(id)}
    </div>
  );
}

/** Campo numérico com rascunho: aceita digitar "1" a caminho de "150" e volta ao último valor válido ao sair. */
function Numero(props: { rotulo: string; valor: number; min: number; max: number; passo?: number; aoMudar: (v: number) => void }) {
  const [rascunho, setRascunho] = useState(String(props.valor));
  useEffect(() => setRascunho(String(props.valor)), [props.valor]);
  return (
    <Campo rotulo={props.rotulo}>
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={rascunho}
          min={props.min}
          max={props.max}
          step={props.passo ?? 1}
          onChange={(e) => {
            setRascunho(e.target.value);
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v) && v >= props.min && v <= props.max) props.aoMudar(props.passo ? v : Math.round(v));
          }}
          onBlur={() => setRascunho(String(props.valor))}
          className="w-full min-w-0 rounded-item border border-borda-campo bg-transparent px-2.5 py-2 text-sm tabular"
        />
      )}
    </Campo>
  );
}

function Cor({ valor, aoMudar }: { valor: string; aoMudar: (cor: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs text-tinta-3">Cor</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        {PALETA.map(({ hex, nome }) => (
          <button
            key={hex}
            type="button"
            title={nome}
            aria-label={nome}
            aria-pressed={valor.toUpperCase() === hex}
            onClick={() => aoMudar(hex)}
            className="size-7 cursor-pointer rounded-full outline-1 -outline-offset-1 outline-[rgb(0_0_0/0.18)] aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-tinta"
            style={{ backgroundColor: hex }}
          />
        ))}
        <label className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-tinta-2 hover:bg-hover">
          <input
            type="color"
            aria-label="Cor personalizada"
            value={valor.toLowerCase()}
            onChange={(e) => aoMudar(e.target.value.toUpperCase())}
            className="size-5 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          <span className="font-mono tabular">{valor.toUpperCase()}</span>
        </label>
      </div>
    </fieldset>
  );
}
