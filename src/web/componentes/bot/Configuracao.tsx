import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Modelo } from "../../../agent/models";
import { recarregarBots, useApi, useNomesDosBots, type Carga } from "../../api";
import { BOTS } from "../../bots";
import { MOLA, MOLA_REDUZIDA } from "../../movimento";
import type { BotId } from "../../tipos";
import { Falha } from "../Falha";
import { fecharAviso, mostrarAviso } from "../menu/Avisos";
import { pilhaDeDesfazer } from "../menu/desfazer";
import { dataCurta } from "../peca";
import { enviar } from "./enviar";
import {
  CAMPOS,
  LIMITE,
  mudanca,
  oQueMudou,
  problemasDe,
  sujo,
  type Acao,
  type CampoEditavel,
  type DetalheBot,
  type Formulario,
  type VersaoBot,
} from "./formulario";

type Pronto = Extract<Formulario, { fase: "pronto" }>;

/**
 * O formulário de cada página de bot montada. O desfazer de uma restauração roda no servidor e
 * pode chegar depois de trocar de aba; por aqui ele acha o formulário que estiver na tela.
 */
const formularios = new Map<BotId, Dispatch<Acao>>();

/**
 * As entradas da pilha de desfazer que reescrevem o formulário. Editar o rascunho as invalida,
 * porque desfazer jogaria a edição fora; sair da página invalida o descarte, cujo rascunho some.
 */
const doFormulario = new Map<BotId, { descarte?: number; restauro?: number }>();

function largar(id: BotId, qual: "descarte" | "restauro") {
  const chave = doFormulario.get(id)?.[qual];
  if (chave === undefined) return;
  pilhaDeDesfazer.descartar(chave);
  fecharAviso(chave);
  delete doFormulario.get(id)![qual];
}

function empilhar(id: BotId, qual: "descarte" | "restauro", desfazer: () => void | Promise<void>, texto: string) {
  largar(id, qual);
  const chave = pilhaDeDesfazer.empilhar(desfazer);
  doFormulario.set(id, { ...doFormulario.get(id), [qual]: chave });
  mostrarAviso({ tipo: "desfazivel", chave, texto });
}

/** Liga o formulário da página ao desfazer. Chame na página do bot, que é dona do reducer. */
export function useFormularioDoBot(id: BotId, despachar: Dispatch<Acao>) {
  useEffect(() => {
    formularios.set(id, despachar);
    return () => {
      formularios.delete(id);
      largar(id, "descarte");
    };
  }, [id, despachar]);
}

const conta = (n: number) => n.toLocaleString("pt-BR");

const estiloCampo =
  "w-full rounded-[10px] border border-borda-campo bg-superficie px-3 py-2 text-base text-tinta transition-[border-color] duration-150 hover:border-tinta-3 focus-visible:border-tinta sm:text-sm aria-invalid:border-erro";

function Linha({ rotulo, para, ajuda, children }: { rotulo: string; para?: string; ajuda?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-10 gap-y-2.5 border-t border-linha px-5 py-5 first:border-t-0 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        {para ? (
          <label htmlFor={para} className="font-medium">
            {rotulo}
          </label>
        ) : (
          <span className="font-medium">{rotulo}</span>
        )}
        {ajuda && <p className="text-[13px] text-pretty text-tinta-3">{ajuda}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Problema({ id, texto }: { id: string; texto: string | undefined }) {
  return texto ? (
    <p id={id} className="text-[13px] text-erro">
      {texto}
    </p>
  ) : null;
}

const Cartao = ({ children, titulo }: { children: ReactNode; titulo?: string }) => (
  <section aria-label={titulo} className="flex flex-col gap-2.5">
    {titulo && <h2 className="px-1 text-[13px] font-medium text-tinta-3">{titulo}</h2>}
    <div className="rounded-cartao bg-superficie shadow-[0_0_0_1px_var(--color-linha-forte)]">{children}</div>
  </section>
);

/** Cresce com o texto. Altura não anima: muda a cada tecla. */
function useAutoAltura(valor: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [valor]);
  return ref;
}

/** Uma frase, mas pode passar de uma linha: cresce em vez de esconder o fim. Enter não quebra linha. */
function Descricao({
  id,
  valor,
  aoMudar,
  campoRef,
  placeholder,
  invalido,
  descrito,
}: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
  campoRef: (el: HTMLTextAreaElement | null) => void;
  placeholder: string;
  invalido: boolean;
  descrito: string | undefined;
}) {
  const ref = useAutoAltura(valor);
  return (
    <textarea
      id={id}
      ref={(el) => {
        ref.current = el;
        campoRef(el);
      }}
      rows={1}
      value={valor}
      onChange={(e) => aoMudar(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      placeholder={placeholder}
      aria-invalid={invalido || undefined}
      aria-describedby={descrito}
      className={`${estiloCampo} resize-none overflow-hidden`}
    />
  );
}

function SeletorDeModelo({
  valor,
  salvo,
  modelos,
  aoMudar,
  relerModelos,
}: {
  valor: string;
  salvo: string;
  modelos: Carga<Modelo[]>;
  aoMudar: (id: string) => void;
  relerModelos: () => void;
}) {
  const nome = useId();
  if (modelos.estado === "carregando") return <p className="text-tinta-3">Carregando os modelos…</p>;
  if (modelos.estado === "erro") return <Falha texto="Não deu para listar os modelos." erro={modelos.erro} tentar={relerModelos} />;
  return (
    <div role="radiogroup" aria-label="Modelo" className="flex flex-col overflow-hidden rounded-[12px] border border-linha-forte">
      {modelos.dados.map((m) => {
        const marcado = m.id === valor;
        const motivo = !m.disponivel ? "Falta a chave de API no servidor" : null;
        // O modelo em uso continua marcável mesmo sem chave, para não sumir da lista.
        const desabilitado = !m.disponivel && m.id !== salvo;
        return (
          <label
            key={m.id}
            className={`flex min-h-12 items-center gap-3 border-t border-linha px-3.5 py-2.5 first:border-t-0 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-tinta ${
              m.disponivel ? "cursor-pointer transition-colors duration-150 hover:bg-fundo" : "cursor-not-allowed"
            } ${marcado ? "bg-fundo" : ""}`}
          >
            <input
              type="radio"
              name={nome}
              value={m.id}
              checked={marcado}
              disabled={desabilitado}
              onChange={() => aoMudar(m.id)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={`grid size-4 flex-none place-items-center rounded-full border ${marcado ? "border-tinta bg-tinta" : "border-tinta/25"}`}
            >
              {marcado && <span className="size-1.5 rounded-full bg-sobre-tinta" />}
            </span>
            <span className={`flex min-w-0 flex-1 flex-col ${desabilitado ? "text-tinta-4" : m.disponivel ? "" : "text-tinta-2"}`}>
              <span className="font-medium">{m.nome}</span>
              <span className="truncate font-mono text-xs text-tinta-3">{m.id}</span>
            </span>
            {motivo && <span className="flex-none text-right text-xs text-tinta-3">{motivo}</span>}
          </label>
        );
      })}
    </div>
  );
}

function Prompt({
  id,
  valor,
  problema,
  aoMudar,
  campoRef,
}: {
  id: string;
  valor: string;
  problema: string | undefined;
  aoMudar: (v: string) => void;
  campoRef: (el: HTMLTextAreaElement | null) => void;
}) {
  const ref = useAutoAltura(valor);
  const n = valor.trim().length;
  const cor = n > LIMITE.prompt ? "text-erro" : n > LIMITE.prompt * 0.95 ? "text-esperando-texto" : "text-tinta-3";
  return (
    <>
      <textarea
        id={id}
        ref={(el) => {
          ref.current = el;
          campoRef(el);
        }}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        spellCheck
        aria-invalid={problema ? true : undefined}
        aria-describedby={`${id}-conta ${problema ? `${id}-erro` : ""}`}
        className={`${estiloCampo} max-h-[60vh] min-h-64 resize-none overflow-y-auto overscroll-contain font-mono text-[13px]/relaxed sm:text-[13px]/relaxed`}
      />
      <div className="flex items-start justify-between gap-3">
        <Problema id={`${id}-erro`} texto={problema} />
        <span id={`${id}-conta`} className={`tabular ml-auto flex-none font-mono text-xs ${cor}`}>
          {conta(n)} de {conta(LIMITE.prompt)} caracteres
        </span>
      </div>
    </>
  );
}

function RegrasFixas({ fixo, tools }: { fixo: string; tools: readonly string[] }) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] text-[13px] font-medium text-tinta-2 hover:text-tinta [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-200 ease-(--ease-saida) group-open:rotate-90"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        Regras fixas da marca
      </summary>
      <div className="flex flex-col gap-3 pt-1 pb-1">
        <p className="text-[13px] text-pretty text-tinta-3">
          O código acrescenta estas regras depois do prompt, em toda mensagem. Editar o prompt não as remove.
        </p>
        <pre className="max-h-80 overflow-auto overscroll-contain rounded-[10px] bg-fundo px-3 py-2.5 font-mono text-xs/relaxed whitespace-pre-wrap text-tinta-2">
          {fixo}
        </pre>
        {tools.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] text-tinta-3">Ferramentas, também definidas no código:</p>
            <ul className="flex flex-wrap gap-1.5">
              {tools.map((t) => (
                <li key={t} className="rounded-[6px] bg-ativo px-1.5 py-0.5 font-mono text-xs text-tinta-2">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

/** Confirmação no lugar do botão. Esc cancela antes de chegar ao "Esc descarta" da página. */
function Confirmar({
  pergunta,
  confirmar,
  rotulo,
  cancelar,
}: {
  pergunta: string;
  confirmar: () => void;
  rotulo: string;
  cancelar: () => void;
}) {
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => botao.current?.focus(), []);
  return (
    <div
      role="group"
      aria-label={pergunta}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        cancelar();
      }}
      className="sobe flex flex-wrap items-center gap-2"
    >
      <p className="mr-auto text-[13px] text-pretty text-tinta-2">{pergunta}</p>
      <button type="button" onClick={cancelar} className="pressiona rounded-full px-3.5 py-1.5 font-medium text-tinta-2 hover:bg-hover">
        Cancelar
      </button>
      <button ref={botao} type="button" onClick={confirmar} className="pressiona rounded-full bg-tinta px-3.5 py-1.5 font-medium text-sobre-tinta">
        {rotulo}
      </button>
    </div>
  );
}

const autorCurto = (email: string) => email.split("@")[0] ?? email;

function Versoes({
  id,
  f,
  modelos,
  restaurar,
}: {
  id: BotId;
  f: Pronto;
  modelos: Carga<Modelo[]>;
  restaurar: (caminho: string, texto: string) => Promise<void>;
}) {
  const [carga, recarregar] = useApi<VersaoBot[]>(`/api/bots/${id}/versoes`);
  useEffect(recarregar, [f.salvo.versaoId, recarregar]);
  const [confirmando, setConfirmando] = useState<number | "padrao" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const nomes = useNomesDosBots();
  const abridores = useRef(new Map<number | "padrao", HTMLButtonElement | null>());
  /** Cancelar devolve o foco ao botão que abriu a confirmação, que volta a existir ao fechar. */
  const cancelar = () => {
    const alvo = confirmando;
    flushSync(() => setConfirmando(null));
    if (alvo !== null) abridores.current.get(alvo)?.focus();
  };
  const temRascunho = sujo(f);
  const nomeDo = (m: string) => (modelos.estado === "pronto" ? (modelos.dados.find((x) => x.id === m)?.nome ?? m) : m);
  const noPadrao = CAMPOS.every((c) => f.salvo.padrao[c]);

  const fazer = async (caminho: string, texto: string) => {
    setConfirmando(null);
    setErro(null);
    await restaurar(caminho, texto).catch((e: Error) => setErro(e.message));
  };
  const pedir = (alvo: number | "padrao", caminho: string, texto: string) =>
    alvo === "padrao" || temRascunho ? setConfirmando(alvo) : void fazer(caminho, texto);

  const padrao = `/api/bots/${id}/padrao`;

  return (
    <Cartao titulo="Histórico de versões">
      <div className="flex flex-col gap-3 px-5 py-4">
        {confirmando === "padrao" ? (
          <Confirmar
            pergunta={
              temRascunho
                ? "Voltar ao texto original do código? O que você editou e não salvou se perde; a versão atual fica no histórico."
                : "Voltar ao texto original do código? A versão atual fica no histórico."
            }
            rotulo="Restaurar padrão"
            confirmar={() => fazer(padrao, "Padrão do código restaurado.")}
            cancelar={cancelar}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-[13px] text-pretty text-tinta-3">
              {noPadrao ? "Em uso: o texto original do código." : "Cada gravação vira uma versão. Restaurar grava uma versão nova, então nada se perde."}
            </p>
            <button
              ref={(el) => void abridores.current.set("padrao", el)}
              type="button"
              onClick={() => pedir("padrao", padrao, "")}
              disabled={noPadrao && !temRascunho}
              className="pressiona rounded-full bg-tinta/[0.06] px-3.5 py-1.5 font-medium hover:bg-tinta/10 disabled:cursor-not-allowed disabled:text-tinta-4 disabled:hover:bg-tinta/[0.06]"
            >
              Restaurar padrão
            </button>
          </div>
        )}
        {erro && (
          <p role="alert" className="text-[13px] text-erro">
            Não deu para restaurar. {erro}
          </p>
        )}
      </div>
      {carga.estado === "carregando" ? (
        <p className="border-t border-linha px-5 py-4 text-tinta-3">Carregando as versões…</p>
      ) : carga.estado === "erro" ? (
        <Falha texto="Não deu para carregar as versões." erro={carga.erro} tentar={recarregar} className="border-t border-linha px-5 py-4" />
      ) : carga.dados.length === 0 ? (
        <p className="border-t border-linha px-5 py-4 text-pretty text-tinta-3">
          Nenhuma versão gravada. {nomes[id].nome} usa o texto original do código até alguém salvar uma mudança.
        </p>
      ) : (
        <ol className="flex flex-col">
          {carga.dados.map((v, i) => {
            const emUso = v.id === f.salvo.versaoId;
            const caminho = `/api/bots/${id}/versoes/${v.id}/restaurar`;
            const texto = `Versão de ${dataCurta.format(v.criadaEm)} restaurada.`;
            return (
              <li key={v.id} className="flex flex-col gap-2 border-t border-linha px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex min-w-0 flex-[1_1_260px] flex-col">
                    <span className="font-medium">
                      {oQueMudou(v, carga.dados[i + 1])}
                      {emUso && <span className="ml-2 rounded-full bg-ativo px-2 py-0.5 align-[1px] text-xs font-normal text-tinta-2">Em uso</span>}
                    </span>
                    <span className="tabular truncate text-xs text-tinta-3">
                      <span title={v.autor}>{autorCurto(v.autor)}</span> · {dataCurta.format(v.criadaEm)} · {nomeDo(v.modelo)}
                    </span>
                  </div>
                  {!emUso && confirmando !== v.id && (
                    <button
                      ref={(el) => void abridores.current.set(v.id, el)}
                      type="button"
                      onClick={() => pedir(v.id, caminho, texto)}
                      aria-label={`Restaurar a versão de ${dataCurta.format(v.criadaEm)}`}
                      className="pressiona rounded-full px-3 py-1.5 font-medium text-tinta-2 hover:bg-hover hover:text-tinta"
                    >
                      Restaurar
                    </button>
                  )}
                </div>
                {confirmando === v.id && (
                  <Confirmar
                    pergunta="Restaurar esta versão? O que você editou e não salvou se perde."
                    rotulo="Restaurar"
                    confirmar={() => fazer(caminho, texto)}
                    cancelar={cancelar}
                  />
                )}
                <details className="group">
                  <summary className="w-fit cursor-pointer list-none text-xs text-tinta-3 hover:text-tinta [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Ver o texto</span>
                    <span className="hidden group-open:inline">Esconder o texto</span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-1 rounded-[10px] bg-fundo px-3 py-2.5 text-[13px] [overflow-wrap:anywhere]">
                    <p>
                      <span className="text-tinta-3">Nome:</span> {v.nome}
                    </p>
                    <p className="text-pretty">
                      <span className="text-tinta-3">Descrição:</span> {v.descricao}
                    </p>
                    <pre className="mt-1 max-h-60 overflow-auto overscroll-contain font-mono text-xs/relaxed whitespace-pre-wrap text-tinta-2">{v.prompt}</pre>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </Cartao>
  );
}

/** A barra que aparece com alterações não salvas. O desfazer de descartar e restaurar vai pelo toast do app. */
function Barra({ f, salvar, descartar }: { f: Pronto; salvar: () => void; descartar: () => void }) {
  const reduzir = useReducedMotion();
  const mostrar = sujo(f);
  const fora = reduzir ? { opacity: 0 } : { opacity: 0, transform: "translateY(12px) scale(0.98)" };
  return (
    <div className="pointer-events-none sticky bottom-0 z-10 flex justify-center pt-6 pb-[max(16px,env(safe-area-inset-bottom))]">
      <div role="status" className="sr-only">
        {mostrar ? (f.erro ?? "") : ""}
      </div>
      <AnimatePresence initial={false}>
        {mostrar && (
          <motion.div
            initial={fora}
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
            exit={fora}
            transition={reduzir ? MOLA_REDUZIDA : MOLA}
            className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-[20px] bg-tinta py-2 pr-2 pl-4 text-sobre-tinta shadow-[0_8px_30px_rgb(15_13_10/0.18)]"
          >
            <p className={`mr-auto line-clamp-2 min-w-0 flex-1 text-[13px] ${f.erro ? "text-erro-sobre-tinta" : "text-sobre-tinta/80"}`}>
              {f.erro ?? "Alterações não salvas"}
            </p>
            <button
              type="button"
              onClick={descartar}
              aria-keyshortcuts="Escape"
              className="pressiona flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-sobre-tinta/80 hover:bg-white/10 hover:text-sobre-tinta"
            >
              Descartar <kbd className="hidden font-sans text-xs text-sobre-tinta/50 sm:inline">Esc</kbd>
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={f.enviando}
              aria-keyshortcuts="Meta+S"
              className="pressiona flex flex-none items-center gap-1.5 rounded-full bg-sobre-tinta px-3.5 py-1.5 font-medium text-tinta disabled:cursor-progress disabled:opacity-70"
            >
              {f.enviando ? "Salvando…" : "Salvar"} <kbd className="hidden font-sans text-xs text-tinta-3 sm:inline">⌘S</kbd>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A aba Configuração. O estado do formulário mora na página (Bot.tsx), que mostra o nome salvo no
 * cabeçalho; aqui ficam os campos, o histórico e os atalhos ⌘S e Esc.
 */
export function Configuracao({
  id,
  f,
  despachar,
  modelos,
  relerModelos,
}: {
  id: BotId;
  f: Pronto;
  despachar: Dispatch<Acao>;
  modelos: Carga<Modelo[]>;
  relerModelos: () => void;
}) {
  const ids = useId();
  const campos = useRef<Partial<Record<CampoEditavel, HTMLElement | null>>>({});

  const editar = (campo: CampoEditavel, valor: string) => {
    largar(id, "descarte");
    largar(id, "restauro");
    despachar({ tipo: "editar", campo, valor });
  };

  const salvar = async () => {
    if (!sujo(f) || f.enviando) return;
    const problemas = problemasDe(f.rascunho);
    despachar({ tipo: "enviar", problemas });
    const primeiro = CAMPOS.find((c) => problemas[c]);
    if (primeiro) return campos.current[primeiro]?.focus();
    try {
      const detalhe = await enviar<DetalheBot>(`/api/bots/${id}/config`, "PUT", mudanca(f.salvo, f.rascunho));
      despachar({ tipo: "chegou", detalhe });
      if (detalhe.versaoId !== f.salvo.versaoId) void recarregarBots();
    } catch (e) {
      despachar({ tipo: "falhou", erro: `Não salvou. ${(e as Error).message}` });
    }
  };

  const descartar = () => {
    if (!sujo(f)) return;
    despachar({ tipo: "descartar" });
    empilhar(id, "descarte", () => formularios.get(id)?.({ tipo: "recuperar" }), "Alterações descartadas.");
  };

  /** Restaura e oferece voltar à versão que estava em uso, que continua no histórico. */
  const restaurar = async (caminho: string, texto: string) => {
    const anterior = f.salvo.versaoId;
    despachar({ tipo: "chegou", detalhe: await enviar<DetalheBot>(caminho, "POST") });
    void recarregarBots();
    const volta = anterior === null ? `/api/bots/${id}/padrao` : `/api/bots/${id}/versoes/${anterior}/restaurar`;
    empilhar(
      id,
      "restauro",
      () =>
        enviar<DetalheBot>(volta, "POST")
          .then((detalhe) => {
            formularios.get(id)?.({ tipo: "chegou", detalhe });
            void recarregarBots();
          })
          .catch((e: Error) => mostrarAviso({ tipo: "erro", texto: `Não deu para desfazer. ${e.message}` })),
      texto,
    );
  };

  const atalhos = useRef({ salvar, descartar });
  atalhos.current = { salvar, descartar };
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void atalhos.current.salvar();
      } else if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[aria-modal='true']")) {
        atalhos.current.descartar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const r = f.rascunho;
  const p = f.problemas;
  const campoDe = (c: CampoEditavel) => (el: HTMLElement | null) => {
    campos.current[c] = el;
  };
  const descrito = (c: CampoEditavel, ...outros: string[]) => [p[c] ? `${ids}-${c}-erro` : "", ...outros].filter(Boolean).join(" ") || undefined;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
      className="flex flex-col gap-8"
    >
      <Cartao>
        <Linha rotulo="Nome" para={`${ids}-nome`} ajuda="Como o bot aparece na barra lateral e nas conversas.">
          <input
            id={`${ids}-nome`}
            ref={campoDe("nome")}
            value={r.nome}
            onChange={(e) => editar("nome", e.target.value)}
            autoComplete="off"
            maxLength={LIMITE.nome + 20}
            placeholder={BOTS[id].nome}
            aria-invalid={p.nome ? true : undefined}
            aria-describedby={descrito("nome")}
            className={estiloCampo}
          />
          <Problema id={`${ids}-nome-erro`} texto={p.nome} />
        </Linha>
        <Linha rotulo="Descrição" para={`${ids}-descricao`} ajuda="Uma frase sobre o papel dele. Aparece embaixo do nome.">
          <Descricao
            id={`${ids}-descricao`}
            campoRef={campoDe("descricao")}
            valor={r.descricao}
            aoMudar={(v) => editar("descricao", v)}
            placeholder={BOTS[id].papel}
            invalido={!!p.descricao}
            descrito={descrito("descricao")}
          />
          <Problema id={`${ids}-descricao-erro`} texto={p.descricao} />
        </Linha>
        <Linha rotulo="Modelo" ajuda="O modelo de IA que responde por este bot.">
          <SeletorDeModelo valor={r.modelo} salvo={f.salvo.modelo} modelos={modelos} relerModelos={relerModelos} aoMudar={(m) => editar("modelo", m)} />
        </Linha>
        <Linha
          rotulo="Prompt"
          para={`${ids}-prompt`}
          ajuda="O papel do bot: o que ele faz, em que ordem e o que evita. Escreva como se explicasse a uma pessoa nova na equipe."
        >
          <Prompt id={`${ids}-prompt`} valor={r.prompt} problema={p.prompt} aoMudar={(v) => editar("prompt", v)} campoRef={campoDe("prompt")} />
          <RegrasFixas fixo={f.salvo.fixo} tools={f.salvo.tools} />
        </Linha>
      </Cartao>
      <p className="-mt-5 px-1 text-[13px] text-pretty text-tinta-3">
        As mudanças valem a partir da próxima mensagem, inclusive nas conversas que já existem. Não precisa reiniciar nada.
      </p>
      <Versoes id={id} f={f} modelos={modelos} restaurar={restaurar} />
      <Barra f={f} salvar={() => void salvar()} descartar={descartar} />
    </form>
  );
}
