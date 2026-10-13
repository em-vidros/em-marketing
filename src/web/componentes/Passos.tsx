import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { imagensEm, passosDe, type Passo } from "../tipos";
import { LinhaFerramenta } from "./ia/LinhaFerramenta";

export { Check, Girando } from "./ia/LinhaFerramenta";

/** Um pedaço de mensagem: uma parte solta (texto, raciocínio, cartão) ou uma sequência de passos de tool. */
export type Trecho<P> = { tipo: "parte"; parte: P; chave: number } | { tipo: "passos"; passos: Passo[]; chave: number };

/**
 * Junta as chamadas de tool seguidas numa sequência só, para virar uma lista em vez de uma
 * lista de um item por passo. `ehPasso` deixa de fora as tools que têm cartão próprio.
 */
export function trechosDe<P extends UIMessage["parts"][number]>(partes: readonly P[], ehPasso: (p: P) => boolean = () => true): Trecho<P>[] {
  const trechos: Trecho<P>[] = [];
  partes.forEach((parte, chave) => {
    const [passo] = ehPasso(parte) ? passosDe({ id: "", role: "assistant", parts: [parte] }) : [];
    const ultimo = trechos.at(-1);
    if (!passo) trechos.push({ tipo: "parte", parte, chave });
    else if (ultimo?.tipo === "passos") ultimo.passos.push(passo);
    else trechos.push({ tipo: "passos", passos: [passo], chave });
  });
  return trechos;
}

/** Chamadas de tool em linhas, cada uma com o ícone do estado dela. `extra` vai embaixo da linha (as artes de uma tool). */
export function Passos({ passos, className = "", extra }: { passos: readonly Passo[]; className?: string; extra?: (p: Passo) => ReactNode }) {
  if (passos.length === 0) return null;
  return (
    <ol aria-label="Ferramentas" className={`flex list-none flex-col ${className}`}>
      {passos.map((p) => (
        <LinhaFerramenta key={p.id} passo={p}>
          {extra?.(p)}
        </LinhaFerramenta>
      ))}
    </ol>
  );
}

/** As artes que uma tool devolveu, em miniatura; cada uma abre em outra aba. */
export function ArtesDoPasso({ passo }: { passo: Passo }) {
  const imagens = passo.estado === "feito" ? imagensEm(passo.saida) : [];
  if (imagens.length === 0) return null;
  return (
    <div className="grid max-w-md grid-cols-3 gap-2">
      {imagens.map((src, n) => (
        <a key={src} href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-item">
          <img
            src={src}
            alt={`Arte ${n + 1}, abre em outra aba`}
            loading="lazy"
            className="aspect-[4/5] w-full bg-ativo object-cover outline-1 -outline-offset-1 outline-black/10"
          />
        </a>
      ))}
    </div>
  );
}

export const comArtes = (p: Passo) => <ArtesDoPasso passo={p} />;
