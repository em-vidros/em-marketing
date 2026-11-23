import { lerArquivo, gravarArquivo } from "../armazem";
import { idDaImagem, urlDaMidia } from "../db";
import { ajustarArte, type IaDoAjuste, type PedidoDeAjuste } from "../domain/art/ajuste";
import { exigir, gravarPost, proximoPasso, transicionar, type EtapaPost } from "./post";

/** A arte escolhida depois de um ajuste ou de voltar, como a conversa e a tela mostram. */
async function arteAtual(post: EtapaPost) {
  if (!("peca" in post)) throw new Error("O post perdeu a arte escolhida.");
  const { arte } = post.peca;
  return {
    ok: true as const,
    postId: post.postId,
    formato: post.formato === "stories" ? ("stories" as const) : ("feed" as const),
    variante: arte.variant,
    url: await urlDaMidia(arte.path),
    imagemId: await idDaImagem(arte.path),
    problemas: arte.problemas,
    /** Quantas versões de antes a arte guarda. Com zero, não há o que desfazer. */
    versoesAnteriores: "anteriores" in arte ? (arte.anteriores?.length ?? 0) : 0,
    proximoPasso: proximoPasso(post),
  };
}

export type ArteDoAjuste = Awaited<ReturnType<typeof arteAtual>>;

/**
 * Ajusta a arte escolhida do post só onde o pedido afeta e grava a versão nova, guardando a de antes.
 * É o que a tool ajustar_arte e a rota POST /api/posts/:id/ajuste chamam.
 */
export async function ajustarArteDoPost(post: EtapaPost | null, pedido: PedidoDeAjuste, ia?: IaDoAjuste): Promise<ArteDoAjuste | { ok: false; motivo: string }> {
  const r = exigir(post, "ajuste");
  if (!r.ok) return r;
  const { postId, formato, peca } = r.post;
  const jpeg = await lerArquivo(peca.arte.path);
  if (!jpeg) return { ok: false, motivo: "A arte escolhida sumiu do armazenamento." };
  const alvo = formato === "stories" ? "stories" : "feed";
  const ajustada = await ajustarArte({ jpeg, formato: alvo, pedido, problemas: peca.arte.problemas }, ia);
  if (!ajustada.ok) return ajustada;
  const path = await gravarArquivo("arts", `post${postId}-${alvo}-v${peca.arte.variant}-ajuste-${Date.now()}.jpg`, Buffer.from(ajustada.jpeg), "image/jpeg");
  return gravar(r.post, { tipo: "ajuste", path, problemas: ajustada.problemas });
}

/** Volta a arte escolhida para a versão de antes do último ajuste. A tool voltar_arte e a rota POST /api/posts/:id/voltar chamam esta. */
export async function voltarArteDoPost(post: EtapaPost | null): Promise<ArteDoAjuste | { ok: false; motivo: string }> {
  return gravar(post, { tipo: "voltar" });
}

async function gravar(post: EtapaPost | null, evento: Parameters<typeof transicionar>[1]) {
  const t = transicionar(post, evento);
  if (!t.ok) return t;
  await gravarPost(t.post);
  return arteAtual(t.post);
}
