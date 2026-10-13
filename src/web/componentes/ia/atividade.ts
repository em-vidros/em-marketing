import type { UIMessage } from "ai";
import { faseDa, rotuloDa } from "../../tipos";

/** O que um bot faz agora, lido da última parte da mensagem dele no stream. */
export type Atividade =
  | { tipo: "pensando" }
  | { tipo: "raciocinando" }
  | { tipo: "escrevendo" }
  | { tipo: "usando"; rotulo: string }
  | { tipo: "esperando" }
  | { tipo: "parado" };

export const TEXTO_DA_ATIVIDADE: { [T in Atividade["tipo"]]: (a: Extract<Atividade, { tipo: T }>) => string } = {
  pensando: () => "Pensando",
  raciocinando: () => "Pensando",
  escrevendo: () => "Escrevendo",
  usando: (a) => a.rotulo,
  esperando: () => "Esperando você",
  parado: () => "Parado",
};

export const textoDa = (a: Atividade) => (TEXTO_DA_ATIVIDADE[a.tipo] as (a: Atividade) => string)(a);

type ParteUI = UIMessage["parts"][number];

/**
 * O que a última parte diz, quando o bot está no ar. null: a parte já terminou, e o bot
 * está entre um passo e outro, o que para quem olha é pensar.
 */
function daParte(p: ParteUI): Atividade | null {
  if (p.type === "reasoning") return p.state === "streaming" ? { tipo: "raciocinando" } : null;
  if (p.type === "text") return p.state === "streaming" ? { tipo: "escrevendo" } : null;
  if ("toolCallId" in p && p.type.startsWith("tool-")) {
    const fase = faseDa(p);
    if (fase === "esperando") return { tipo: "esperando" };
    return fase === "fazendo" ? { tipo: "usando", rotulo: rotuloDa(p.type, fase) } : null;
  }
  return null;
}

/**
 * A atividade de um turno. `mensagem` é a do bot no turno corrente, ou null se o pedido
 * acabou de sair e nada voltou ainda.
 */
export function atividadeDe(mensagem: UIMessage | null | undefined, noAr: boolean): Atividade {
  const ultima = mensagem?.parts.at(-1);
  const agora = ultima ? daParte(ultima) : null;
  if (agora?.tipo === "esperando") return agora;
  if (!noAr) return { tipo: "parado" };
  return agora ?? { tipo: "pensando" };
}
