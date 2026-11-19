import { useState } from "react";
import { useApi } from "../api";
import { aoClicarLink } from "../rota";
import type { ConversaDaEquipe } from "../tipos";
import { Avatar } from "./Avatar";
import { Expansivel } from "./Expansivel";

const CHAVE = "barra:equipe-aberta";
const lerAberta = () => {
  try {
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
};

/** As conversas das outras pessoas, para admin. Para quem não é admin a rota responde 403 e a seção não aparece. */
export function ConversasDaEquipe({ ativa, aoNavegar }: { ativa: string | null; aoNavegar: () => void }) {
  const [aberta, setAberta] = useState(lerAberta);
  const [carga, recarregar] = useApi<ConversaDaEquipe[]>("/api/conversas/equipe");
  if (carga.estado !== "pronto" || carga.dados.length === 0) return null;
  const alternar = () => {
    try {
      localStorage.setItem(CHAVE, aberta ? "0" : "1");
    } catch {}
    if (!aberta) recarregar();
    setAberta(!aberta);
  };

  return (
    <section aria-label="Da equipe" className="flex flex-col gap-px">
      <button
        type="button"
        aria-expanded={aberta}
        onClick={alternar}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-item px-3 text-xs text-tinta-3 hover:text-tinta"
      >
        Da equipe
        <span className="tabular font-mono">{carga.dados.length}</span>
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
          className={`transition-transform duration-300 ease-(--ease-saida) motion-reduce:transition-none ${aberta ? "rotate-90" : ""}`}
        >
          <path d="M3.5 2l3 3-3 3" />
        </svg>
      </button>
      <Expansivel aberto={aberta} className="flex flex-col gap-px">
        {carga.dados.map((c) => (
          <a
            key={c.id}
            href={`/c/${c.id}`}
            aria-current={c.id === ativa ? "page" : undefined}
            data-atual={c.id === ativa || undefined}
            onClick={(e) => (aoClicarLink(e), aoNavegar())}
            className="linha flex min-h-10 min-w-0 items-center gap-2 rounded-item px-3 py-1.5 text-tinta-2 data-atual:text-tinta"
          >
            {c.botId !== "chefe" && <Avatar bot={c.botId} tamanho={16} />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{c.titulo}</span>
              <span className="truncate text-xs leading-tight text-tinta-3">{c.dono.nome}</span>
            </span>
          </a>
        ))}
      </Expansivel>
    </section>
  );
}
