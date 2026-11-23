import type { UIMessage } from "ai";
import { z } from "zod";
import type { Ancora, Pilar, ReferenciaParaGerar } from "../domain/art/pipeline";
import { ehChave } from "../v2/arquivos";
import type { EscolhaDoPedido } from "../v2/referencias";
import { MAXIMO_COLADAS, MAXIMO_MARCADAS } from "./limitesDoPedido";

/**
 * A parte `data-referencias` da mensagem da pessoa: o que ela marcou e colou no composer.
 * `usada` é o id da resposta do bot cuja geração de artes usou a escolha, gravado pelo servidor no fim desse turno.
 */
export const DadosDaEscolha = z.object({
  marcadas: z.array(z.uuid()).max(MAXIMO_MARCADAS),
  coladas: z.array(z.string().refine(ehChave, "Chave de arquivo inválida.")).max(MAXIMO_COLADAS),
  usada: z.string().min(1).max(200).optional(),
});
export type DadosDaEscolha = z.infer<typeof DadosDaEscolha>;

export type ParteDaEscolha = { type: "data-referencias"; data: DadosDaEscolha };

const ehParteDaEscolha = (p: UIMessage["parts"][number]): p is ParteDaEscolha => p.type === "data-referencias";

/** A escolha gravada numa mensagem. Uma parte fora do formato, como uma restaurada pelo desfazer, conta como nenhuma escolha. */
export function escolhaDa(m: UIMessage): DadosDaEscolha | null {
  const parte = m.parts.find(ehParteDaEscolha);
  const lida = parte && DadosDaEscolha.safeParse(parte.data);
  return lida?.success ? lida.data : null;
}

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

const trocarUsada = (m: UIMessage, usada: string | undefined): UIMessage => ({
  ...m,
  parts: m.parts.map((p) => (ehParteDaEscolha(p) ? { ...p, data: { marcadas: p.data.marcadas, coladas: p.data.coladas, ...(usada && { usada }) } } : p)),
});

/** Grava na mensagem da escolha o id da resposta cuja geração a usou. */
export const marcarUsada = (mensagens: UIMessage[], mensagemId: string, respostaId: string): UIMessage[] =>
  mensagens.map((m) => (m.id === mensagemId ? trocarUsada(m, respostaId) : m));

/**
 * Refazer ou editar uma mensagem depois da escolha corta a resposta que a usou, e mantém o id da mensagem editada.
 * Sem essa resposta no histórico, a escolha volta a valer para a próxima geração.
 */
export function reabrirEscolhas(historico: UIMessage[]): UIMessage[] {
  const ids = new Set(historico.map((m) => m.id));
  return historico.map((m) => {
    const usada = escolhaDa(m)?.usada;
    return usada && !ids.has(usada) ? trocarUsada(m, undefined) : m;
  });
}

/** O modelo não vê as imagens; vê que a pessoa escolheu, para não pedir link nem dizer que não recebeu. */
export function notaDaEscolha(p: { type: `data-${string}`; data: unknown }) {
  const lida = p.type === "data-referencias" ? DadosDaEscolha.safeParse(p.data) : null;
  if (!lida?.success) return undefined;
  const { marcadas, coladas, usada } = lida.data;
  const partes = [marcadas.length && `${marcadas.length} referência(s) marcada(s) da Biblioteca`, coladas.length && `${coladas.length} imagem(ns) colada(s)`].filter(Boolean);
  if (!partes.length) return undefined;
  const destino = usada ? "Uma geração de artes já usou essas imagens." : "A próxima geração de artes usa essas imagens sozinha; não peça links.";
  return { type: "text" as const, text: `[A pessoa mandou com este pedido ${partes.join(" e ")}. ${destino}]` };
}

/** A geração usou a escolha quando ao menos uma imagem dela chegou ao modelo. Uma que não abriu não conta. */
export const chegouAoModelo = (escolha: EscolhaDoPedido, carregadas: readonly Ancora[]) =>
  carregadas.some((a) => (a.origem === "pedido" ? escolha.coladas.includes(a.arquivo) : escolha.marcadas.includes(a.id)));

/** As âncoras que a geração deste turno usa e o aviso de que gerou com elas. As delegações do turno recebem as mesmas. */
export interface ReferenciasDoTurno {
  carregar: (pilar: Pilar) => Promise<ReferenciaParaGerar[]>;
  usar: (carregadas: readonly Ancora[]) => void;
}
