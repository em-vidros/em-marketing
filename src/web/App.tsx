import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "./api";
import { auth } from "./auth";
import { Barra } from "./componentes/Barra";
import { estadosDaEquipe } from "./equipe";
import { MOLA, MOLA_REDUZIDA } from "./movimento";
import { lerRota, navegar, useCaminho, type Rota } from "./rota";
import { Atividade } from "./telas/Atividade";
import { Biblioteca } from "./telas/Biblioteca";
import { TelaConversa, type Vivo } from "./telas/Conversa";
import { Entrar } from "./telas/Entrar";
import type { Conversa, ResumoTarefa } from "./tipos";

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

function Shell({ rota, email }: { rota: Exclude<Rota, { tela: "entrar" }>; email: string }) {
  const [novoId, setNovoId] = useState(() => crypto.randomUUID());
  const [vivo, setVivo] = useState<Vivo>(VAZIO);
  const [menu, setMenu] = useState(false);
  const abrirMenu = useCallback(() => setMenu(true), []);
  const fecharMenu = useCallback(() => setMenu(false), []);
  const respondendo = vivo.respondendo;
  const [conversas, relerConversas] = useApi<Conversa[]>("/api/conversas");
  const [atividade, relerAtividade] = useApi<ResumoTarefa[]>("/api/atividade", respondendo ? 3000 : 15000);
  const ativas = atividade.estado === "pronto" ? atividade.dados : [];
  const estados = estadosDaEquipe(ativas, vivo.mensagens, respondendo);

  const conversaId = rota.tela === "nova" ? novoId : rota.tela === "conversa" ? rota.id : null;
  const listadas = conversas.estado === "pronto" ? conversas.dados : [];

  // A conversa de "/" já virou /c/:id; voltar para "/" começa outra.
  const usada = listadas.some((c) => c.id === novoId) || (rota.tela === "conversa" && rota.id === novoId);
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
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        novoPedido();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [novoPedido]);

  useEffect(() => {
    if (conversaId === null) setVivo(VAZIO);
  }, [conversaId]);

  const aoTerminarTurno = useCallback(() => {
    relerConversas();
    relerAtividade();
  }, [relerConversas, relerAtividade]);

  // A primeira mensagem de uma conversa nova cria a linha no servidor: a lista relê para mostrá-la.
  const primeira = vivo.mensagens.length > 0 && !listadas.some((c) => c.id === conversaId);
  useEffect(() => {
    if (primeira && respondendo) relerConversas();
  }, [primeira, respondendo, relerConversas]);

  const barra = (aoNavegar: () => void) => (
    <Barra
      estados={estados}
      conversas={listadas}
      ativa={conversaId}
      emAtividade={ativas.length}
      telaAtual={location.pathname}
      email={email}
      novoPedido={novoPedido}
      aoNavegar={aoNavegar}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden w-[clamp(232px,20vw,272px)] flex-none border-r border-linha md:block">{barra(() => {})}</div>
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
  );
}

/** A barra lateral no celular: entra pela esquerda sobre a conversa, que fica inerte. */
function Gaveta({ aberta, fechar, children }: { aberta: boolean; fechar: () => void; children: React.ReactNode }) {
  const reduzir = useReducedMotion();
  const painel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberta) return;
    const anterior = document.activeElement as HTMLElement | null;
    painel.current?.querySelector<HTMLElement>("button, a")?.focus();
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      anterior?.focus();
    };
  }, [aberta, fechar]);
  const fora = reduzir ? { opacity: 0 } : { transform: "translateX(-100%)" };
  return (
    <AnimatePresence>
      {aberta && (
        <div className="fixed inset-0 z-50 md:hidden">
          <motion.div
            aria-hidden="true"
            onClick={fechar}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={MOLA_REDUZIDA}
            className="absolute inset-0 bg-tinta/20"
          />
          <motion.div
            ref={painel}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            initial={fora}
            animate={{ opacity: 1, transform: "translateX(0%)" }}
            exit={fora}
            transition={reduzir ? MOLA_REDUZIDA : MOLA}
            className="absolute inset-y-0 left-0 w-[min(85vw,300px)] shadow-[0_0_40px_rgb(15_13_10/0.12)]"
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
