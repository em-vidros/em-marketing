import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import type { PostPronto } from "../../../agent/fila";
import { MIDIA } from "../peca";
import { useCalendario } from "./contexto";
import { FormAgendar, type AcoesDaBolha } from "./Bolha";
import { tituloDoPost, type Lugar } from "./itens";

const pilarLegivel = (p: string) => p.charAt(0) + p.slice(1).toLowerCase();

/**
 * Os posts prontos para agendar. No desktop é uma coluna ao lado da grade: arrastar um post
 * para um horário, ou clicar e escolher no popover. No celular vira folha, com a confirmação
 * dentro dela, porque não há grade ao lado para soltar.
 */
export function ListaProntos({ prontos, aoEscolher }: { prontos: readonly PostPronto[] | null; aoEscolher: (post: PostPronto, el: HTMLElement) => void }) {
  const c = useCalendario();
  if (prontos === null) return <p className="px-4 py-6 text-tinta-3">Carregando…</p>;
  if (prontos.length === 0)
    return (
      <div className="flex flex-col gap-1 px-4 py-6">
        <p className="font-medium">Nada pronto para agendar</p>
        <p className="text-[13px] text-pretty text-tinta-2">Um post aparece aqui quando tem arte escolhida, legenda e registro no Linear.</p>
      </div>
    );
  return (
    <ul className="flex flex-col gap-1 p-2">
      {prontos.map((p) => (
        <li key={p.postId}>
          <button
            type="button"
            data-pronto={p.postId}
            onPointerDown={(e) => !c.compacto && e.pointerType !== "touch" && c.descer(e, { tipo: "pronto", post: p })}
            onClick={(e) => aoEscolher(p, e.currentTarget)}
            aria-label={`Agendar ${tituloDoPost(p.headline, p.postId)}`}
            className="cal-pronto pressiona-leve flex w-full cursor-grab items-center gap-3 rounded-item p-2 text-left hover:bg-hover active:cursor-grabbing"
          >
            <img src={p.capa} alt="" loading="lazy" decoding="async" draggable={false} className="h-14 w-[45px] flex-none rounded-[8px] object-cover outline outline-1 -outline-offset-1 outline-black/10" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="line-clamp-2 text-[13px]/snug font-medium text-pretty [overflow-wrap:anywhere]">{tituloDoPost(p.headline, p.postId)}</span>
              <span className="truncate text-xs text-tinta-3">
                {pilarLegivel(p.pilar)} · {p.midias.map((m) => MIDIA[m]).join(" e ")}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A folha do celular: lista e, ao tocar num post, a confirmação de agendar no lugar dela. */
export function FolhaProntos({
  aberta,
  fechar,
  prontos,
  lugarPadrao,
  agendar,
}: {
  aberta: boolean;
  fechar: () => void;
  prontos: readonly PostPronto[] | null;
  lugarPadrao: Lugar;
  agendar: AcoesDaBolha["agendar"];
}) {
  const [escolhido, setEscolhido] = useState<PostPronto | null>(null);
  return (
    <Dialog.Root open={aberta} onOpenChange={(a) => !a && fechar()} onOpenChangeComplete={(a) => !a && setEscolhido(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="gaveta-fundo fixed inset-0 z-50 bg-tinta/20" />
        <Dialog.Popup
          data-teclado="isolado"
          className="cal-folha fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-[24px] bg-superficie pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_rgb(15_13_10/0.16)] outline-none"
        >
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-tinta/15" />
          <div className="flex items-center justify-between px-4 pt-2 pb-1">
            <Dialog.Title className="text-[15px] font-semibold">{escolhido ? "Agendar publicação" : "Prontos para agendar"}</Dialog.Title>
            <Dialog.Close aria-label="Fechar" className="pressiona -mr-2 grid size-11 cursor-pointer place-items-center rounded-full text-tinta-3 hover:bg-hover hover:text-tinta">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {escolhido ? (
              <div className="p-4 pt-2">
                <FormAgendar
                  post={escolhido}
                  lugar={lugarPadrao}
                  aoAgendar={async (post, midia, quando) => {
                    const falha = await agendar(post, midia, quando);
                    if (!falha) fechar();
                    return falha;
                  }}
                  aoCancelar={() => setEscolhido(null)}
                />
              </div>
            ) : (
              <ListaProntos prontos={prontos} aoEscolher={(p) => setEscolhido(p)} />
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
