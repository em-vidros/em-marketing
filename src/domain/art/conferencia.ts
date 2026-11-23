import type { Problema } from "../brand/validate";

/** A regra dos problemas da conferência de texto. O cartão da arte no chat mostra só os desta regra. */
export const REGRA_DO_TEXTO = "Texto da arte";

export type Divergencia = { tipo: "trocada"; pedida: string; lida: string } | { tipo: "faltando"; pedida: string } | { tipo: "sobrando"; lida: string };

type Palavra = { chave: string; forma: string };

/** Maiúscula, espaço e pontuação não contam. Acento e letra contam. */
function palavras(texto: string): Palavra[] {
  return texto
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((forma) => ({ chave: forma.toLocaleLowerCase("pt-BR"), forma }));
}

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

/** Distância de edição em que trocar duas letras vizinhas de lugar conta como um erro só, como em "Vidor". */
function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/** Duas palavras são a mesma com erro quando só o acento muda ou quando poucas letras mudam. */
const parecidas = (a: string, b: string) => semAcento(a) === semAcento(b) || distancia(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 3));

/**
 * Compara os textos pedidos com os lidos na arte, palavra por palavra, sem olhar a ordem dos blocos.
 * Uma palavra que falta e outra que sobra parecida com ela viram uma palavra trocada.
 */
export function compararTexto(pedidos: readonly string[], lidos: readonly string[]): Divergencia[] {
  const sobrando = lidos.flatMap(palavras);
  const faltando: Palavra[] = [];
  for (const p of pedidos.flatMap(palavras)) {
    const i = sobrando.findIndex((l) => l.chave === p.chave);
    if (i === -1) faltando.push(p);
    else sobrando.splice(i, 1);
  }
  const divergencias: Divergencia[] = [];
  for (const p of faltando) {
    const i = sobrando.findIndex((l) => parecidas(p.chave, l.chave));
    if (i === -1) divergencias.push({ tipo: "faltando", pedida: p.forma });
    else divergencias.push({ tipo: "trocada", pedida: p.forma, lida: sobrando.splice(i, 1)[0]!.forma });
  }
  return [...divergencias, ...sobrando.map((l) => ({ tipo: "sobrando" as const, lida: l.forma }))];
}

const descrever = (d: Divergencia) =>
  d.tipo === "trocada" ? `saiu "${d.lida}" no lugar de "${d.pedida}"` : d.tipo === "faltando" ? `faltou "${d.pedida}"` : `sobrou "${d.lida}"`;

/** O aviso que a pessoa lê no cartão da arte e o bot repete na conversa. */
export const problemaDoTexto = (divergencias: readonly Divergencia[]): Problema => ({
  regra: REGRA_DO_TEXTO,
  severidade: "erro",
  detalhe: `Na arte, ${divergencias.map(descrever).join("; ")}.`,
});

export const TEXTO_SEM_CONFERENCIA: Problema = {
  regra: REGRA_DO_TEXTO,
  severidade: "aviso",
  detalhe: "Não deu para conferir o texto da arte. Confira a grafia antes de publicar.",
};

/** O lembrete que vai no prompt da segunda tentativa, em inglês como o resto do prompt. */
export function lembreteDeGrafia(divergencias: readonly Divergencia[]): string {
  const erros = divergencias.map((d) =>
    d.tipo === "trocada" ? `wrote "${d.lida}" instead of "${d.pedida}"` : d.tipo === "faltando" ? `left out "${d.pedida}"` : `added "${d.lida}", which was not requested`,
  );
  return `SPELLING CHECK: a previous attempt got the text wrong (${erros.join("; ")}). Render every word exactly as given above, letter by letter, accents included, and nothing else.`;
}

/**
 * Gera e confere o texto pintado contra `textos`. Se não bate, gera de novo uma vez só, com o lembrete da grafia,
 * porque cada imagem custa dinheiro. Se a segunda também erra, fica a que errou menos, com o aviso do que saiu errado.
 * Sem leitura (o modelo de visão falhou), a imagem segue com o aviso de que não foi conferida.
 */
export async function gerarConferida<T>(
  gerar: (lembrete?: string) => Promise<T>,
  ler: (gerada: T) => Promise<string[]>,
  textos: readonly string[],
): Promise<{ gerada: T; problemas: Problema[] }> {
  const conferir = async (gerada: T) => {
    const lidos = await ler(gerada).catch((erro: unknown) => (console.error("conferência do texto da arte:", erro), null));
    return { gerada, divergencias: lidos && compararTexto(textos, lidos) };
  };
  const primeira = await conferir(await gerar());
  if (!primeira.divergencias) return { gerada: primeira.gerada, problemas: [TEXTO_SEM_CONFERENCIA] };
  if (!primeira.divergencias.length) return { gerada: primeira.gerada, problemas: [] };

  const segunda = await conferir(await gerar(lembreteDeGrafia(primeira.divergencias)));
  if (segunda.divergencias?.length === 0) return { gerada: segunda.gerada, problemas: [] };
  const melhor = segunda.divergencias && segunda.divergencias.length < primeira.divergencias.length ? segunda : primeira;
  return { gerada: melhor.gerada, problemas: [problemaDoTexto(melhor.divergencias!)] };
}
