import { Dialog } from "@base-ui/react/dialog";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiConversas, useApi, useNomesDosBots } from "./api";
import { auth } from "./auth";
import { BOT_IDS } from "./bots";
import { Barra } from "./componentes/Barra";
import { Avisos, fecharAviso, mostrarAviso } from "./componentes/menu/Avisos";
import { criarConversas } from "./componentes/menu/conversas";
import { pilhaDeDesfazer, useTemDesfazer } from "./componentes/menu/desfazer";
import { FolhaAtalhos } from "./componentes/menu/FolhaAtalhos";
import type { AcoesConversa } from "./componentes/menu/MenuConversa";
import { type ModoPaleta, Paleta } from "./componentes/menu/Paleta";
import { DicasProvider } from "./componentes/menu/Teclas";
import { estadosDaEquipe } from "./equipe";
import { DESKTOP, inertizarFora } from "./media";
import { MOLA } from "./movimento";
import { lerRota, navegar, useCaminho, type Rota } from "./rota";
import { atalhoDoBot } from "./teclado/atalhos";
import { useAtalho, useTeclado } from "./teclado/motor";
import { Atividade } from "./telas/Atividade";
import { Biblioteca } from "./telas/Biblioteca";
import Bot from "./telas/Bot";
import { TelaConversa, type Vivo } from "./telas/Conversa";
import { Entrar } from "./telas/Entrar";
import type { ResumoTarefa } from "./tipos";

export function App() {
  const rota = lerRota(useCaminho());
  const sessao = auth.useSession();
  const logado = !!sessao.data;

  useEffect(() => {
    if (sessao.isPending) return;
    if (!logado && rota.tela !== "entrar") navegar("/entrar", { substituir: true });
    if (logado && rota.tela === "entrar") navegar("/", { substituir: true });
  }, [sessao.isPending, logado, rota.tela]);

  if (sessao.isPending) return null;
  if (!sessao.data) return rota.tela === "entrar" ? <Entrar /> : null;
  if (rota.tela === "entrar") return null;
  return <Shell rota={rota} email={sessao.data.user.email} />;
}

const VAZIO: Vivo = { mensagens: [], respondendo: false };

const CHAVE_BARRA = "barra-oculta";
const lerBarraOculta = () => {
  try {
    return localStorage.getItem(CHAVE_BARRA) === "1";
  } catch {
    return false;
  }
};

/** As linhas de conversa da barra que está na tela: no celular, a da gaveta; no desktop, a fixa. */
function linhasVisiveis(): HTMLAnchorElement[] {
  const lista = [...document.querySelectorAll<HTMLElement>("[data-lista-conversas]")].find((l) => l.getClientRects().length > 0);
  return lista ? [...lista.querySelectorAll<HTMLAnchorElement>("a[data-linha-link]")] : [];
}
const linhaComFoco = () => document.activeElement?.closest<HTMLElement>("[data-linha]")?.dataset.linha ?? null;

/** Ao tirar uma linha da lista com o foco nela, o foco vai para a vizinha em vez de cair no body. */
function focarVizinha(id: string) {
  const foco = document.activeElement;
  const linhas = linhasVisiveis();
  const i = linhas.findIndex((a) => a.closest<HTMLElement>("[data-linha]")?.dataset.linha === id);
  if (i < 0 || !(foco === document.body || foco?.closest("[data-linha]") === linhas[i]!.closest("[data-linha]"))) return;
  const vizinha = linhas[i + 1] ?? linhas[i - 1];
  requestAnimationFrame(() => vizinha?.focus());
}

function Shell({ rota, email }: { rota: Exclude<Rota, { tela: "entrar" }>; email: string }) {
  const [novoId, setNovoId] = useState(() => crypto.randomUUID());
  const [vivo, setVivo] = useState<Vivo>(VAZIO);
  const [menu, setMenu] = useState(false);
  const [paleta, setPaleta] = useState<ModoPaleta | null>(null);
  const [folha, setFolha] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [barraOculta, setBarraOculta] = useState(lerBarraOculta);
  // O ⌘\ esconde e mostra na hora; a mola fica para o clique, e não refaz o texto que está chegando a cada quadro.
  const [barraPorTeclado, setBarraPorTeclado] = useState(false);
  const reduzir = useReducedMotion();
  const mostrarBarra = useCallback((mostrar: boolean, teclado = false) => {
    setBarraPorTeclado(teclado);
    setBarraOculta(!mostrar);
    try {
      localStorage.setItem(CHAVE_BARRA, mostrar ? "0" : "1");
    } catch {}
  }, []);
  /** O botão de menu: no celular abre a gaveta; no desktop, mostra a barra que o ⌘\ escondeu. */
  const abrirMenu = useCallback(() => (matchMedia(DESKTOP).matches ? mostrarBarra(true) : setMenu(true)), [mostrarBarra]);
  const fecharMenu = useCallback(() => setMenu(false), []);
  const respondendo = vivo.respondendo;
  const [conversas] = useState(() => criarConversas(apiConversas, mostrarAviso, pilhaDeDesfazer));
  const temDesfazer = useTemDesfazer();
  const lista = useSyncExternalStore(conversas.assinar, conversas.ler);
  const bots = useNomesDosBots();
  const [atividade, relerAtividade] = useApi<ResumoTarefa[]>("/api/atividade", respondendo ? 3000 : 15000);
  const ativas = atividade.estado === "pronto" ? atividade.dados : [];
  const estados = estadosDaEquipe(ativas, vivo.mensagens, respondendo, bots);

  useTeclado();
  useEffect(() => void conversas.carregar(), [conversas]);

  const conversaId = rota.tela === "nova" ? novoId : rota.tela === "conversa" ? rota.id : null;
  const conhecida = (id: string) => !!conversas.achar(id);

  // A conversa de "/" já virou /c/:id; voltar para "/" começa outra.
  const usada = conhecida(novoId) || (rota.tela === "conversa" && rota.id === novoId);
  const usadaRef = useRef(usada);
  usadaRef.current = usada;
  useEffect(() => {
    if (rota.tela === "nova" && usadaRef.current) setNovoId(crypto.randomUUID());
  }, [rota.tela]);

  const novoPedido = useCallback(() => {
    if (usadaRef.current) setNovoId(crypto.randomUUID());
    navegar("/");
  }, []);

  useEffect(() => {
    if (conversaId === null) setVivo(VAZIO);
  }, [conversaId]);

  const aoTerminarTurno = useCallback(() => {
    void conversas.carregar();
    relerAtividade();
  }, [conversas, relerAtividade]);

  // A primeira mensagem de uma conversa nova cria a linha no servidor: a lista relê para mostrá-la.
  const primeira = vivo.mensagens.length > 0 && conversaId !== null && !conhecida(conversaId);
  useEffect(() => {
    if (primeira && respondendo) void conversas.carregar();
  }, [primeira, respondendo, conversas]);

  const acoes: AcoesConversa = {
    renomear: setEditando,
    arquivar(id, arquivar) {
      focarVizinha(id);
      void conversas.arquivar(id, arquivar);
    },
    excluir(id) {
      focarVizinha(id);
      const aberta = id === conversaId;
      void conversas.excluir(id, aberta ? () => navegar(`/c/${id}`) : undefined);
      if (aberta) novoPedido();
    },
  };
  const aoRenomear = (id: string, titulo: string | null) => {
    setEditando(null);
    if (titulo !== null) void conversas.renomear(id, titulo);
  };

  /** A linha focada na barra; sem foco na barra, a conversa aberta. */
  const alvo = () => {
    const id = linhaComFoco() ?? conversaId;
    return id ? (conversas.achar(id) ?? null) : null;
  };
  const andar = (passo: 1 | -1) => () => {
    const linhas = linhasVisiveis();
    if (linhas.length === 0) return false;
    const i = linhas.findIndex((a) => a === document.activeElement);
    const atual = linhas.findIndex((a) => a.getAttribute("aria-current") === "page");
    const destino = i < 0 ? linhas[atual >= 0 ? atual : passo === 1 ? 0 : linhas.length - 1] : linhas[i + passo];
    if (!destino) return true;
    destino.focus();
    destino.scrollIntoView({ block: "nearest" });
  };

  useAtalho("paleta", () => setPaleta((p) => (p ? null : "tudo")));
  useAtalho("buscar", () => setPaleta("conversas"));
  useAtalho("atalhos", () => setFolha(true));
  // Ligado só com algo na pilha: a paleta esconde o Desfazer e o ⌘Z vazio segue para o navegador.
  useAtalho(
    "desfazer",
    () => {
      const chave = pilhaDeDesfazer.desfazerUltimo();
      if (chave === null) return false;
      fecharAviso(chave);
    },
    temDesfazer,
  );
  useAtalho("barra-lateral", () => (matchMedia(DESKTOP).matches ? mostrarBarra(barraOculta, true) : setMenu((m) => !m)));
  useAtalho("config-bot", () => navegar(`/bots/${rota.tela === "bot" ? rota.id : "chefe"}/config`));
  useAtalho("nova-conversa", novoPedido);
  useAtalho("ir-atividade", () => navegar("/atividade"));
  useAtalho("ir-biblioteca", () => navegar("/biblioteca"));
  for (const id of BOT_IDS) useAtalho(atalhoDoBot(id), () => navegar(`/bots/${id}`));
  useAtalho("lista-proxima", andar(1));
  useAtalho("lista-anterior", andar(-1));
  useAtalho("lista-abrir", () => {
    const a = document.activeElement;
    if (!(a instanceof HTMLAnchorElement) || !a.matches("[data-linha-link]")) return false;
    a.click();
  });
  useAtalho("conversa-renomear", () => {
    const c = alvo();
    if (!c || !document.querySelector(`[data-linha="${CSS.escape(c.id)}"]`)) return false;
    setEditando(c.id);
  });
  useAtalho("conversa-arquivar", () => {
    const c = alvo();
    if (!c) return false;
    acoes.arquivar(c.id, c.arquivadaEm === null);
  });
  useAtalho("conversa-excluir", () => {
    const c = alvo();
    if (!c) return false;
    acoes.excluir(c.id);
  });

  const barra = (aoNavegar: () => void) => (
    <Barra
      estados={estados}
      ativas={lista.ativas}
      arquivadas={lista.arquivadas}
      ativa={conversaId}
      editando={editando}
      aoRenomear={aoRenomear}
      acoes={acoes}
      emAtividade={ativas.length}
      telaAtual={location.pathname}
      email={email}
      bots={bots}
      novoPedido={novoPedido}
      abrirPaleta={() => (aoNavegar(), setPaleta("tudo"))}
      abrirAtalhos={() => (aoNavegar(), setFolha(true))}
      aoNavegar={aoNavegar}
    />
  );

  return (
    <DicasProvider>
      <div data-barra={barraOculta ? "oculta" : undefined} className="group/shell flex h-dvh overflow-hidden">
        <motion.div
          initial={false}
          animate={{ width: barraOculta ? 0 : "auto" }}
          transition={reduzir || barraPorTeclado ? { duration: 0 } : MOLA}
          inert={barraOculta}
          className={`hidden flex-none overflow-hidden border-r md:block ${barraOculta ? "border-transparent" : "border-linha"}`}
        >
          <div className="h-full w-[clamp(232px,20vw,272px)]">{barra(() => {})}</div>
        </motion.div>
        <Gaveta aberta={menu} fechar={fecharMenu}>
          {barra(fecharMenu)}
        </Gaveta>
        {conversaId !== null ? (
          <TelaConversa
            key={conversaId}
            id={conversaId}
            nova={conversaId === novoId}
            aoMudar={setVivo}
            aoTerminarTurno={aoTerminarTurno}
            abrirMenu={abrirMenu}
            estadoDoChefe={estados.chefe}
          />
        ) : rota.tela === "atividade" ? (
          <Atividade abrirMenu={abrirMenu} />
        ) : rota.tela === "biblioteca" ? (
          <Biblioteca abrirMenu={abrirMenu} />
        ) : rota.tela === "bot" ? (
          <Bot key={rota.id} id={rota.id} aba={rota.aba} abrirMenu={abrirMenu} />
        ) : (
          <main id="conteudo" className="grid flex-1 place-items-center px-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <h1 className="text-lg font-semibold">Página não encontrada</h1>
              <a
                href="/"
                onClick={(e) => (e.preventDefault(), novoPedido())}
                className="pressiona rounded-full bg-tinta px-4 py-2 font-medium text-sobre-tinta"
              >
                Novo pedido
              </a>
            </div>
          </main>
        )}
      </div>
      <Paleta
        modo={paleta}
        fechar={() => setPaleta(null)}
        conversas={[...lista.ativas, ...lista.arquivadas]}
        aberta={conversaId ? (conversas.achar(conversaId) ?? null) : null}
        acoes={acoes}
        bots={bots}
      />
      <FolhaAtalhos aberta={folha} fechar={() => setFolha(false)} bots={bots} />
      <Avisos />
    </DicasProvider>
  );
}

/**
 * A barra lateral no celular, num Dialog do Base UI: o fundo fica inerte, o Esc fecha e o foco
 * volta para o botão de menu. Entra e sai pela esquerda (estilo.css, .gaveta).
 */
function Gaveta({ aberta, fechar, children }: { aberta: boolean; fechar: () => void; children: React.ReactNode }) {
  // O modal do Base UI deixa o Tab escapar pelo body na segunda volta; com o resto inerte, não há para onde ir.
  const [popup, setPopup] = useState<HTMLElement | null>(null);
  useEffect(() => (aberta && popup ? inertizarFora(popup) : undefined), [aberta, popup]);
  return (
    <Dialog.Root open={aberta} onOpenChange={(a) => !a && fechar()}>
      <Dialog.Portal>
        <Dialog.Backdrop data-fecha-painel className="gaveta-fundo fixed inset-0 z-50 bg-tinta/20 md:hidden" />
        <Dialog.Popup
          ref={setPopup}
          aria-label="Menu"
          className="gaveta fixed inset-y-0 left-0 z-50 w-[min(85vw,300px)] shadow-[0_0_40px_rgb(15_13_10/0.12)] outline-none md:hidden"
        >
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
