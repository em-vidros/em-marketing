import { useEffect, useRef, useState } from "react";
import type { NomesDosBots } from "../api";
import { auth } from "../auth";
import { BOT_IDS } from "../bots";
import type { EstadosDaEquipe } from "../equipe";
import { aoClicarLink } from "../rota";
import { ariaDe, atalhoDoBot, ehMac } from "../teclado/atalhos";
import type { Conversa } from "../tipos";
import { Avatar } from "./Avatar";
import { Expansivel } from "./Expansivel";
import { type AcoesConversa, BotaoAcoes, MenuDeContexto } from "./menu/MenuConversa";
import { Dica, Teclas } from "./menu/Teclas";

const diaLocal = (d: Date) => d.toLocaleDateString("sv-SE");
/** atualizadaEm vem do SQLite em UTC, sem fuso: "2026-10-13 14:02:11". */
const ehDeHoje = (c: Conversa) => diaLocal(new Date(`${c.atualizadaEm.replace(" ", "T")}Z`)) === diaLocal(new Date());

const CHAVE_ARQUIVADAS = "barra:arquivadas-aberta";
const lerAberta = () => {
  try {
    return localStorage.getItem(CHAVE_ARQUIVADAS) === "1";
  } catch {
    return false;
  }
};

export interface PropsLista {
  ativa: string | null;
  editando: string | null;
  aoRenomear: (id: string, titulo: string | null) => void;
  acoes: AcoesConversa;
  aoNavegar: () => void;
}

/** O título vira campo no lugar: Enter e blur salvam, Esc cancela. */
function CampoTitulo({ c, aoRenomear }: { c: Conversa; aoRenomear: PropsLista["aoRenomear"] }) {
  const campo = useRef<HTMLInputElement>(null);
  const feito = useRef(false);
  useEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);
  const terminar = (titulo: string | null) => {
    if (feito.current) return;
    feito.current = true;
    aoRenomear(c.id, titulo);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-linha="${CSS.escape(c.id)}"] a`)?.focus());
  };
  return (
    <input
      ref={campo}
      defaultValue={c.titulo}
      aria-label={`Renomear ${c.titulo}`}
      maxLength={120}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          terminar(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          terminar(null);
        }
      }}
      onBlur={(e) => terminar(e.currentTarget.value)}
      className="h-8 min-w-0 flex-1 rounded-[9px] bg-superficie px-2 text-base text-tinta shadow-[inset_0_0_0_1px_var(--color-borda-campo)] outline-none sm:text-sm"
    />
  );
}

function Linha({ c, ativa, editando, aoRenomear, acoes, aoNavegar, tabulavel }: PropsLista & { c: Conversa; tabulavel: boolean }) {
  return (
    <MenuDeContexto conversa={c} acoes={acoes}>
      <div data-linha={c.id} data-atual={c.id === ativa || undefined} className="linha group/linha relative flex min-h-10 items-center gap-1 rounded-item pr-1">
        {editando === c.id ? (
          <div className="flex min-w-0 flex-1 items-center pl-1.5">
            <CampoTitulo c={c} aoRenomear={aoRenomear} />
          </div>
        ) : (
          <a
            href={`/c/${c.id}`}
            data-linha-link
            tabIndex={tabulavel ? 0 : -1}
            aria-current={c.id === ativa ? "page" : undefined}
            onClick={(e) => (aoClicarLink(e), aoNavegar())}
            className="flex min-h-10 min-w-0 flex-1 items-center gap-2 truncate rounded-item pl-3 text-tinta-2 outline-none group-data-atual/linha:text-tinta"
          >
            {/* A conversa direta com um especialista leva o rosto dele; a do Chefe, que é a maioria, não. */}
            {c.botId !== "chefe" && <Avatar bot={c.botId} tamanho={16} />}
            <span className="truncate">{c.titulo}</span>
          </a>
        )}
        {editando !== c.id && <BotaoAcoes conversa={c} acoes={acoes} />}
      </div>
    </MenuDeContexto>
  );
}

function Grupo({ titulo, conversas, alvoTab, ...p }: PropsLista & { titulo: string; conversas: readonly Conversa[]; alvoTab: string | undefined }) {
  if (conversas.length === 0) return null;
  return (
    <section aria-label={titulo} className="flex flex-col gap-px">
      <h2 className="px-3 pb-1.5 text-xs font-normal text-tinta-3">{titulo}</h2>
      {conversas.map((c) => (
        <Linha key={c.id} c={c} tabulavel={c.id === alvoTab} {...p} />
      ))}
    </section>
  );
}

const linkDe = (atual: boolean) =>
  `linha flex min-h-10 items-center gap-2.5 rounded-item px-3 ${atual ? "bg-ativo text-tinta" : "text-tinta-2"}`;

export function Barra({
  estados,
  ativas,
  arquivadas,
  emAtividade,
  telaAtual,
  email,
  bots,
  novoPedido,
  abrirPaleta,
  abrirAtalhos,
  ...lista
}: PropsLista & {
  estados: EstadosDaEquipe;
  ativas: readonly Conversa[];
  arquivadas: readonly Conversa[];
  emAtividade: number;
  telaAtual: string;
  email: string;
  bots: NomesDosBots;
  novoPedido: () => void;
  abrirPaleta: () => void;
  abrirAtalhos: () => void;
}) {
  const [verArquivadas, setVerArquivadas] = useState(lerAberta);
  const alternarArquivadas = () => {
    setVerArquivadas((v) => {
      try {
        localStorage.setItem(CHAVE_ARQUIVADAS, v ? "0" : "1");
      } catch {}
      return !v;
    });
  };
  const hoje = ativas.filter(ehDeHoje);
  const antes = ativas.filter((c) => !ehDeHoje(c));
  const arquivadaAberta = arquivadas.some((c) => c.id === lista.ativa);
  // Abrir uma arquivada (pela paleta, por exemplo) abre a seção para a linha aparecer.
  useEffect(() => {
    if (arquivadaAberta) setVerArquivadas(true);
  }, [arquivadaAberta]);
  const mostrarArquivadas = verArquivadas;
  // Uma linha só entra no Tab: a aberta, ou a primeira. J/K e as setas andam pelas outras.
  const visiveis = [...hoje, ...antes, ...(mostrarArquivadas ? arquivadas : [])];
  const alvoTab = visiveis.find((c) => c.id === lista.ativa)?.id ?? visiveis[0]?.id;
  const { aoNavegar } = lista;

  return (
    <nav aria-label="Navegação" className="flex h-full flex-col gap-5 overflow-hidden bg-painel py-3.5">
      <div className="flex flex-col gap-5 px-2.5">
        <div className="flex items-center gap-2.5 px-2.5 py-1">
          <img src="/logo/em-simbolo.svg" alt="" width={26} height={14} className="h-3.5 w-auto" />
          <span className="text-[15px] font-semibold tracking-[-0.015em]">EM Marketing</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => (novoPedido(), aoNavegar())}
            aria-keyshortcuts={ariaDe("nova-conversa", ehMac)}
            className="pressiona flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-full border border-linha-forte px-3 font-medium hover:bg-hover"
          >
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 2.5l2 2L7 11l-2.7.7L5 9z" />
              <path d="M13 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3.5" />
            </svg>
            Novo pedido
            <span className="ml-auto max-md:hidden">
              <Teclas atalho="nova-conversa" />
            </span>
          </button>
          <Dica rotulo="Buscar e comandos" atalho="paleta" lado="bottom">
            <button
              type="button"
              onClick={abrirPaleta}
              aria-label="Buscar e comandos"
              aria-keyshortcuts={ariaDe("paleta", ehMac)}
              className="pressiona grid size-10 flex-none cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hover hover:text-tinta"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="7" cy="7" r="4.75" />
                <path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
            </button>
          </Dica>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-2.5">
        <section aria-label="Equipe" className="flex flex-col gap-px">
          <h2 className="px-3 pb-1.5 text-xs font-normal text-tinta-3">Equipe</h2>
          <ul className="flex flex-col gap-px">
            {BOT_IDS.map((id) => {
              const caminho = `/bots/${id}`;
              const atual = telaAtual === caminho || telaAtual.startsWith(`${caminho}/`);
              return (
                <li key={id}>
                  <Dica rotulo={`Abrir ${bots[id].nome}`} atalho={atalhoDoBot(id)}>
                    <a href={caminho} aria-current={atual ? "page" : undefined} onClick={(e) => (aoClicarLink(e), aoNavegar())} className={`${linkDe(atual)} py-1.5`}>
                      <Avatar bot={id} tamanho={26} estado={estados[id].tipo} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate leading-tight font-medium text-tinta">{bots[id].nome}</span>
                        <span className="truncate text-xs text-tinta-3">{estados[id].texto}</span>
                      </span>
                    </a>
                  </Dica>
                </li>
              );
            })}
          </ul>
        </section>

        <div data-lista-conversas className="flex flex-col gap-5">
          <Grupo titulo="Hoje" conversas={hoje} alvoTab={alvoTab} {...lista} />
          <Grupo titulo="Antes" conversas={antes} alvoTab={alvoTab} {...lista} />
          {arquivadas.length > 0 && (
            <section aria-label="Arquivadas" className="flex flex-col gap-px">
              <button
                type="button"
                aria-expanded={mostrarArquivadas}
                onClick={alternarArquivadas}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-item px-3 text-xs text-tinta-3 hover:text-tinta"
              >
                Arquivadas
                <span className="tabular font-mono">{arquivadas.length}</span>
                <svg
                  aria-hidden="true"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform duration-150 ${mostrarArquivadas ? "rotate-90" : ""}`}
                >
                  <path d="M3.5 2l3 3-3 3" />
                </svg>
              </button>
              <Expansivel aberto={mostrarArquivadas} className="flex flex-col gap-px">
                {arquivadas.map((c) => (
                  <Linha key={c.id} c={c} tabulavel={c.id === alvoTab} {...lista} />
                ))}
              </Expansivel>
            </section>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-px px-2.5">
        <Dica rotulo="Atividade" atalho="ir-atividade">
          <a
            href="/atividade"
            aria-current={telaAtual === "/atividade" ? "page" : undefined}
            onClick={(e) => (aoClicarLink(e), aoNavegar())}
            className={`${linkDe(telaAtual === "/atividade")} justify-between`}>
            Atividade
            {emAtividade > 0 && <span className="tabular font-mono text-xs text-tinta">{emAtividade}</span>}
          </a>
        </Dica>
        <Dica rotulo="Biblioteca" atalho="ir-biblioteca">
          <a
            href="/biblioteca"
            aria-current={telaAtual === "/biblioteca" ? "page" : undefined}
            onClick={(e) => (aoClicarLink(e), aoNavegar())}
            className={linkDe(telaAtual === "/biblioteca")}>
            Biblioteca
          </a>
        </Dica>
        <Dica rotulo="Calendário" atalho="ir-calendario">
          <a
            href="/calendario"
            aria-current={telaAtual === "/calendario" ? "page" : undefined}
            onClick={(e) => (aoClicarLink(e), aoNavegar())}
            className={linkDe(telaAtual === "/calendario")}>
            Calendário
          </a>
        </Dica>
        <button type="button" onClick={abrirAtalhos} aria-keyshortcuts={ariaDe("atalhos", ehMac)} className={`${linkDe(false)} cursor-pointer justify-between`}>
          Atalhos de teclado
          <Teclas atalho="atalhos" />
        </button>
        <div className="mt-2 flex items-center gap-2 border-t border-linha px-3 pt-3 text-xs text-tinta-3">
          <span className="min-w-0 flex-1 truncate">{email}</span>
          <button type="button" onClick={() => auth.signOut()} className="h-8 cursor-pointer rounded-full px-2.5 text-tinta-2 hover:bg-hover hover:text-tinta">
            Sair
          </button>
        </div>
      </div>
    </nav>
  );
}
