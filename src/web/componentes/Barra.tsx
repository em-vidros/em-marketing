import { auth } from "../auth";
import { BOT_IDS, BOTS } from "../bots";
import type { EstadosDaEquipe } from "../equipe";
import { aoClicarLink } from "../rota";
import type { Conversa } from "../tipos";
import { Avatar } from "./Avatar";

const diaLocal = (d: Date) => d.toLocaleDateString("sv-SE");
/** atualizadaEm vem do SQLite em UTC, sem fuso: "2026-10-13 14:02:11". */
const ehDeHoje = (c: Conversa) => diaLocal(new Date(`${c.atualizadaEm.replace(" ", "T")}Z`)) === diaLocal(new Date());

function Grupo({
  titulo,
  conversas,
  ativa,
  aoNavegar,
}: {
  titulo: string;
  conversas: Conversa[];
  ativa: string | null;
  aoNavegar: () => void;
}) {
  if (conversas.length === 0) return null;
  return (
    <section aria-label={titulo} className="flex flex-col gap-px">
      <h2 className="px-3 pb-1.5 text-xs font-normal text-tinta-4">{titulo}</h2>
      {conversas.map((c) => (
        <a
          key={c.id}
          href={`/c/${c.id}`}
          aria-current={c.id === ativa ? "page" : undefined}
          onClick={(e) => (aoClicarLink(e), aoNavegar())}
          className="truncate rounded-item px-3 py-[7px] text-tinta-2 transition-colors duration-150 hover:bg-hover aria-[current=page]:bg-ativo aria-[current=page]:text-tinta"
        >
          {c.titulo}
        </a>
      ))}
    </section>
  );
}

export function Barra({
  estados,
  conversas,
  ativa,
  emAtividade,
  telaAtual,
  email,
  novoPedido,
  aoNavegar,
}: {
  estados: EstadosDaEquipe;
  conversas: Conversa[];
  ativa: string | null;
  emAtividade: number;
  telaAtual: string;
  email: string;
  novoPedido: () => void;
  /** No celular a barra é uma gaveta: fecha depois de navegar. */
  aoNavegar: () => void;
}) {
  const hoje = conversas.filter(ehDeHoje);
  const antes = conversas.filter((c) => !ehDeHoje(c));
  const link = (caminho: string) =>
    `flex items-center justify-between rounded-item px-3 py-[7px] transition-colors duration-150 hover:bg-hover ${telaAtual === caminho ? "bg-ativo text-tinta" : "text-tinta-2"}`;

  return (
    <nav aria-label="Navegação" className="flex h-full flex-col gap-5 overflow-y-auto overscroll-contain bg-painel px-2.5 py-3.5">
      <div className="flex items-center gap-2.5 px-2.5 py-1">
        <img src="/logo/em-simbolo.svg" alt="" width={26} height={14} className="h-3.5 w-auto" />
        <span className="text-[15px] font-semibold tracking-[-0.015em]">EM Marketing</span>
      </div>

      <button
        type="button"
        onClick={() => (novoPedido(), aoNavegar())}
        className="pressiona flex cursor-pointer items-center gap-2.5 rounded-full border border-linha-forte px-3 py-2 font-medium transition-colors duration-150 hover:bg-hover"
      >
        <svg
          aria-hidden="true"
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11.5 2.5l2 2L7 11l-2.7.7L5 9z" />
          <path d="M13 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3.5" />
        </svg>
        Novo pedido
        <kbd className="ml-auto font-mono max-md:hidden text-[11px] text-tinta-4">⌘K</kbd>
      </button>

      <section aria-label="Equipe" className="flex flex-col gap-px">
        <h2 className="px-3 pb-1.5 text-xs font-normal text-tinta-4">Equipe</h2>
        <ul className="flex flex-col gap-px">
          {BOT_IDS.map((id) => (
            <li key={id} className="flex items-center gap-2.5 rounded-item px-3 py-[7px]">
              <Avatar bot={id} tamanho={26} estado={estados[id].tipo} />
              <span className="flex min-w-0 flex-col">
                <span className="leading-tight font-medium">{BOTS[id].nome}</span>
                <span className="truncate text-xs text-tinta-3">{estados[id].texto}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Grupo titulo="Hoje" conversas={hoje} ativa={ativa} aoNavegar={aoNavegar} />
      <Grupo titulo="Antes" conversas={antes} ativa={ativa} aoNavegar={aoNavegar} />

      <div className="mt-auto flex flex-col gap-px">
        <a href="/atividade" onClick={(e) => (aoClicarLink(e), aoNavegar())} className={link("/atividade")}>
          Atividade
          {emAtividade > 0 && <span className="tabular font-mono text-xs text-tinta">{emAtividade}</span>}
        </a>
        <a href="/biblioteca" onClick={(e) => (aoClicarLink(e), aoNavegar())} className={link("/biblioteca")}>
          Biblioteca
        </a>
        <div className="mt-2 flex items-center gap-2 border-t border-linha px-3 pt-3 text-xs text-tinta-3">
          <span className="min-w-0 flex-1 truncate">{email}</span>
          <button
            type="button"
            onClick={() => auth.signOut()}
            className="cursor-pointer rounded-full px-2 py-1 text-tinta-2 hover:bg-hover hover:text-tinta"
          >
            Sair
          </button>
        </div>
      </div>
    </nav>
  );
}
