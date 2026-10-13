import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import type { Peca, Pilar, StatusPost } from "../../db";
import { useApi } from "../api";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Capa } from "../componentes/Capa";
import { Falha } from "../componentes/Falha";
import { PainelLateral } from "../componentes/PainelLateral";
import { Check } from "../componentes/Passos";
import { Troca } from "../componentes/Troca";
import { dia, FORMATO, PILARES, STATUS_POST } from "../componentes/peca";
import { Segmentado } from "../componentes/Segmentado";
import { aoClicarLink } from "../rota";

type Vista = "grade" | "lista";

const CHAVE_VISTA = "biblioteca:vista";

function lerVista(): Vista {
  try {
    return localStorage.getItem(CHAVE_VISTA) === "lista" ? "lista" : "grade";
  } catch {
    return "grade";
  }
}

function useVista() {
  const [vista, setVista] = useState<Vista>(lerVista);
  const mudar = (v: Vista) => {
    setVista(v);
    try {
      localStorage.setItem(CHAVE_VISTA, v);
    } catch {}
  };
  return [vista, mudar] as const;
}

const VISTAS = [
  {
    valor: "grade",
    rotulo: "Grade",
    icone: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    ),
  },
  {
    valor: "lista",
    rotulo: "Lista",
    icone: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M3 4h10M3 8h10M3 12h10" />
      </svg>
    ),
  },
] as const;

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function filtrar(pecas: readonly Peca[], busca: string, pilar: Pilar | null, status: StatusPost | null) {
  const termo = normalizar(busca.trim());
  return pecas.filter(
    (p) =>
      (!pilar || p.pilar === pilar) &&
      (!status || p.status === status) &&
      (!termo || normalizar([p.headline, p.legenda, p.tema].filter(Boolean).join(" ")).includes(termo)),
  );
}

const detalheDa = (p: Peca) => [p.pilar, p.formato && FORMATO[p.formato]].filter(Boolean).join(" · ");

export function Biblioteca({ abrirMenu }: { abrirMenu: () => void }) {
  useEffect(() => {
    document.title = "Biblioteca · EM Marketing";
  }, []);
  const [carga, tentar] = useApi<Peca[]>("/api/pecas", 60000);
  const [vista, setVista] = useVista();
  const [busca, setBusca] = useState("");
  const [pilar, setPilar] = useState<Pilar | null>(null);
  const [status, setStatus] = useState<StatusPost | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);
  const origem = useRef<HTMLElement | null>(null);

  const pecas = carga.estado === "pronto" ? carga.dados : [];
  const visiveis = filtrar(pecas, useDeferredValue(busca), pilar, status);
  const selecionada = pecas.find((p) => p.id === aberta) ?? null;
  const statusPresentes = (Object.keys(STATUS_POST) as StatusPost[]).filter((s) => pecas.some((p) => p.status === s));
  const filtrando = !!busca.trim() || !!pilar || !!status;

  function abrir(id: number, de: HTMLElement) {
    origem.current = de;
    setAberta((atual) => (atual === id ? null : id));
  }
  const fechar = useCallback(() => {
    setAberta(null);
    origem.current?.focus();
  }, []);
  function limpar() {
    setBusca("");
    setPilar(null);
    setStatus(null);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main id="conteudo" className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-5 px-4 pt-3 pb-10 sm:px-6 md:pt-10">
          <header className="flex flex-wrap items-center gap-2.5">
            <BotaoMenu abrir={abrirMenu} />
            <h1 className="mr-auto text-2xl/tight font-semibold tracking-[-0.02em]">Biblioteca</h1>
            <label htmlFor="busca" className="sr-only">
              Buscar peças
            </label>
            <input
              id="busca"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar headline, legenda ou tema"
              autoComplete="off"
              className="order-last w-full min-w-0 rounded-full border border-borda-campo bg-superficie px-4 py-2 text-base sm:order-none sm:w-[280px] sm:text-sm"
            />
            <Segmentado tipo="alternar" rotulo="Visualização" opcoes={VISTAS} valor={vista} aoMudar={setVista} />
          </header>

          <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <div role="group" aria-label="Pilar" className="flex flex-none gap-1.5 sm:flex-wrap">
              {[null, ...PILARES].map((p) => (
                <button
                  key={p ?? "todas"}
                  type="button"
                  aria-pressed={pilar === p}
                  onClick={() => setPilar(p)}
                  className="pressiona cursor-pointer rounded-full border border-linha-forte px-3.5 py-[5px] text-[13px] text-tinta-2 hover:bg-hover aria-pressed:border-tinta aria-pressed:bg-tinta aria-pressed:text-sobre-tinta"
                >
                  {p ?? "Todas"}
                </button>
              ))}
            </div>
            <label className="order-first flex flex-none items-center gap-2 text-[13px] text-tinta-3 sm:order-none sm:ml-auto">
              <span className="sr-only sm:not-sr-only">Status</span>
              <select
                value={status ?? ""}
                onChange={(e) => setStatus((e.target.value || null) as StatusPost | null)}
                className="cursor-pointer rounded-full border border-borda-campo bg-transparent py-[5px] pr-2 pl-3 text-[13px] text-tinta-2 hover:bg-hover"
              >
                <option value="">Todos os status</option>
                {statusPresentes.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_POST[s].rotulo}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p role="status" className="sr-only">
            {carga.estado === "pronto" && filtrando ? `${visiveis.length} ${visiveis.length === 1 ? "peça" : "peças"}` : ""}
          </p>

          {carga.estado === "carregando" ? (
            <p className="text-tinta-3">Carregando…</p>
          ) : carga.estado === "erro" ? (
            <Falha texto="Não deu para carregar as peças." erro={carga.erro} tentar={tentar} />
          ) : pecas.length === 0 ? (
            <p className="py-8 text-tinta-3">Nenhuma peça ainda. Cada post que o Post gerar fica guardado aqui, com as artes e a legenda.</p>
          ) : visiveis.length === 0 ? (
            <div className="flex flex-col items-start gap-3 py-8">
              <p className="text-tinta-3">Nenhuma peça com esses filtros.</p>
              <button
                type="button"
                onClick={limpar}
                className="pressiona cursor-pointer rounded-full bg-linha px-3.5 py-1.5 text-[13px] font-medium hover:bg-linha-forte"
              >
                Limpar filtros
              </button>
            </div>
          ) : vista === "grade" ? (
            <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(min(160px,40vw),1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
              {visiveis.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-expanded={p.id === aberta}
                    onClick={(e) => abrir(p.id, e.currentTarget)}
                    className="pressiona-leve group flex w-full cursor-pointer flex-col gap-2 text-left"
                  >
                    <Capa
                      url={p.artes[0] ?? null}
                      headline={p.headline}
                      className="w-full rounded-cartao transition-shadow duration-150 group-aria-expanded:shadow-[0_0_0_2px_var(--color-tinta)]"
                    />
                    <span className="sr-only">{p.headline ?? "Peça sem headline"}</span>
                    <span className="flex justify-between gap-2 text-xs">
                      <span className="truncate text-tinta-3">{detalheDa(p)}</span>
                      <span className={`flex-none ${STATUS_POST[p.status].cor}`}>{STATUS_POST[p.status].rotulo}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {visiveis.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-expanded={p.id === aberta}
                    onClick={(e) => abrir(p.id, e.currentTarget)}
                    className="pressiona-leve grid w-full cursor-pointer grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-3 py-2.5 text-left hover:bg-hover aria-expanded:bg-ativo"
                  >
                    <Capa url={p.artes[0] ?? null} headline={null} className="w-11 rounded-md" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{p.headline ?? "Peça sem headline"}</span>
                      <span className="truncate text-[13px] text-tinta-3">{[detalheDa(p), p.tema].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="flex flex-col items-end text-xs">
                      <span className={STATUS_POST[p.status].cor}>{STATUS_POST[p.status].rotulo}</span>
                      <span className="font-mono text-tinta-3 tabular">{dia.format(new Date(p.criadaEm))}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <PainelLateral aberto={!!selecionada} rotulo="Peça" fechar={fechar} className="flex flex-col">
        {selecionada && <Detalhe peca={selecionada} fechar={fechar} />}
      </PainelLateral>
    </div>
  );
}

function Detalhe({ peca: p, fechar }: { peca: Peca; fechar: () => void }) {
  const fecharRef = useRef<HTMLButtonElement>(null);
  useEffect(() => fecharRef.current?.focus({ preventScroll: true }), []);

  return (
    <>
    <div className="flex items-center gap-2 px-4 pt-3 pb-2">
      <span className="mr-auto text-xs text-tinta-3">{[detalheDa(p), STATUS_POST[p.status].rotulo].filter(Boolean).join(" · ")}</span>
      <button
        ref={fecharRef}
        type="button"
        onClick={fechar}
        aria-label="Fechar"
        className="pressiona -mr-1.5 grid size-10 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hover"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-6">
      <h2 className="text-lg/snug font-semibold tracking-[-0.01em] text-balance">{p.headline ?? "Peça sem headline"}</h2>
      {p.artes.length > 0 ? (
        <ul aria-label="Artes" className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-1">
          {p.artes.map((url, i) => (
            <li key={url} className="relative w-[58%] flex-none snap-start">
              <Capa url={url} headline={null} className="w-full rounded-item" />
              {i === 0 && p.artes.length > 1 && (
                <span className="absolute top-2 left-2 rounded-full bg-superficie/90 px-2 py-0.5 text-[11px] font-medium">Escolhida</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-tinta-3">Esta peça ainda não tem arte.</p>
      )}
      <Legenda texto={p.legenda} />
      {p.tema && (
        <p className="text-[13px] text-tinta-3">
          Tema <span className="text-tinta-2">{p.tema}</span>
        </p>
      )}
      {p.conversaId && (
        <a
          href={`/c/${encodeURIComponent(p.conversaId)}`}
          onClick={aoClicarLink}
          className="pressiona self-start rounded-full bg-tinta px-4 py-2 font-medium text-sobre-tinta"
        >
          Abrir a conversa
        </a>
      )}
    </div>
    </>
  );
}

function Legenda({ texto }: { texto: string | null }) {
  const [copiada, setCopiada] = useState<"sim" | "erro" | null>(null);
  useEffect(() => {
    if (!copiada) return;
    const t = setTimeout(() => setCopiada(null), 2000);
    return () => clearTimeout(t);
  }, [copiada]);
  if (!texto) return <p className="text-tinta-3">A legenda ainda não foi escrita.</p>;

  function copiar() {
    navigator.clipboard.writeText(texto!).then(
      () => setCopiada("sim"),
      () => setCopiada("erro"),
    );
  }
  return (
    <section aria-label="Legenda" className="flex flex-col gap-2 rounded-cartao border border-linha bg-superficie p-3.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-normal text-tinta-3">Legenda</h3>
        <button
          type="button"
          onClick={copiar}
          className="pressiona -my-1 flex cursor-pointer items-center rounded-full bg-linha px-3 py-1.5 text-[13px] font-medium hover:bg-linha-forte"
        >
          <Troca chave={copiada === "sim" ? "copiada" : "copiar"} className="flex items-center gap-1.5">
            {copiada === "sim" ? (
              <>
                <Check />
                Copiada
              </>
            ) : (
              "Copiar"
            )}
          </Troca>
        </button>
      </div>
      <p className="whitespace-pre-line text-pretty [overflow-wrap:anywhere]">{texto}</p>
      <p role="status" className={copiada === "erro" ? "text-xs text-erro" : "sr-only"}>
        {copiada === "sim" ? "Legenda copiada." : copiada === "erro" ? "Não deu para copiar. Selecione o texto e copie à mão." : ""}
      </p>
    </section>
  );
}
