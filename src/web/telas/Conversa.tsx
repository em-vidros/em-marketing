import { useChat } from "@ai-sdk/react";
import { Menu } from "@base-ui/react/menu";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
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
import { devolverFoco, PainelLateral } from "../componentes/PainelLateral";
import { PainelTarefa } from "../componentes/PainelTarefa";
import { Passos, trechosDe } from "../componentes/Passos";
import { BOT_IDS } from "../bots";
import { Chevron } from "../componentes/ia/Raciocinio";
import { Check } from "../componentes/Passos";
import type { EstadoBot, EstadosDaEquipe } from "../equipe";
import { criarEscolhaDoBot, criarTransporte, type EscolhaDoBot } from "../escolhaDoBot";
import { MOLA, MOLA_REDUZIDA } from "../movimento";
import { navegar } from "../rota";
import { ehCampo, useAtalho } from "../teclado/motor";
import { type BotId, ehAprovacao, ehDelegacao, type ConversaComMensagens, type Mensagem, type Parte, type ParteDelegacao } from "../tipos";

export interface Vivo {
  mensagens: readonly Mensagem[];
  respondendo: boolean;
  /** Quem responde a conversa aberta. */
  bot: BotId;
}

interface Props {
  id: string;
  /** A escolha de bot da conversa de "/"; null numa conversa que já existe. */
  escolha: EscolhaDoBot | null;
  /** O bot que a lista de conversas já conhece, para o cabeçalho enquanto a conversa carrega. */
  botDaLista: BotId | null;
  /** O Shell usa para o status da equipe na barra lateral. */
  aoMudar: (vivo: Vivo) => void;
  /** Fim de um turno: o Shell relê conversas e atividade. */
  aoTerminarTurno: () => void;
  abrirMenu: () => void;
  estados: EstadosDaEquipe;
}

export function TelaConversa(props: Props) {
  const [carga] = useApi<ConversaComMensagens>(props.escolha ? null : `/api/conversas/${props.id}`);
  const bot = props.botDaLista ?? "chefe";
  if (props.escolha) return <Chat {...props} escolha={props.escolha} inicial={[]} titulo={null} />;
  if (carga.estado === "carregando") return <Cabecalho abrirMenu={props.abrirMenu} bot={bot} estado={props.estados[bot]} titulo={null} />;
  if (carga.estado === "erro")
    return (
      <div className="flex flex-1 flex-col">
        <Cabecalho abrirMenu={props.abrirMenu} bot={bot} estado={props.estados[bot]} titulo={null} />
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
  return <ConversaSalva {...props} dados={carga.dados} />;
}

/** Uma conversa que já existe responde sempre com o bot dela: a escolha nasce travada. */
function ConversaSalva({ dados, ...props }: Props & { dados: ConversaComMensagens }) {
  const [escolha] = useState(() => criarEscolhaDoBot(dados.conversa.botId, { travada: true }));
  return <Chat {...props} escolha={escolha} inicial={dados.mensagens} titulo={dados.conversa.titulo} />;
}

/** O título da conversa em cima e, embaixo, o bot e o que ele está fazendo. Sem título ainda, o nome do bot. */
function Cabecalho({ abrirMenu, bot, estado, titulo }: { abrirMenu: () => void; bot: BotId; estado: EstadoBot; titulo: string | null }) {
  const { nome, descricao } = useNomesDosBots()[bot];
  const ativo = estado.tipo !== "parado";
  useEffect(() => {
    document.title = titulo ? `${titulo} · EM Marketing` : "EM Marketing";
  }, [titulo]);
  return (
    <header className="vidro sticky top-0 z-10 flex items-center gap-3 bg-fundo/72 px-4 py-3 backdrop-blur-xl backdrop-saturate-180 sm:px-6">
      <BotaoMenu abrir={abrirMenu} />
      <Avatar bot={bot} tamanho={34} estado={estado.tipo} anel="var(--color-fundo)" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate leading-tight font-semibold">{titulo ?? nome}</span>
        <span aria-live="polite" className="truncate text-xs text-tinta-3">
          {titulo ? nome : ativo ? null : descricao}
          {titulo && ativo && " · "}
          {ativo && <span className={estado.tipo === "trabalhando" ? "brilho" : undefined}>{estado.texto}</span>}
        </span>
      </span>
    </header>
  );
}

const texto = (m: Mensagem) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

/** O estado vazio de uma conversa: o bot que vai responder e as sugestões dele, de /api/bots. */
function Sugestoes({ bot, enviar }: { bot: BotId; enviar: (t: string) => void }) {
  const { nome } = useNomesDosBots()[bot];
  const [bots] = useApi<{ id: string; sugestoes: string[] }[]>("/api/bots");
  const sugestoes = bots.estado === "pronto" ? (bots.dados.find((b) => b.id === bot)?.sugestoes ?? []) : [];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-12 text-center">
      <Avatar bot={bot} tamanho={56} />
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-balance [overflow-wrap:anywhere]">
        {bot === "chefe" ? `Novo pedido para ${nome}` : `Conversa com ${nome}`}
      </h1>
      <ul className="flex max-w-xl flex-wrap justify-center gap-2">
        {sugestoes.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => enviar(s)}
              className="pressiona cursor-pointer rounded-full border border-linha-forte px-4 py-2 text-[13px] text-tinta-2 hover:bg-hover hover:text-tinta"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Quem vai responder, no composer de uma conversa nova. Um menu de opções: clique ou Enter
 * abre, as setas escolhem. Some na primeira mensagem, quando o bot fica.
 */
function SeletorDeBot({ escolha }: { escolha: EscolhaDoBot }) {
  const bot = useSyncExternalStore(escolha.assinar, escolha.ler);
  const nomes = useNomesDosBots();
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Quem responde: ${nomes[bot].nome}. Trocar o bot`}
        className="pressiona -ml-2 flex h-9 max-w-[60vw] min-w-0 cursor-pointer items-center gap-2 rounded-full px-2.5 text-[13px] font-medium text-tinta-2 hover:bg-hover hover:text-tinta data-popup-open:bg-hover data-popup-open:text-tinta sm:max-w-xs"
      >
        <Avatar bot={bot} tamanho={18} anel="var(--color-superficie)" />
        <span className="truncate">Para {nomes[bot].nome}</span>
        <Chevron aberto={false} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-[60]">
          <Menu.Popup className="menu-popup w-[min(340px,calc(100vw-32px))] rounded-cartao border border-linha bg-superficie p-1.5 shadow-[0_8px_28px_rgb(15_13_10/0.12),0_1px_3px_rgb(15_13_10/0.06)] outline-none">
            <Menu.RadioGroup value={bot} onValueChange={(b: BotId) => escolha.escolher(b)}>
              {BOT_IDS.map((id) => (
                <Menu.RadioItem
                  key={id}
                  value={id}
                  className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 outline-none select-none data-highlighted:bg-hover"
                >
                  <Avatar bot={id} tamanho={20} anel="var(--color-superficie)" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{nomes[id].nome}</span>
                    <span className="truncate text-xs text-tinta-3">{nomes[id].descricao}</span>
                  </span>
                  <Menu.RadioItemIndicator className="flex-none text-tinta">
                    <Check />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Uma mensagem longa (um briefing colado, um texto inteiro) fica em dez linhas até pedir o resto. */
const LONGA = 700;

function BalaoDoUsuario({ texto }: { texto: string }) {
  const [tudo, setTudo] = useState(false);
  const longa = texto.length > LONGA || texto.split("\n").length > 10;
  return (
    <div className="flex max-w-[80%] flex-col items-end gap-1 self-end">
      <div className="max-w-full rounded-balao border border-linha bg-ativo px-4 py-2.5 whitespace-pre-line [overflow-wrap:anywhere]">
        <p className={longa && !tudo ? "line-clamp-[10]" : undefined}>{texto}</p>
      </div>
      {longa && (
        <button
          type="button"
          aria-expanded={tudo}
          onClick={() => setTudo((t) => !t)}
          className="pressiona cursor-pointer rounded-full px-3 py-1 text-[13px] font-medium text-tinta-2 hover:bg-hover hover:text-tinta"
        >
          {tudo ? "Mostrar menos" : "Mostrar tudo"}
        </button>
      )}
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
  escolha,
  inicial,
  titulo,
  aoMudar,
  aoTerminarTurno,
  abrirMenu,
  estados,
}: Omit<Props, "escolha" | "botDaLista"> & { escolha: EscolhaDoBot; inicial: Mensagem[]; titulo: string | null }) {
  const [transporte] = useState(() => criarTransporte(escolha));
  const bot = useSyncExternalStore(escolha.assinar, escolha.ler);
  const travada = useSyncExternalStore(escolha.assinar, escolha.travada);
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

  useEffect(() => aoMudar({ mensagens: chat.messages, respondendo, bot }), [chat.messages, respondendo, bot, aoMudar]);

  const [porTeclado, setPorTeclado] = useState(false);
  function abrir(tarefaId: string, de: HTMLElement, teclado = false) {
    origem.current = de;
    setPorTeclado(teclado);
    setPainel((atual) => (atual === tarefaId ? null : tarefaId));
  }
  const fechar = useCallback((teclado = false) => {
    setPorTeclado(teclado);
    setPainel(null);
    devolverFoco(origem.current);
  }, []);

  function enviar(t: string) {
    if (!travada && chat.messages.length === 0) navegar(`/c/${id}`, { substituir: true });
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
    if (painel) return fechar(true);
    const ultima = [...delegacoes.keys()].at(-1);
    if (!ultima) return false;
    abrir(ultima, document.querySelector<HTMLElement>(`[data-abre-tarefa="${CSS.escape(ultima)}"]`) ?? (document.activeElement as HTMLElement), true);
  });
  useAtalho("focar-composer", () => document.getElementById("mensagem")?.focus());

  const erro = chat.error ? lerErro(chat.error) : null;
  const ultima = chat.messages.at(-1);
  const turno = ultima?.role === "assistant" ? ultima : null;
  const pensando = respondendo && atividadeDe(turno, true).tipo === "pensando";

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main id="conteudo" onKeyDown={aoTeclar} className="relative flex min-w-0 flex-1 scroll-pt-16 flex-col overflow-y-auto">
        <Cabecalho abrirMenu={abrirMenu} bot={bot} estado={estados[bot]} titulo={titulo} />
        {chat.messages.length === 0 ? (
          <Sugestoes bot={bot} enviar={enviar} />
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
                  <BalaoDoUsuario texto={texto(m)} />
                ) : (
                  trechosDe(m.parts, ehPassoSolto).map((t) =>
                    t.tipo === "passos" ? (
                      <Passos key={t.chave} passos={t.passos} className="text-sm" />
                    ) : (
                      <ParteDoChefe
                        key={t.chave}
                        parte={t.parte}
                        noAr={respondendo && m === ultima}
                        painel={painel}
                        abrir={abrir}
                        responder={responder}
                        respondidas={respondidas.current}
                      />
                    ),
                  )
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
          rotulo={`Mensagem para ${nomes[bot].nome}`}
          placeholder={bot === "chefe" ? "O que vamos postar?" : `Escreva para ${nomes[bot].nome}`}
          extra={chat.messages.length === 0 && !travada ? <SeletorDeBot escolha={escolha} /> : null}
          respondendo={respondendo}
          enviar={enviar}
          parar={() => chat.stop()}
        />
      </main>
      <PainelLateral aberto={!!painel} rotulo="Tarefa" fechar={fechar} instantaneo={porTeclado}>
        {painel && <PainelTarefa tarefaId={painel} parte={delegacoes.get(painel)} fechar={() => fechar()} />}
      </PainelLateral>
    </div>
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
    return parte.text.trim() || digitando ? <Markdown texto={parte.text} digitando={digitando} className="max-w-[68ch] text-corpo" /> : null;
  }
  if (ehDelegacao(parte)) return <CartaoTarefa parte={parte as ParteDelegacao} aberta={painel === tarefaIdDa(parte)} abrir={abrir} />;
  if (ehAprovacao(parte))
    return <CartaoAprovacao parte={parte} respondida={parte.state === "approval-requested" && respondidas.has(parte.approval.id)} responder={responder} />;
  return null;
}

/** As tools do Chefe que não têm cartão próprio viram passos. */
const ehPassoSolto = (p: Parte) => !ehDelegacao(p) && !ehAprovacao(p);

/** O transporte joga o corpo da resposta como mensagem; o servidor manda {erro}. */
function lerErro(e: Error): string {
  try {
    const corpo = JSON.parse(e.message) as { erro?: string };
    if (corpo.erro) return corpo.erro;
  } catch {}
  return e.message ? `Não deu para continuar: ${e.message}` : "Algo deu errado. Tente de novo.";
}
