import { ArrowDown01Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Popover } from "@base-ui/react/popover";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CATEGORIAS, FAMILIAS_DA_MARCA, type Categoria, type FamiliaDoCatalogo } from "../../../v2/fontes";
import { pegar } from "../../api";
import { carregarPrevia, familiaDaPrevia } from "./recursos";

type Linha = { tipo: "titulo"; rotulo: string } | { tipo: "familia"; familia: FamiliaDoCatalogo };
type Filtro = Categoria | "todas";

const ALTURA_DA_LINHA = 36;
const ALTURA_DA_LISTA = 320;
const LINHAS_DE_FOLGA = 6;
const MAXIMO_DE_RECENTES = 6;
const ESPERA_DA_PREVIA = 120;
const CHAVE_DAS_RECENTES = "arte:fontes-recentes";

const MARCA = new Set(FAMILIAS_DA_MARCA.map((f) => f.familia));

let catalogo: Promise<FamiliaDoCatalogo[]> | null = null;

/** O catálogo vem uma vez por sessão. Sem ele, o editor segue só com as fontes da marca e tenta de novo na próxima tela. */
export function useCatalogoDeFontes(): FamiliaDoCatalogo[] {
  const [familias, setFamilias] = useState(FAMILIAS_DA_MARCA);

  useEffect(() => {
    let viva = true;
    catalogo ??= pegar<FamiliaDoCatalogo[]>("/api/fontes").catch(() => {
      catalogo = null;
      return FAMILIAS_DA_MARCA;
    });
    void catalogo.then((carregadas) => viva && setFamilias(carregadas));

    return () => {
      viva = false;
    };
  }, []);

  return familias;
}

export function SeletorDeFonte(props: { familia: string; catalogo: FamiliaDoCatalogo[]; carregando: boolean; aoEscolher: (familia: FamiliaDoCatalogo) => void }) {
  const [aberto, setAberto] = useState(false);

  const escolher = (familia: FamiliaDoCatalogo) => {
    setAberto(false);
    guardarRecente(familia.familia);
    props.aoEscolher(familia);
  };

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger
        aria-label={`Fonte ${props.familia}`}
        aria-busy={props.carregando}
        className="pressiona flex h-9 w-44 flex-none cursor-pointer items-center gap-2 rounded-lg border border-linha-forte px-2.5 text-sm hover:bg-hover data-[popup-open]:bg-ativo"
      >
        <span className="min-w-0 flex-1 truncate text-left" style={{ fontFamily: `"${props.familia}", var(--font-sans)` }}>
          {props.carregando ? "Carregando…" : props.familia}
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.8} className="flex-none text-tinta-3" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} className="z-50">
          <Popover.Popup
            aria-label="Escolher fonte"
            className="w-[22rem] origin-(--transform-origin) rounded-cartao border border-linha bg-superficie p-3 shadow-[0_12px_32px_rgb(15_13_10/0.12)] outline-none transition-[opacity,scale] duration-150 ease-(--ease-saida) data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
          >
            <Lista atual={props.familia} catalogo={props.catalogo} aoEscolher={escolher} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Lista({ atual, catalogo, aoEscolher }: { atual: string; catalogo: FamiliaDoCatalogo[]; aoEscolher: (familia: FamiliaDoCatalogo) => void }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [rolagem, setRolagem] = useState(0);
  const [ativa, setAtiva] = useState(0);

  const lista = useRef<HTMLDivElement>(null);
  const idDaLista = useId();

  const linhas = useMemo(() => linhasDoSeletor({ catalogo, recentes: lerRecentes(), busca, filtro }), [catalogo, busca, filtro]);
  const primeira = Math.max(0, Math.floor(rolagem / ALTURA_DA_LINHA) - LINHAS_DE_FOLGA);
  const visiveis = linhas.slice(primeira, primeira + Math.ceil(ALTURA_DA_LISTA / ALTURA_DA_LINHA) + 2 * LINHAS_DE_FOLGA);

  const linhasAoAbrir = useRef(linhas);
  useLayoutEffect(() => {
    const indiceDaAtual = linhas === linhasAoAbrir.current ? linhas.findIndex((l) => l.tipo === "familia" && l.familia.familia === atual) : -1;
    if (indiceDaAtual < 0) {
      setAtiva(proximaFamilia(linhas, -1, 1));
      lista.current?.scrollTo({ top: 0 });
      return;
    }

    setAtiva(indiceDaAtual);
    lista.current?.scrollTo({ top: Math.max(0, indiceDaAtual * ALTURA_DA_LINHA - (ALTURA_DA_LISTA - ALTURA_DA_LINHA) / 2) });
  }, [linhas, atual]);

  function mover(indice: number) {
    setAtiva(indice);
    const caixa = lista.current;
    if (!caixa) return;

    const topo = indice * ALTURA_DA_LINHA;
    if (topo < caixa.scrollTop) caixa.scrollTop = topo;
    else if (topo + ALTURA_DA_LINHA > caixa.scrollTop + ALTURA_DA_LISTA) caixa.scrollTop = topo + ALTURA_DA_LINHA - ALTURA_DA_LISTA;
  }

  function teclar(e: KeyboardEvent) {
    const linha = linhas[ativa];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      mover(proximaFamilia(linhas, ativa, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && linha?.tipo === "familia") {
      e.preventDefault();
      aoEscolher(linha.familia);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex h-9 items-center gap-2 rounded-lg border border-borda-campo px-2.5 focus-within:border-tinta">
        <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.6} className="flex-none text-tinta-3" />
        <span className="sr-only">Buscar fonte</span>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={idDaLista}
          aria-activedescendant={linhas[ativa]?.tipo === "familia" ? `${idDaLista}-${ativa}` : undefined}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={teclar}
          placeholder={`Buscar em ${catalogo.length} fontes`}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-tinta-4"
        />
      </label>
      <div role="group" aria-label="Categoria" className="flex flex-wrap gap-1">
        {(["todas", ...Object.keys(CATEGORIAS)] as Filtro[]).map((valor) => (
          <button
            key={valor}
            type="button"
            aria-pressed={filtro === valor}
            onClick={() => setFiltro(valor)}
            className="pressiona h-7 cursor-pointer rounded-full border border-linha-forte px-2.5 text-xs text-tinta-2 hover:bg-hover aria-pressed:border-tinta aria-pressed:bg-tinta aria-pressed:text-sobre-tinta"
          >
            {valor === "todas" ? "Todas" : CATEGORIAS[valor]}
          </button>
        ))}
      </div>
      <div ref={lista} id={idDaLista} role="listbox" aria-label="Fontes" onScroll={(e) => setRolagem(e.currentTarget.scrollTop)} className="-mx-1 overflow-y-auto" style={{ height: ALTURA_DA_LISTA }}>
        {linhas.length === 0 && <p className="px-2 py-6 text-center text-sm text-tinta-3">Nenhuma fonte com esse nome.</p>}
        <div className="relative" style={{ height: linhas.length * ALTURA_DA_LINHA }}>
          {visiveis.map((linha, i) => {
            const indice = primeira + i;
            const topo = { top: indice * ALTURA_DA_LINHA, height: ALTURA_DA_LINHA };
            if (linha.tipo === "titulo") {
              return (
                <p key={`titulo-${linha.rotulo}`} role="presentation" className="absolute inset-x-0 flex items-end px-2 pb-1.5 text-xs text-tinta-3" style={topo}>
                  {linha.rotulo}
                </p>
              );
            }

            return (
              <LinhaDeFonte
                key={`${indice}-${linha.familia.familia}`}
                id={`${idDaLista}-${indice}`}
                familia={linha.familia}
                escolhida={linha.familia.familia === atual}
                ativa={indice === ativa}
                estilo={topo}
                aoPassar={() => setAtiva(indice)}
                aoEscolher={() => aoEscolher(linha.familia)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LinhaDeFonte(props: { id: string; familia: FamiliaDoCatalogo; escolhida: boolean; ativa: boolean; estilo: { top: number; height: number }; aoPassar: () => void; aoEscolher: () => void }) {
  const { familia } = props.familia;
  const daMarca = MARCA.has(familia);

  useEffect(() => {
    if (daMarca) return;
    const timer = setTimeout(() => void carregarPrevia(props.familia).catch(() => undefined), ESPERA_DA_PREVIA);

    return () => clearTimeout(timer);
  }, [daMarca, props.familia]);

  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.escolhida}
      onPointerEnter={props.aoPassar}
      onClick={props.aoEscolher}
      className={`absolute inset-x-0 flex cursor-pointer items-center gap-2 rounded-lg px-2 text-[15px] ${props.ativa ? "bg-hover" : ""}`}
      style={props.estilo}
    >
      <span className="min-w-0 flex-1 truncate" style={{ fontFamily: `"${daMarca ? familia : familiaDaPrevia(familia)}", var(--font-sans)` }}>
        {familia}
      </span>
      {props.escolhida && <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={1.8} className="flex-none text-tinta" />}
    </div>
  );
}

/** Sem busca nem categoria: marca, recentes e o catálogo todo. Com qualquer um dos dois, só o que casa, com os nomes que começam pelo termo na frente. */
function linhasDoSeletor({ catalogo, recentes, busca, filtro }: { catalogo: FamiliaDoCatalogo[]; recentes: string[]; busca: string; filtro: Filtro }): Linha[] {
  const termo = busca.trim().toLowerCase();
  const comoLinha = (familia: FamiliaDoCatalogo): Linha => ({ tipo: "familia", familia });
  if (termo || filtro !== "todas") {
    const achadas = catalogo.filter((f) => (filtro === "todas" || f.categoria === filtro) && f.familia.toLowerCase().includes(termo));
    const comecaCom = (f: FamiliaDoCatalogo) => (f.familia.toLowerCase().startsWith(termo) ? 0 : 1);

    return achadas.sort((a, b) => comecaCom(a) - comecaCom(b)).map(comoLinha);
  }

  const porNome = new Map(catalogo.map((f) => [f.familia, f]));
  const daMarca = FAMILIAS_DA_MARCA.map((f) => porNome.get(f.familia) ?? f);
  const usadas = recentes.flatMap((nome) => {
    const familia = porNome.get(nome);
    return familia && !MARCA.has(nome) ? [familia] : [];
  });

  return [
    { tipo: "titulo", rotulo: "Fontes da marca" },
    ...daMarca.map(comoLinha),
    ...(usadas.length > 0 ? [{ tipo: "titulo", rotulo: "Usadas recentemente" } as const, ...usadas.map(comoLinha)] : []),
    { tipo: "titulo", rotulo: "Todas as fontes" },
    ...catalogo.map(comoLinha),
  ];
}

/** A próxima linha de família a partir de `de`, pulando os títulos. Sem nenhuma na direção, fica onde está. */
function proximaFamilia(linhas: Linha[], de: number, passo: 1 | -1): number {
  for (let i = de + passo; i >= 0 && i < linhas.length; i += passo) if (linhas[i]?.tipo === "familia") return i;

  return Math.max(0, de);
}

function lerRecentes(): string[] {
  try {
    const guardadas: unknown = JSON.parse(localStorage.getItem(CHAVE_DAS_RECENTES) ?? "[]");
    return Array.isArray(guardadas) ? guardadas.filter((nome): nome is string => typeof nome === "string") : [];
  } catch {
    return [];
  }
}

function guardarRecente(familia: string) {
  try {
    localStorage.setItem(CHAVE_DAS_RECENTES, JSON.stringify([familia, ...lerRecentes().filter((nome) => nome !== familia)].slice(0, MAXIMO_DE_RECENTES)));
  } catch {
    // Sem localStorage, como numa aba privada, a lista de recentes só não aparece.
  }
}
