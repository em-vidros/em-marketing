import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useApi, useNomesDosBots } from "../api";
import { Avatar } from "../componentes/Avatar";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { aprovacoesPendentes, CartaoAprovacao } from "../componentes/CartaoAprovacao";
import { CartaoTarefa, tarefaIdDa } from "../componentes/CartaoTarefa";
import { Composer } from "../componentes/Composer";
import { atividadeDe } from "../componentes/ia/atividade";
import { Pensando } from "../componentes/ia/Pensando";
import { Raciocinio } from "../componentes/ia/Raciocinio";
import { Markdown } from "../componentes/Markdown";
import { PainelTarefa } from "../componentes/PainelTarefa";
import { Passos } from "../componentes/Passos";
import type { EstadoBot } from "../equipe";
import { MOLA, MOLA_REDUZIDA } from "../movimento";
import { navegar } from "../rota";
import { ehCampo, useAtalho } from "../teclado/motor";
import { ehAprovacao, ehDelegacao, passosDe, type ConversaComMensagens, type Mensagem, type Parte, type ParteDelegacao } from "../tipos";

export interface Vivo {
  mensagens: readonly Mensagem[];
  respondendo: boolean;
}

interface Props {
  id: string;
  nova: boolean;
  /** O Shell usa para o status da equipe na barra lateral. */
  aoMudar: (vivo: Vivo) => void;
  /** Fim de um turno: o Shell relê conversas e atividade. */
  aoTerminarTurno: () => void;
  abrirMenu: () => void;
  estadoDoChefe: EstadoBot;
}

export function TelaConversa(props: Props) {
  const [carga] = useApi<ConversaComMensagens>(props.nova ? null : `/api/conversas/${props.id}`);
  if (props.nova) return <Chat {...props} inicial={[]} titulo={null} />;
  if (carga.estado === "carregando") return <Cabecalho {...props} titulo={null} />;
  if (carga.estado === "erro")
    return (
      <div className="flex flex-1 flex-col">
        <Cabecalho {...props} titulo={null} />
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <h1 className="text-lg font-semibold">Conversa não encontrada</h1>
            <p className="text-tinta-2">Ela pode ter sido apagada, ou é de outra pessoa.</p>
            <a
              href="/"
              onClick={(e) => (e.preventDefault(), navegar("/"))}
              className="pressiona rounded-full bg-tinta px-4 py-2 font-medium text-sobre-tinta"
            >
              Novo pedido
            </a>
          </div>
        </div>
      </div>
    );
  return <Chat {...props} inicial={carga.dados.mensagens} titulo={carga.dados.conversa.titulo} />;
}

function Cabecalho({ abrirMenu, estadoDoChefe, titulo }: Pick<Props, "abrirMenu" | "estadoDoChefe"> & { titulo: string | null }) {
  const { chefe } = useNomesDosBots();
  useEffect(() => {
    document.title = titulo ? `${titulo} · EM Marketing` : "EM Marketing";
  }, [titulo]);
  return (
    <header className="vidro sticky top-0 z-10 flex items-center gap-3 bg-fundo/72 px-4 py-3 backdrop-blur-xl backdrop-saturate-180 sm:px-6">
      <BotaoMenu abrir={abrirMenu} />
      <Avatar bot="chefe" tamanho={34} estado={estadoDoChefe.tipo} anel="var(--color-fundo)" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate leading-tight font-semibold">{chefe.nome}</span>
        <span aria-live="polite" className={`truncate text-xs ${estadoDoChefe.tipo === "trabalhando" ? "brilho" : "text-tinta-3"}`}>
          {estadoDoChefe.tipo === "parado" ? (titulo ?? chefe.descricao) : estadoDoChefe.texto}
        </span>
      </span>
    </header>
  );
}

const texto = (m: Mensagem) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

function Sugestoes({ enviar }: { enviar: (t: string) => void }) {
  const { chefe } = useNomesDosBots();
  const [bots] = useApi<{ id: string; sugestoes: string[] }[]>("/api/bots");
  const sugestoes = bots.estado === "pronto" ? (bots.dados.find((b) => b.id === "chefe")?.sugestoes ?? []) : [];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-12 text-center">
      <Avatar bot="chefe" tamanho={56} />
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-balance">Novo pedido para {chefe.nome}</h1>
      <ul className="flex max-w-xl flex-wrap justify-center gap-2">
        {sugestoes.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => enviar(s)}
              className="pressiona cursor-pointer rounded-full border border-linha-forte px-4 py-2 text-[13px] text-tinta-2 transition-colors duration-150 hover:bg-hover hover:text-tinta"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mantém a lista no fim enquanto o usuário já está no fim; se ele subiu para ler, não puxa. */
function useGrudaNoFim(deps: readonly unknown[]) {
  const fim = useRef<HTMLDivElement>(null);
  const noFim = useRef(true);
  useEffect(() => {
    const alvo = fim.current;
    if (!alvo) return;
    const obs = new IntersectionObserver(([e]) => (noFim.current = e?.isIntersecting ?? true), { rootMargin: "0px 0px 160px 0px" });
    obs.observe(alvo);
    return () => obs.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (noFim.current) fim.current?.scrollIntoView({ block: "end" });
  }, deps);
  return fim;
}

function Chat({
  id,
  nova,
  inicial,
  titulo,
  aoMudar,
  aoTerminarTurno,
  abrirMenu,
  estadoDoChefe,
}: Props & { inicial: Mensagem[]; titulo: string | null }) {
  const [transporte] = useState(
    () =>
      new DefaultChatTransport<Mensagem>({
        api: "/api/chat",
        // O servidor guarda o histórico e só lê a última mensagem.
        prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
          body: { id, botId: "chefe", trigger, messageId, messages: messages.slice(-1) },
        }),
      }),
  );
  const chat = useChat<Mensagem>({
    id,
    messages: inicial,
    transport: transporte,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: aoTerminarTurno,
    throttle: 50,
  });
  const respondendo = chat.status === "submitted" || chat.status === "streaming";
  const reduzir = useReducedMotion();
  const nomes = useNomesDosBots();
  const jaEstavam = useMemo(() => new Set(inicial.map((m) => m.id)), [inicial]);
  const fim = useGrudaNoFim([chat.messages, chat.error]);

  const [painel, setPainel] = useState<string | null>(null);
  const origem = useRef<HTMLElement | null>(null);
  const delegacoes = useMemo(
    () =>
      new Map(
        chat.messages.flatMap((m) => m.parts.filter(ehDelegacao)).flatMap((p) => (tarefaIdDa(p) ? [[tarefaIdDa(p)!, p] as const] : [])),
      ),
    [chat.messages],
  );

  useEffect(() => aoMudar({ mensagens: chat.messages, respondendo }), [chat.messages, respondendo, aoMudar]);

  function abrir(tarefaId: string, de: HTMLElement) {
    origem.current = de;
    setPainel((atual) => (atual === tarefaId ? null : tarefaId));
  }
  function fechar() {
    setPainel(null);
    origem.current?.focus();
  }
  useEffect(() => {
    if (!painel) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [painel]);

  function enviar(t: string) {
    if (nova && chat.messages.length === 0) navegar(`/c/${id}`, { substituir: true });
    chat.sendMessage({ text: t });
  }

  // Responder duas vezes ao mesmo pedido publicaria duas vezes: clique, A e R passam por aqui.
  const respondidas = useRef(new Set<string>());
  const [, renderizar] = useReducer((n: number) => n + 1, 0);
  const responder = (approvalId: string, aprovado: boolean) => {
    if (respondidas.current.has(approvalId)) return;
    respondidas.current.add(approvalId);
    renderizar();
    void chat.addToolApprovalResponse({ id: approvalId, approved: aprovado });
  };
  const pendentes = aprovacoesPendentes(chat.messages, respondidas.current);
  const cartaoDe = (approvalId: string) => document.querySelector<HTMLElement>(`[data-aprovacao="${CSS.escape(approvalId)}"]`);

  /** A ou R no cartão focado. Sem pedido pendente ali, a tecla segue adiante. */
  const decidirFocado = (aprovado: boolean) => () => {
    const id = document.activeElement?.closest<HTMLElement>("[data-aprovacao]")?.dataset.aprovacao;
    if (!id || !pendentes.includes(id)) return false;
    responder(id, aprovado);
  };
  useAtalho("aprovar", decidirFocado(true));
  useAtalho("recusar", decidirFocado(false));

  // Um pedido novo, chegado agora, recebe o foco para A ou R valerem na hora. Quem está digitando
  // ou com a paleta aberta não perde o foco; Esc no composer leva ao cartão.
  const vistas = useRef(new Set(aprovacoesPendentes(inicial, new Set())));
  const novo = pendentes.find((p) => !vistas.current.has(p));
  useEffect(() => {
    if (!novo) return;
    vistas.current.add(novo);
    const foco = document.activeElement;
    if (ehCampo(foco) || foco?.closest('[data-teclado="isolado"], [aria-modal="true"]')) return;
    cartaoDe(novo)?.focus();
  }, [novo]);
  const aoTeclar = (e: React.KeyboardEvent) => {
    const alvo = pendentes.at(-1);
    if (e.key !== "Escape" || !alvo || !(e.target instanceof HTMLTextAreaElement)) return;
    e.preventDefault();
    cartaoDe(alvo)?.focus();
  };

  useAtalho("painel-tarefas", () => {
    if (painel) return fechar();
    const ultima = [...delegacoes.keys()].at(-1);
    if (!ultima) return false;
    abrir(ultima, document.querySelector<HTMLElement>(`[data-abre-tarefa="${CSS.escape(ultima)}"]`) ?? (document.activeElement as HTMLElement));
  });
  useAtalho("focar-composer", () => document.getElementById("mensagem")?.focus());

  const erro = chat.error ? lerErro(chat.error) : null;
  const ultima = chat.messages.at(-1);
  const turno = ultima?.role === "assistant" ? ultima : null;
  const pensando = respondendo && atividadeDe(turno, true).tipo === "pensando";

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main id="conteudo" onKeyDown={aoTeclar} className="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Cabecalho abrirMenu={abrirMenu} estadoDoChefe={estadoDoChefe} titulo={titulo} />
        {chat.messages.length === 0 ? (
          <Sugestoes enviar={enviar} />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 text-base/relaxed sm:px-6">
            {chat.messages.map((m) => (
              <motion.div
                key={m.id}
                initial={jaEstavam.has(m.id) ? false : reduzir ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)" }}
                animate={reduzir ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)" }}
                transition={reduzir ? MOLA_REDUZIDA : MOLA}
                className="flex flex-col gap-4"
              >
                {m.role === "user" ? (
                  <div className="max-w-[80%] self-end rounded-balao border border-linha bg-ativo px-4 py-2.5 whitespace-pre-line">
                    {texto(m)}
                  </div>
                ) : (
                  m.parts.map((p, i) => (
                    <ParteDoChefe
                      key={i}
                      parte={p}
                      noAr={respondendo && m === ultima}
                      painel={painel}
                      abrir={abrir}
                      responder={responder}
                      respondidas={respondidas.current}
                    />
                  ))
                )}
              </motion.div>
            ))}
            {pensando && <Pensando />}
            {erro && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 rounded-cartao border border-linha bg-superficie px-4 py-3 text-sm"
              >
                <span className="text-erro">{erro}</span>
                <button
                  type="button"
                  onClick={() => chat.regenerate()}
                  className="pressiona ml-auto cursor-pointer rounded-full bg-linha px-3 py-1.5 text-[13px] font-medium hover:bg-linha-forte"
                >
                  Tentar de novo
                </button>
              </div>
            )}
            <div ref={fim} />
          </div>
        )}
        <Composer
          rotulo={`Mensagem para ${nomes.chefe.nome}`}
          placeholder="O que vamos postar?"
          respondendo={respondendo}
          enviar={enviar}
          parar={() => chat.stop()}
        />
      </main>
      <AnimatePresence>
        {painel && (
          <Painel key="painel" reduzir={!!reduzir} fechar={fechar}>
            <PainelTarefa tarefaId={painel} parte={delegacoes.get(painel)} fechar={fechar} />
          </Painel>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Coluna à direita no desktop; no celular, cobre a tela e entra pela direita, por onde sai. */
function Painel({ children, reduzir, fechar }: { children: React.ReactNode; reduzir: boolean; fechar: () => void }) {
  const fora = reduzir ? { opacity: 0 } : { opacity: 0, transform: "translateX(24px)" };
  return (
    <>
      <motion.div
        aria-hidden="true"
        onClick={fechar}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={MOLA_REDUZIDA}
        className="fixed inset-0 z-30 bg-tinta/20 lg:hidden"
      />
      <motion.aside
        aria-label="Tarefa"
        initial={fora}
        animate={{ opacity: 1, transform: "translateX(0px)" }}
        exit={fora}
        transition={reduzir ? MOLA_REDUZIDA : MOLA}
        className="fixed inset-y-0 right-0 z-40 w-full max-w-[420px] border-l border-linha bg-painel lg:static lg:z-auto lg:w-[400px] lg:flex-none"
      >
        {children}
      </motion.aside>
    </>
  );
}

function ParteDoChefe({
  parte,
  noAr,
  painel,
  abrir,
  responder,
  respondidas,
}: {
  parte: Parte;
  /** A mensagem desta parte ainda está chegando. */
  noAr: boolean;
  painel: string | null;
  abrir: (tarefaId: string, origem: HTMLElement) => void;
  responder: (id: string, aprovado: boolean) => void;
  respondidas: ReadonlySet<string>;
}) {
  if (parte.type === "reasoning") return <Raciocinio texto={parte.text} ativo={noAr && parte.state === "streaming"} />;
  if (parte.type === "text") {
    const digitando = noAr && parte.state === "streaming";
    return parte.text.trim() || digitando ? <Markdown texto={parte.text} digitando={digitando} className="max-w-[68ch] text-[#1a1a1a]" /> : null;
  }
  if (ehDelegacao(parte)) return <CartaoTarefa parte={parte as ParteDelegacao} aberta={painel === tarefaIdDa(parte)} abrir={abrir} />;
  if (ehAprovacao(parte))
    return <CartaoAprovacao parte={parte} respondida={parte.state === "approval-requested" && respondidas.has(parte.approval.id)} responder={responder} />;
  const [passo] = passosDe({ id: "", role: "assistant", parts: [parte] });
  return passo ? <Passos passos={[passo]} className="text-sm" /> : null;
}

/** O transporte joga o corpo da resposta como mensagem; o servidor manda {erro}. */
function lerErro(e: Error): string {
  try {
    const corpo = JSON.parse(e.message) as { erro?: string };
    if (corpo.erro) return corpo.erro;
  } catch {}
  return e.message ? `Não deu para continuar: ${e.message}` : "Algo deu errado. Tente de novo.";
}
