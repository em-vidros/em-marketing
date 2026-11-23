import sharp from "sharp";
import { emOrdem, guardarImagens, idDaImagem, urlDaMidia } from "../db";
import { generate3Arts, type ArtVariant, type Brief, type Pilar, type ReferenciaParaGerar } from "../domain/art/pipeline";
import { temErro, type Problema } from "../domain/brand/validate";
import { definirHeadline, escreverLegenda } from "../domain/caption";
import { buscarFotos } from "../domain/fotos";
import { PIXELS_MAXIMOS } from "../v2/arquivos";
import { montarBrief } from "./brief";
import type { ReferenciasDoTurno } from "./pedido";
import { criarPost, gravarPost, transicionar, type Arte, type EtapaPost, type Evento, type Formato } from "./post";
import { fotoPublica } from "./tools/fotos";

const TETO_DA_IMAGEM = 10 * 1024 * 1024;

/** Baixa as imagens que o usuário colou na conversa e devolve em JPEG. Link que não é imagem vira aviso, não erro. */
export async function baixarImagens(urls: readonly string[]): Promise<{ imagens: Uint8Array[]; recusadas: string[] }> {
  const imagens: Uint8Array[] = [];
  const recusadas: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0" } });
      const tipo = res.headers.get("content-type") ?? "";
      if (!res.ok || !tipo.startsWith("image/")) throw new Error(tipo || String(res.status));
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > TETO_DA_IMAGEM) throw new Error("acima de 10 MB");
      imagens.push(await sharp(bytes, { limitInputPixels: PIXELS_MAXIMOS }).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer());
    } catch {
      recusadas.push(url);
    }
  }
  return { imagens, recusadas };
}

export const AVISO_DE_LINKS = "Estes links não eram imagens e ficaram de fora. Peça ao usuário o link direto da imagem ou que suba na Biblioteca.";

/** Sem a Biblioteca, as artes saem no visual padrão da casa em vez de falhar. */
export async function referenciasOuNenhuma(referencias: ReferenciasDoTurno | undefined, pilar: Pilar): Promise<ReferenciaParaGerar[]> {
  if (!referencias) return [];
  return referencias.carregar(pilar).catch((erro: unknown) => {
    console.error("geração de artes: as artes saem sem referência porque a Biblioteca não respondeu", erro);
    return [];
  });
}

export const artePublica = async (a: Arte) => ({
  variante: a.variant,
  /** A imagem que guiou a variação, para a linha de referências usadas. Ausente na foto real e nas artes antigas. */
  ancora: "foto" in a ? undefined : a.ancora,
  url: await urlDaMidia(a.path),
  /** A chave de POST /api/imagens/:id/editar. A imagem é registrada antes de aparecer na conversa. */
  imagemId: await idDaImagem(a.path),
  problemas: a.problemas,
});

export type ArtePublica = Awaited<ReturnType<typeof artePublica>>;

export interface PedidoDePost {
  /** O pedido completo, com as palavras da pessoa: tema, data, formato, público e estilo que ela disse. */
  pedido: string;
  /** Direção de arte pronta, quando o Chefe pesquisou referências de um estilo pedido. Manda sobre a do brief. */
  direcao?: string;
  /** Links diretos de imagem que a pessoa colou na conversa. */
  imagens?: readonly string[];
  /** O banco não tem foto real que sirva: a peça sai tipográfica mesmo quando o tema pediria foto (§8.2). */
  semFotoReal?: boolean;
}

/**
 * Cada saída de produzirPost. As anteriores à última são prévias para a conversa: o AI SDK não manda prévia ao modelo.
 * `fase` diz até onde o post chegou; `artes` cresce uma a uma, na ordem em que ficam prontas.
 */
export interface ProgressoDoPost {
  ok: true;
  fase: "brief" | "headline" | "artes" | "pronto" | "foto";
  postId: number;
  brief: Brief;
  formato: Formato;
  headline: { headline: string; apoio: string; problemas: Problema[]; bloqueia: boolean } | null;
  artes: ArtePublica[];
  legenda: { texto: string; problemas: Problema[]; bloqueia: boolean } | null;
  fotosCandidatas?: Awaited<ReturnType<typeof fotoPublica>>[];
  avisos: string[];
  imagensRecusadas?: string[];
  proximoPasso: string;
}

function passo(post: EtapaPost, evento: Evento): EtapaPost {
  const r = transicionar(post, evento);
  if (!r.ok) throw new Error(r.motivo);
  return r.post;
}

/** Roda `trabalho` e devolve, uma a uma, as saídas que ele emite, na ordem em que saem. O erro do trabalho sobe no fim. */
async function* emitidas<T>(trabalho: (emitir: (item: T) => void) => Promise<unknown>): AsyncGenerator<T> {
  const fila: T[] = [];
  let acordar = () => {};
  let terminou = false;
  const feito = trabalho((item) => (fila.push(item), acordar())).finally(() => ((terminou = true), acordar()));
  feito.catch(() => {});
  while (fila.length || !terminou) {
    if (fila.length) yield fila.shift()!;
    else await new Promise<void>((r) => (acordar = r));
  }
  await feito;
}

const SEM_FOTO = "O banco não tem foto real que sirva, então a peça saiu tipográfica, sem mostrar produto, obra nem pessoas. Uma foto real deixaria a peça melhor.";

const ESCOLHA =
  "As 3 artes já estão na conversa com o botão de escolha. Diga em uma frase o ângulo do post e pergunte qual a pessoa quer. Não chame mostrar_artes.";

const DEPOIS_DA_ESCOLHA: Record<Formato, string> = {
  feed: "Com o número que a pessoa escolher, chame escolher_arte. A legenda já está pronta.",
  stories: "Com o número que a pessoa escolher, chame escolher_arte. Stories não têm legenda.",
  ambos: "Com o número que a pessoa escolher, chame escolher_arte e depois derivar_story. A legenda já está pronta.",
};

/**
 * Do pedido às 3 artes, em código, sem voltas de modelo no meio: brief, headline e as 3 artes, com a legenda escrita
 * enquanto as imagens renderizam. Não para para confirmar o brief. É a capacidade por trás da tool produzir_post do Chefe.
 */
export async function* produzirPost(
  conversaId: string,
  { pedido, direcao, imagens = [], semFotoReal = false }: PedidoDePost,
  referencias?: ReferenciasDoTurno,
): AsyncGenerator<ProgressoDoPost> {
  const lido = await montarBrief(pedido);
  const { formato } = lido;

  if (lido.brief.precisaFotoReal && !semFotoReal) {
    const candidatas = await emOrdem(await buscarFotos(`${lido.brief.tema} ${lido.brief.angulo ?? ""}`), fotoPublica);
    if (candidatas.length) {
      const post = await criarPost(conversaId, lido.brief, formato);
      yield {
        ok: true,
        fase: "foto",
        postId: post.postId,
        brief: lido.brief,
        formato,
        headline: null,
        artes: [],
        legenda: null,
        fotosCandidatas: candidatas,
        avisos: [],
        proximoPasso:
          "O post pede foto real (§8.2) e não foi gerado. Escolha entre fotosCandidatas a que serve pela descrição e chame usar_foto. Se nenhuma servir, chame produzir_post de novo com sem_foto_real true.",
      };
      return;
    }
  }

  const avisos: string[] = [];
  let brief = lido.brief;
  if (brief.precisaFotoReal) {
    brief = lido.alternativa ?? { ...brief, angulo: "tipográfico, sem mostrar produto, obra nem pessoas", precisaFotoReal: false };
    avisos.push(SEM_FOTO);
  }

  let post: EtapaPost = await criarPost(conversaId, brief, formato);
  const { postId } = post;
  const progresso: ProgressoDoPost = { ok: true, fase: "brief", postId, brief, formato, headline: null, artes: [], legenda: null, avisos, proximoPasso: "" };
  const agora = (fase: ProgressoDoPost["fase"]): ProgressoDoPost => ({ ...progresso, fase, artes: [...progresso.artes] });
  yield agora("brief");

  const h = await definirHeadline(brief, formato);
  post = passo(post, { tipo: "headline", headline: { headline: h.headline, apoio: h.apoio } });
  await gravarPost(post);
  progresso.headline = { ...h, bloqueia: temErro(h.problemas) };
  yield agora("headline");

  // "ambos": feed primeiro; a versão stories sai do conceito escolhido, por derivar_story.
  const alvo = formato === "ambos" ? "feed" : formato;
  // Até 3 âncoras, uma por variação; o que a pessoa escolheu além disso vai junto nas 3, como os links colados.
  const [carregadas, baixadas] = await Promise.all([referenciasOuNenhuma(referencias, brief.pilar), baixarImagens(imagens)]);
  const anexos = [...carregadas.slice(3).map((r) => r.imagem), ...baixadas.imagens];
  if (baixadas.recusadas.length) {
    progresso.imagensRecusadas = baixadas.recusadas;
    avisos.push(AVISO_DE_LINKS);
  }

  const legenda =
    formato === "stories"
      ? Promise.resolve(null)
      : escreverLegenda(brief, h.headline).then(({ legenda, problemas }) => ({ texto: legenda, problemas })).catch((erro: unknown) => {
          console.error("produzir_post: a legenda não saiu", erro);
          avisos.push("A legenda não saiu. Chame escrever_legenda depois da escolha.");
          return null;
        });

  const prontas: ArtVariant[] = [];
  const gerar = (emitir: (a: ArtVariant) => void) =>
    generate3Arts({
      postId,
      brief,
      formato: alvo,
      headline: h.headline,
      apoio: h.apoio,
      direcao: direcao ?? lido.direcao ?? undefined,
      referencias: carregadas.slice(0, 3),
      anexos,
      aoFicarPronta: emitir,
    });
  for await (const arte of emitidas(gerar)) {
    prontas.push(arte);
    // Registrada já, para o botão de editar da prévia funcionar antes das outras duas.
    await guardarImagens(postId, [{ path: arte.path, tipo: "variacao", variante: arte.variant, formato: alvo }]);
    progresso.artes = [...progresso.artes, await artePublica(arte)].sort((a, b) => a.variante - b.variante);
    yield agora("artes");
  }
  referencias?.usar(carregadas);

  post = passo(post, { tipo: "artes", artes: prontas.toSorted((a, b) => a.variant - b.variant) });
  const escrita = await legenda;
  if (escrita) {
    post = passo(post, { tipo: "legenda", legenda: escrita.texto });
    progresso.legenda = { ...escrita, bloqueia: temErro(escrita.problemas) };
  }
  await gravarPost(post);
  progresso.artes = await emOrdem(prontas.toSorted((a, b) => a.variant - b.variant), artePublica);
  progresso.proximoPasso = `${ESCOLHA} ${DEPOIS_DA_ESCOLHA[formato]}`;
  yield agora("pronto");
}
