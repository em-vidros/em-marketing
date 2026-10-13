import type { Passo } from "../tipos";
import { LinhaFerramenta } from "./ia/LinhaFerramenta";

export { Check, Girando } from "./ia/LinhaFerramenta";

/** Chamadas de tool em linhas, cada uma com o ícone do estado dela. */
export function Passos({ passos, className = "" }: { passos: readonly Passo[]; className?: string }) {
  if (passos.length === 0) return null;
  return (
    <ol aria-label="Ferramentas" className={`flex list-none flex-col ${className}`}>
      {passos.map((p) => (
        <LinhaFerramenta key={p.id} passo={p} />
      ))}
    </ol>
  );
}
