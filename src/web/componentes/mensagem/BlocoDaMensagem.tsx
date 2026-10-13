import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import { AnimatePresence, motion, type Transition, useIsPresent, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { MOLA, MOLA_REDUZIDA } from "../../movimento";
import { type AtalhoId, ariaDe, ehMac } from "../../teclado/atalhos";
import { Dica, Teclas } from "../menu/Teclas";
import { Troca } from "../Troca";
import { casa } from "./teclas";

/** O espaço entre mensagens no transcript (gap-8). Quem sai encolhe a altura e devolve este espaço, para nada pular no fim. */
const VAO = 32;

/** Os mesmos tempos do Expansivel: sai em 200 ms com ease-out forte. */
const SAIDA: Transition = { duration: 0.2, ease: [0.23, 1, 0.32, 1] };
const TROCA: Transition = { duration: 0.15, ease: [0.23, 1, 0.32, 1] };

/** Paleta, folha de atalhos e menus (teclado/motor.ts). */
const ISOLADO = '[data-teclado="isolado"]';

const NOTA_DA_EDICAO = "Salvar apaga as respostas depois desta mensagem e pede uma nova.";

interface Acao {
  chave: "editar" | "copiar" | "refazer" | "apagar";
  rotulo: string;
  icone: ReactNode;
  atalho?: AtalhoId;
  fazer: () => void;
  perigo?: true;
}

export interface PropsDoBloco {
  id: string;
  papel: "user" | "assistant";
  /** O nome do bloco para leitor de tela: "Sua mensagem", "Resposta de Chefe". */
  rotulo: string;
  /** O item da navegação por setas que recebe o Tab (roving tabindex). */
  atual: boolean;
  /** Chegou agora pelo stream: entra subindo. Uma que já estava na conversa aparece parada. */
  nova: boolean;
  /** Voltou por um Desfazer: abre na altura, o caminho inverso de quando saiu. */
  voltando: boolean;
  /** Enquanto o bot responde, editar, refazer e apagar esperam; o motivo vira a dica do botão. */
  bloqueio: string | null;
  texto: string;
  /** O editor está aberto no lugar do balão: Salvar e Cancelar substituem as ações. */
  editando: boolean;
  editar?: () => void;
  refazer?: () => void;
  apagar: () => void;
  copiada: () => void;
  aoFocar: () => void;
  children: ReactNode;
}

/**
 * Uma mensagem do transcript: o conteúdo, as ações que aparecem no hover ou no foco (como no
 * Grok e no Linear) e o mesmo menu no clique direito, com as teclas ao lado.
 */
export function BlocoDaMensagem(p: PropsDoBloco) {
  const presente = useIsPresent();
  const reduzir = useReducedMotion();
  const [abrindo, setAbrindo] = useState(p.voltando);
  const [copiou, setCopiou] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!copiou) return;
    const t = setTimeout(() => setCopiou(false), 1500);
    return () => clearTimeout(t);
  }, [copiou]);

  const copiar = () => {
    void navigator.clipboard.writeText(p.texto).then(() => {
      setCopiou(true);
      p.copiada();
    });
  };
  const acoes: Acao[] = [
    ...(p.editar ? [{ chave: "editar", rotulo: "Editar", icone: <Lapis />, atalho: "mensagem-editar", fazer: p.editar } as const] : []),
    ...(p.texto
      ? [
          {
            chave: "copiar",
            rotulo: copiou ? "Copiada" : "Copiar",
            icone: <Troca chave={copiou ? "ok" : "copiar"}>{copiou ? <Certo /> : <Copiar />}</Troca>,
            fazer: copiar,
          } as const,
        ]
      : []),
    ...(p.refazer ? [{ chave: "refazer", rotulo: "Refazer resposta", icone: <Refazer />, atalho: "mensagem-refazer", fazer: p.refazer } as const] : []),
    { chave: "apagar", rotulo: "Apagar", icone: <Lixeira />, atalho: "mensagem-apagar", fazer: p.apagar, perigo: true } as const,
  ];
  // Copiar não muda a conversa, então vale enquanto o bot responde.
  const bloqueada = (a: Acao) => (a.chave === "copiar" ? null : p.bloqueio);

  const altura = reduzir ? { duration: 0 } : MOLA;
  return (
    <motion.article
      data-mensagem={p.id}
      data-saindo={presente ? undefined : ""}
      tabIndex={p.atual ? 0 : -1}
      aria-label={p.rotulo}
      onFocus={p.aoFocar}
      initial={
        p.voltando ? { height: 0, opacity: 0, marginBottom: -VAO } : p.nova ? (reduzir ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)" }) : false
      }
      animate={{
        height: "auto",
        opacity: 1,
        marginBottom: 0,
        transform: "translateY(0px)",
        transition: p.voltando ? { height: altura, marginBottom: altura, opacity: SAIDA } : reduzir ? MOLA_REDUZIDA : MOLA,
      }}
      exit={{
        height: 0,
        opacity: 0,
        marginBottom: -VAO,
        // Com movimento reduzido o conteúdo some num fade e o espaço fecha de uma vez, depois.
        transition: reduzir ? { opacity: SAIDA, height: { duration: 0, delay: SAIDA.duration }, marginBottom: { duration: 0, delay: SAIDA.duration } } : SAIDA,
      }}
      onAnimationComplete={() => setAbrindo(false)}
      className={`mensagem relative flex scroll-my-6 flex-col gap-4 outline-offset-6 ${p.papel === "user" ? "ml-auto max-w-[80%] items-end rounded-[30px]" : "rounded-cartao"} ${
        !presente || abrindo ? "pointer-events-none overflow-hidden" : ""
      }`}
    >
      <ContextMenu.Root open={menu} onOpenChange={setMenu}>
        <ContextMenu.Trigger
          render={<div className={`flex min-w-0 flex-col gap-4 ${p.papel === "user" ? "items-end" : ""}`} />}
          // Com texto selecionado ali dentro, o clique direito é para copiar a seleção: fica o menu do navegador.
          onContextMenuCapture={(e) => {
            const sel = getSelection();
            if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) e.stopPropagation();
          }}
        >
          {p.children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="z-[60]">
            <MenuDeAcoes acoes={acoes} bloqueada={bloqueada} motivo={p.bloqueio} fechar={() => setMenu(false)} />
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {!p.editando && (
        <div className={`acoes-mensagem absolute top-full mt-0.5 flex gap-0.5 ${p.papel === "user" ? "right-0" : "-left-1.5"}`}>
          {acoes.map((a) => {
            const motivo = bloqueada(a);
            return (
              <Dica key={a.chave} rotulo={motivo ?? a.rotulo} atalho={motivo ? undefined : a.atalho} lado="bottom">
                <button
                  type="button"
                  tabIndex={p.atual ? 0 : -1}
                  aria-label={a.rotulo}
                  aria-disabled={motivo ? true : undefined}
                  aria-keyshortcuts={a.atalho ? ariaDe(a.atalho, ehMac) : undefined}
                  onClick={() => !motivo && a.fazer()}
                  className="pressiona grid size-7 cursor-pointer place-items-center rounded-[9px] text-tinta-3 hover:bg-hover hover:text-tinta aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-tinta-3"
                >
                  {a.icone}
                </button>
              </Dica>
            );
          })}
        </div>
      )}
    </motion.article>
  );
}

/** O menu do clique direito. Apertar a tecla de um item com o menu aberto roda o item, como no MenuConversa. */
function MenuDeAcoes({
  acoes,
  bloqueada,
  motivo,
  fechar,
}: {
  acoes: Acao[];
  bloqueada: (a: Acao) => string | null;
  motivo: string | null;
  fechar: () => void;
}) {
  const livres = acoes.filter((a) => !bloqueada(a));
  return (
    <Menu.Popup
      data-teclado="isolado"
      // Quem roda um item cuida do foco (o editor, a vizinha da apagada); o gatilho é um div sem foco.
      finalFocus={false}
      onKeyDownCapture={(e) => {
        const a = livres.find((i) => i.atalho && casa(i.atalho, e));
        if (!a) return;
        e.preventDefault();
        e.stopPropagation();
        fechar();
        a.fazer();
      }}
      className="menu-popup min-w-52 rounded-cartao border border-linha bg-superficie p-1.5 shadow-[0_8px_28px_rgb(15_13_10/0.12),0_1px_3px_rgb(15_13_10/0.06)] outline-none"
    >
      {acoes.map((a) => (
        <Menu.Item
          key={a.chave}
          disabled={!!bloqueada(a)}
          onClick={a.fazer}
          className={`flex h-9 cursor-pointer items-center gap-3 rounded-[10px] px-2.5 outline-none select-none data-disabled:cursor-default data-disabled:opacity-50 data-highlighted:bg-hover ${a.perigo ? "text-erro" : "text-tinta"}`}
        >
          <span className="grid w-4 flex-none place-items-center" aria-hidden="true">
            {a.icone}
          </span>
          <span className="flex-1">{a.rotulo}</span>
          {a.atalho && <Teclas atalho={a.atalho} />}
        </Menu.Item>
      ))}
      {livres.length < acoes.length && <p className="px-2.5 pt-1 pb-1.5 text-xs text-tinta-3">{motivo}</p>}
    </Menu.Popup>
  );
}

/**
 * O balão vira o campo no mesmo lugar e na mesma largura. Enter salva, Shift+Enter quebra a linha,
 * Esc cancela. O erro do servidor aparece embaixo, no lugar da nota.
 */
export function EditorDeMensagem({
  inicial,
  largura,
  erro,
  bloqueio,
  salvar,
  cancelar,
}: {
  inicial: string;
  largura: number;
  erro: string | null;
  bloqueio: string | null;
  salvar: (texto: string) => void;
  cancelar: () => void;
}) {
  const [texto, setTexto] = useState(inicial);
  const campo = useRef<HTMLTextAreaElement>(null);
  // Saindo (salvou ou cancelou), o editor solta o foco para quem o pedir.
  const vivo = useRef(true);
  vivo.current = useIsPresent();
  const vazio = texto.trim().length === 0;
  const parado = !!bloqueio || vazio;

  // Aberto pela paleta ou por um menu, o foco vem depois que eles somem. Ao desmontar, eles devolvem o foco a quem os
  // abriu, às vezes um instante depois; nos primeiros 200 ms o editor pega o foco de volta.
  useEffect(() => {
    const c = campo.current;
    if (!c) return;
    let quadro = 0;
    let ate = 0;
    const focar = () => {
      c.focus({ preventScroll: true });
      c.setSelectionRange(c.value.length, c.value.length);
    };
    const segurar = () => vivo.current && performance.now() < ate && (quadro = requestAnimationFrame(focar));
    const esperar = () => {
      if (document.querySelector(ISOLADO)) return void (quadro = requestAnimationFrame(esperar));
      ate = performance.now() + 200;
      focar();
    };
    c.addEventListener("blur", segurar);
    esperar();
    return () => {
      cancelAnimationFrame(quadro);
      c.removeEventListener("blur", segurar);
    };
  }, []);

  const enviar = () => !parado && salvar(texto.trim());
  return (
    <div className="flex max-w-full flex-col gap-2" style={{ width: `max(${largura}px, min(100%, 20rem))` }}>
      <div className="rounded-balao border border-borda-campo bg-superficie px-4 py-2.5 transition-[border-color] duration-150 focus-within:border-tinta">
        <label htmlFor="editar-mensagem" className="sr-only">
          Editar mensagem
        </label>
        <textarea
          ref={campo}
          id="editar-mensagem"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-invalid={erro ? true : undefined}
          aria-describedby="nota-da-edicao"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              enviar();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelar();
            }
          }}
          rows={1}
          className="block max-h-[50dvh] min-h-6 w-full resize-none bg-transparent text-base/6 text-tinta outline-none [field-sizing:content] focus-visible:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-start justify-end gap-x-3 gap-y-2">
        <p
          id="nota-da-edicao"
          className={`min-w-48 flex-1 pt-1.5 text-xs text-pretty ${erro ? "text-erro" : "text-tinta-3"}`}
          role={erro ? "alert" : undefined}
        >
          {erro ?? bloqueio ?? NOTA_DA_EDICAO}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={cancelar}
            className="pressiona flex h-8 cursor-pointer items-center gap-2 rounded-full bg-linha px-3 text-[13px] font-medium hover:bg-linha-forte"
          >
            Cancelar
            <Teclas tecla="escape" />
          </button>
          <button
            type="button"
            aria-disabled={parado ? true : undefined}
            onClick={enviar}
            className="pressiona flex h-8 cursor-pointer items-center gap-2 rounded-full bg-tinta px-3 text-[13px] font-medium text-sobre-tinta aria-disabled:cursor-default aria-disabled:opacity-50"
          >
            Salvar
            <Teclas tecla="enter" tom="escuro" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** O balão e o editor trocam num crossfade curto, um por cima do outro. */
export function TrocaDeEdicao({ editando, children }: { editando: boolean; children: [ReactNode, ReactNode] }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={editando ? "editor" : "balao"}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={TROCA}
        className="flex max-w-full flex-col items-end"
      >
        {editando ? children[1] : children[0]}
      </motion.div>
    </AnimatePresence>
  );
}

const Svg = ({ children }: { children: ReactNode }) => (
  <svg
    aria-hidden="true"
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);
const Lapis = () => (
  <Svg>
    <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    <path d="M9 4l3 3" />
  </Svg>
);
const Copiar = () => (
  <Svg>
    <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
    <path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
  </Svg>
);
const Certo = () => (
  <Svg>
    <path d="M3 8.5l3 3 7-7" />
  </Svg>
);
const Refazer = () => (
  <Svg>
    <path d="M13 3v3.5H9.5" />
    <path d="M12.6 6.5A5 5 0 1 0 13 9" />
  </Svg>
);
const Lixeira = () => (
  <Svg>
    <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1.5 1.5 0 0 0 1.5 1.4h3.6a1.5 1.5 0 0 0 1.5-1.4L12 4" />
  </Svg>
);
