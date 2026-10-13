import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState } from "react";
import type { NomesDosBots } from "../../api";
import { type Atalho, ATALHOS, GRUPOS, IDS_DE_ATALHO, rotuloDe } from "../../teclado/atalhos";
import { Teclas } from "./Teclas";

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** A folha do "?": todos os atalhos da tabela, por grupo, com busca. Painel à direita, como no Linear. */
export function FolhaAtalhos({ aberta, fechar, bots }: { aberta: boolean; fechar: () => void; bots: NomesDosBots }) {
  const [busca, setBusca] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  const termo = normalizar(busca.trim());
  const visiveis = IDS_DE_ATALHO.filter((id) => !termo || normalizar(rotuloDe(id, bots)).includes(termo));

  return (
    <Dialog.Root open={aberta} onOpenChange={(a) => !a && fechar()} onOpenChangeComplete={(a) => !a && setBusca("")}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[70] bg-tinta/8" />
        <Dialog.Popup
          data-teclado="isolado"
          initialFocus={campo}
          className="fixed inset-y-2 right-2 z-[71] flex w-[min(380px,calc(100vw-16px))] flex-col overflow-hidden rounded-cartao border border-linha bg-superficie shadow-[0_24px_64px_rgb(15_13_10/0.16)] outline-none"
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <Dialog.Title className="text-[15px] font-semibold">Atalhos de teclado</Dialog.Title>
            <Dialog.Close aria-label="Fechar" className="pressiona -mr-2 grid size-10 cursor-pointer place-items-center rounded-full text-tinta-3 hover:bg-hover hover:text-tinta">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </Dialog.Close>
          </div>
          <div className="px-4 pb-2">
            <label className="flex h-10 items-center gap-2 rounded-item bg-tinta/5 px-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-tinta">
              <span className="sr-only">Buscar atalho</span>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-none text-tinta-3">
                <circle cx="7" cy="7" r="4.75" />
                <path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
              <input
                ref={campo}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar atalho"
                className="min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
              />
            </label>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
            {GRUPOS.map((grupo) => {
              const ids = visiveis.filter((id) => (ATALHOS[id] as Atalho).grupo === grupo);
              if (ids.length === 0) return null;
              return (
                <section key={grupo} aria-label={grupo} className="pt-3">
                  <h3 className="px-1 pb-1 text-xs text-tinta-3">{grupo}</h3>
                  <ul>
                    {ids.map((id) => (
                      <li key={id} className="flex min-h-9 items-center justify-between gap-3 border-b border-linha px-1 py-1.5 last:border-b-0">
                        <span className="text-tinta-2">{rotuloDe(id, bots)}</span>
                        <span className="flex flex-none items-center gap-1.5">
                          {ATALHOS[id].teclas.map((t, i) => (
                            <span key={t} className="flex items-center gap-1.5">
                              {i > 0 && <span className="text-[11px] text-tinta-3">ou</span>}
                              <Teclas tecla={t} />
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {visiveis.length === 0 && <p className="px-1 py-8 text-center text-tinta-3">Nenhum atalho para “{busca}”.</p>}
            <p className="px-1 pt-4 text-xs text-pretty text-tinta-3">
              Teclas de uma letra não valem enquanto você digita. Esc sai do campo de texto.
            </p>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
