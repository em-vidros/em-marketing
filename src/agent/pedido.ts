import type { UIMessage } from "ai";
import { z } from "zod";
import type { Pilar, ReferenciaParaGerar } from "../domain/art/pipeline";
import { ehChave } from "../v2/arquivos";
import type { EscolhaDoPedido } from "../v2/referencias";

/** Quantas referências da Biblioteca e quantas imagens coladas cabem num pedido. */
export const MAXIMO_MARCADAS = 3;
export const MAXIMO_COLADAS = 3;

/**
 * A parte `data-referencias` da mensagem da pessoa: o que ela marcou e colou no composer.
 * `usada` é gravada pelo servidor no fim do turno que gerou artes com ela.
 */
export const DadosDaEscolha = z.object({
  marcadas: z.array(z.uuid()).max(MAXIMO_MARCADAS),
  coladas: z.array(z.string().refine(ehChave, "Chave de arquivo inválida.")).max(MAXIMO_COLADAS),
  usada: z.literal(true).optional(),
});
export type DadosDaEscolha = z.infer<typeof DadosDaEscolha>;

export type ParteDaEscolha = { type: "data-referencias"; data: DadosDaEscolha };

const ehParteDaEscolha = (p: UIMessage["parts"][number]): p is ParteDaEscolha => p.type === "data-referencias";

export const escolhaDa = (m: UIMessage): DadosDaEscolha | null => (m.parts.find(ehParteDaEscolha)?.data as DadosDaEscolha | undefined) ?? null;

/**
 * A escolha como chega do cliente. Formato errado vira erro de pedido, não referência perdida no meio da geração.
 * `usada` sai: uma mensagem editada ou refeita apaga a resposta que a usou, e a escolha volta a valer.
 */
export function escolhaDoCliente(m: UIMessage): { ok: true; mensagem: UIMessage } | { ok: false; erro: string } {
  if (!m.parts.some(ehParteDaEscolha)) return { ok: true, mensagem: m };
  const parts: UIMessage["parts"] = [];
  for (const p of m.parts) {
    if (!ehParteDaEscolha(p)) {
      parts.push(p);
      continue;
    }
    const r = DadosDaEscolha.strict().safeParse(p.data);
    if (!r.success) return { ok: false, erro: z.prettifyError(r.error) };
    const { usada: _, ...data } = r.data;
    parts.push({ type: "data-referencias", data });
  }
  return { ok: true, mensagem: { ...m, parts } };
}

/**
 * A escolha que vale para a próxima geração: a da mensagem mais recente da pessoa que trouxe alguma, se nenhuma geração
 * a usou ainda. Uma pergunta do bot no meio não perde a escolha; a geração seguinte usa e ela não vale mais.
 */
export function escolhaPendente(historico: readonly UIMessage[]): { mensagemId: string; escolha: EscolhaDoPedido } | null {
  for (const m of historico.toReversed()) {
    if (m.role !== "user") continue;
    const escolha = escolhaDa(m);
    if (!escolha || escolha.marcadas.length + escolha.coladas.length === 0) continue;
    return escolha.usada ? null : { mensagemId: m.id, escolha };
  }
  return null;
}

/** Grava na mensagem que a geração usou a escolha dela. */
export const marcarUsada = (mensagens: UIMessage[], mensagemId: string): UIMessage[] =>
  mensagens.map((m) =>
    m.id !== mensagemId ? m : { ...m, parts: m.parts.map((p) => (ehParteDaEscolha(p) ? { ...p, data: { ...p.data, usada: true as const } } : p)) },
  );

/** O modelo não vê as imagens; vê que a pessoa escolheu, para não pedir link nem dizer que não recebeu. */
export function notaDaEscolha(p: { type: `data-${string}`; data: unknown }) {
  if (p.type !== "data-referencias") return undefined;
  const { marcadas, coladas, usada } = p.data as DadosDaEscolha;
  const partes = [marcadas.length && `${marcadas.length} referência(s) marcada(s) da Biblioteca`, coladas.length && `${coladas.length} imagem(ns) colada(s)`].filter(Boolean);
  if (!partes.length) return undefined;
  const destino = usada ? "Uma geração de artes já usou essas imagens." : "A próxima geração de artes usa essas imagens sozinha; não peça links.";
  return { type: "text" as const, text: `[A pessoa mandou com este pedido ${partes.join(" e ")}. ${destino}]` };
}

/** As âncoras que a geração deste turno usa e o aviso de que usou. As delegações do turno recebem as mesmas. */
export interface ReferenciasDoTurno {
  carregar: (pilar: Pilar) => Promise<ReferenciaParaGerar[]>;
  usar: () => void;
}
