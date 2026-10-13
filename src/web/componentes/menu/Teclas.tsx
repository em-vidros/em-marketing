import { Tooltip } from "@base-ui/react/tooltip";
import { Fragment, type ReactElement } from "react";
import { ATALHOS, type AtalhoId, ehMac, teclasVisiveis } from "../../teclado/atalhos";

/**
 * As teclas de um atalho como keycaps, lidas da tabela. `tom="escuro"` é para fundo escuro
 * (toast, dica). Só a primeira alternativa aparece; a folha de atalhos mostra todas.
 */
export function Teclas({ atalho, tecla, tom = "claro" }: { atalho?: AtalhoId; tecla?: string; tom?: "claro" | "escuro" }) {
  const t = tecla ?? (atalho ? ATALHOS[atalho].teclas[0] : undefined);
  if (!t) return null;
  const cor = tom === "escuro" ? "bg-white/14 text-white/80" : "bg-tinta/6 text-tinta-2";
  return (
    <span className="inline-flex flex-none items-center gap-1" aria-hidden="true">
      {teclasVisiveis(t, ehMac).map((acorde, i) => (
        <Fragment key={i}>
          {i > 0 && <span className={`text-[11px] ${tom === "escuro" ? "text-white/50" : "text-tinta-3"}`}>depois</span>}
          {acorde.map((k) => (
            <kbd key={k} className={`grid h-5 min-w-5 place-items-center rounded-[5px] px-1 font-sans text-[11px] leading-none font-medium ${cor}`}>
              {k}
            </kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Dica de mouse com o nome da ação e o atalho, como o Linear ensina a tecla. Depois da
 * primeira dica, as vizinhas abrem na hora (Tooltip.Provider na raiz do app).
 */
export function Dica({ atalho, rotulo, lado = "right", children }: { atalho?: AtalhoId; rotulo: string; lado?: "right" | "top" | "bottom"; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={lado} sideOffset={8} className="z-[60]">
          <Tooltip.Popup className="dica flex items-center gap-2 rounded-[10px] bg-tinta px-2.5 py-1.5 text-xs text-white shadow-[0_4px_16px_rgb(0_0_0/0.16)]">
            {rotulo}
            {atalho && <Teclas atalho={atalho} tom="escuro" />}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const DicasProvider = ({ children }: { children: React.ReactNode }) => (
  <Tooltip.Provider delay={500} closeDelay={0}>
    {children}
  </Tooltip.Provider>
);
