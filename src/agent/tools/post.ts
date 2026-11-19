import { tool } from "ai";
import sharp from "sharp";
import { z } from "zod";
import { emOrdem, urlDaMidia } from "../../db";
import { q } from "../../v2/banco";
import { definirHeadline, escreverLegenda } from "../../domain/caption";
import { deriveStory, generate3Arts, PILARES, type Brief } from "../../domain/art/pipeline";
import { temErro } from "../../domain/brand/validate";
import { buscarFotos, pegarFoto, prepararFoto } from "../../domain/fotos";
import { publishImage } from "../../domain/instagram";
import {
  criarPost,
  exigir,
  headlineParaGerar,
  gravarPost,
  midiaParaPublicar,
  postDaConversa,
  proximoPasso,
  transicionar,
  type Evento,
  type EtapaPost,
} from "../post";
import { agendarPost } from "../fila";
import { fotoPublica } from "./fotos";
import { escolhasDeArte } from "../../domain/historico";

const formato = z.enum(["feed", "stories", "ambos"]);

const TETO_DA_REFERENCIA = 10 * 1024 * 1024;

/** Baixa as imagens de referência que o usuário mandou e devolve em JPEG. Link que não é imagem vira aviso, não erro. */
async function baixarReferencias(urls: string[]): Promise<{ imagens: Uint8Array[]; recusadas: string[] }> {
  const imagens: Uint8Array[] = [];
  const recusadas: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0" } });
      const tipo = res.headers.get("content-type") ?? "";
      if (!res.ok || !tipo.startsWith("image/")) throw new Error(tipo || String(res.status));
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > TETO_DA_REFERENCIA) throw new Error("acima de 10 MB");
      imagens.push(await sharp(bytes).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer());
    } catch {
      recusadas.push(url);
    }
  }
  return { imagens, recusadas };
}
const mediaType = z.enum(["IMAGE", "STORIES"]);

/** Grava o evento e devolve o estado novo, ou a recusa da máquina de estados. */
async function aplicar(conversaId: string, evento: Evento) {
  const r = transicionar(await postDaConversa(conversaId), evento);
  if (!r.ok) return r;
  await gravarPost(r.post);
  return { ok: true as const, etapa: r.post.etapa, proximoPasso: proximoPasso(r.post) };
}

const artePublica = async (a: { variant: number; style: string; path: string; problemas: unknown[] }) => ({
  variante: a.variant,
  estilo: a.style,
  url: await urlDaMidia(a.path),
  problemas: a.problemas,
});

/** Lê as leituras das referências da Biblioteca na hora de gerar. */
export type Inspiracoes = () => Promise<string[]>;

export function toolsDePost(conversaId: string, inspiracoes?: Inspiracoes) {
  const atual = (): Promise<EtapaPost | null> => postDaConversa(conversaId);

  return {
    montar_brief: tool({
      description: "Registra o brief estruturado de um post novo e o devolve para o usuário confirmar.",
      inputSchema: z.object({
        pilar: z.enum(PILARES).describe("§12.1, a que pilar de conteúdo o post pertence"),
        tema: z.string(),
        angulo: z.string().optional(),
        data: z.string().optional(),
        precisa_foto_real: z
          .boolean()
          .describe("§8.2, true se a peça representa produto, obra, fábrica, maquinário ou pessoas da EM Vidros"),
        formato: formato.optional().describe("só se o usuário já disse"),
      }),
      execute: async ({ precisa_foto_real, formato, ...resto }) => {
        const brief: Brief = { ...resto, precisaFotoReal: precisa_foto_real };
        const post = await criarPost(conversaId, brief, formato ?? null);
        const candidatas = brief.precisaFotoReal ? await emOrdem(await buscarFotos(`${brief.tema} ${brief.angulo ?? ""}`), fotoPublica) : [];
        return { ok: true as const, postId: post.postId, brief, formato: formato ?? null, fotosCandidatas: candidatas, proximoPasso: proximoPasso(post) };
      },
    }),

    definir_formato: tool({
      description: "Grava o formato do post: feed, stories ou os dois. Chame quando o usuário escolher.",
      inputSchema: z.object({ formato }),
      execute: async ({ formato }) => aplicar(conversaId, { tipo: "formato", formato }),
    }),

    definir_headline: tool({
      description: "Gera o texto que vai dentro da arte. Pré-requisito de gerar_3_artes.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = exigir(await atual(), "headline");
        if (!r.ok) return r;
        const { headline, apoio, problemas } = await definirHeadline(r.post.brief, r.post.formato);
        const estado = await aplicar(conversaId, { tipo: "headline", headline: { headline, apoio } });
        return { ...estado, headline, apoio, problemas, bloqueia: temErro(problemas) };
      },
    }),

    gerar_3_artes: tool({
      description:
        "Gera as 3 variações de arte no formato escolhido, no estilo dos posts reais da EM Vidros. Refazer as artes é chamar de novo. Quando o usuário pedir outro estilo, passe direcao com o que ele pediu, detalhado com o que você achou em pesquisar_referencias.",
      inputSchema: z.object({
        direcao: z
          .string()
          .max(1500)
          .optional()
          .describe(
            "Direção de arte pedida pelo usuário, em inglês ou português: estilo, elementos, composição, tipografia, clima. Concreta, como um diretor de arte escreveria. Omita para o estilo padrão da casa.",
          ),
        referencias: z
          .array(z.string().url())
          .max(3)
          .optional()
          .describe("Links diretos de imagens de referência que o usuário mandou na conversa (terminam em .jpg, .png ou .webp, ou são de CDN de imagem)."),
      }),
      execute: async ({ direcao, referencias }) => {
        const r = exigir(await atual(), "artes");
        if (!r.ok) return r;
        const p = r.post;
        const headline = headlineParaGerar(p);
        if (!headline) return { ok: false as const, motivo: "Sem headline para gerar." };
        // "ambos": feed primeiro, o stories sai depois por derivar_story (PRD US-2).
        const alvo = p.formato === "ambos" ? "feed" : p.formato;
        // Referência é conveniência: sem elas, ou com o banco fora, a arte sai do estilo puro.
        const lidas = [...((await inspiracoes?.().catch(() => [])) ?? []), ...(await escolhasDeArte().catch(() => []))];
        const baixadas = referencias?.length ? await baixarReferencias(referencias) : { imagens: [], recusadas: [] };
        const artes = await generate3Arts({ postId: p.postId, brief: p.brief, formato: alvo, ...headline, inspiracoes: lidas, direcao, referenciasDoUsuario: baixadas.imagens });
        const estado = await aplicar(conversaId, { tipo: "artes", artes });
        return {
          ...estado,
          artes: await emOrdem(artes, artePublica),
          ...(baixadas.recusadas.length ? { referenciasRecusadas: baixadas.recusadas, aviso: "Estes links não eram imagens e ficaram de fora. Peça ao usuário o link direto da imagem ou que suba na Biblioteca." } : {}),
        };
      },
    }),

    mostrar_artes: tool({
      description:
        "Mostra ao usuário, na conversa, as 3 variações de arte do post com um botão de escolha em cada. Chame sempre depois que as artes forem geradas e antes de escolher, publicar ou agendar.",
      inputSchema: z.object({}),
      execute: async () => {
        const p = await atual();
        if (!p || p.etapa === "brief" || p.etapa === "formato" || p.etapa === "headline")
          return { ok: false as const, motivo: "Ainda não há artes neste post. Delegue ao Post a geração das 3 artes." };
        const artes = p.etapa === "artes" ? p.artes : p.opcoes;
        const formato = p.formato === "stories" ? "stories" : "feed";
        const escolhida = p.etapa === "artes" ? null : p.peca.arte.variant;
        return { ok: true as const, postId: p.postId, formato, escolhida, artes: await emOrdem(artes, artePublica) };
      },
    }),

    escolher_arte: tool({
      description: "Registra a variação que o usuário escolheu na conversa, também para trocar uma arte já escolhida. Só chame com o número que o usuário disse ou clicou.",
      inputSchema: z.object({ variante: z.number().int().min(1).max(3) }),
      execute: async ({ variante }) => aplicar(conversaId, { tipo: "escolha", variante }),
    }),

    usar_foto: tool({
      description:
        "Usa uma foto do banco como a arte do post. É o caminho dos posts que exigem foto real e por isso não podem ser gerados. Pré-requisito: formato definido.",
      inputSchema: z.object({ foto_id: z.number().int() }),
      execute: async ({ foto_id }) => {
        const r = exigir(await atual(), "foto");
        if (!r.ok) return r;
        const foto = await pegarFoto(foto_id);
        if (!foto) return { ok: false as const, motivo: `A foto #${foto_id} não existe no banco.` };
        const { postId, formato } = r.post;
        // Foto real não passa pelo gate visual de art/validate.ts: aquele gate mede a
        // paleta do sistema, e uma foto de obra traz as cores do mundo.
        const principal = formato === "ambos" ? "feed" : formato;
        const path = await prepararFoto({ fotoId: foto.id, postId, formato: principal });
        const storyPath = formato === "ambos" ? await prepararFoto({ fotoId: foto.id, postId, formato: "stories" }) : null;
        const arte = { variant: 1, style: "foto-real", path, problemas: [] };
        const estado = await aplicar(conversaId, { tipo: "foto", arte, storyPath });
        return {
          ...estado,
          fotoId: foto.id,
          url: await urlDaMidia(path),
          storyUrl: storyPath && (await urlDaMidia(storyPath)),
          recorte: "automático, confirme o enquadramento com o usuário",
        };
      },
    }),

    derivar_story: tool({
      description: "No formato ambos, gera a versão 9:16 do conceito escolhido.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = exigir(await atual(), "story");
        if (!r.ok) return r;
        const p = r.post;
        if (p.peca.origem !== "gerada") return { ok: false as const, motivo: "A arte escolhida é foto real." };
        const { path, problemas } = await deriveStory({
          postId: p.postId,
          brief: p.brief,
          headline: p.peca.headline.headline,
          chosen: p.peca.arte,
        });
        const estado = await aplicar(conversaId, { tipo: "story", path });
        return { ...estado, url: await urlDaMidia(path), problemas };
      },
    }),

    escrever_legenda: tool({
      description: "Gera a legenda de publicação do post escolhido. Proibido quando formato=stories.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = exigir(await atual(), "legenda");
        if (!r.ok) return r;
        const p = r.post;
        const headline = p.peca.origem === "gerada" ? p.peca.headline.headline : "";
        const { legenda, problemas } = await escreverLegenda(p.brief, headline);
        const estado = await aplicar(conversaId, { tipo: "legenda", legenda });
        return { ...estado, legenda, problemas, bloqueia: temErro(problemas) };
      },
    }),

    agendar_publicacao: tool({
      description: "Agenda a publicação no Instagram.",
      inputSchema: z.object({
        publish_at: z.iso.datetime({ offset: true }).describe("ISO 8601 com o offset de America/Sao_Paulo"),
        media_type: mediaType,
      }),
      execute: async ({ publish_at, media_type }) => {
        const r = await agendarPost(await atual(), media_type, Date.parse(publish_at));
        if (!r.ok) return { ok: false as const, motivo: r.motivo };
        return { ok: true as const, postId: r.postId, mediaType: media_type, publishAt: publish_at };
      },
    }),

    publicar_agora: tool({
      description: "Publica imediatamente no Instagram.",
      inputSchema: z.object({ media_type: mediaType }),
      execute: async ({ media_type }) => {
        const r = midiaParaPublicar(await atual(), media_type);
        if (!r.ok) return r;
        const igMediaId = await publishImage({
          fonte: { tipo: "post", postId: r.post.postId },
          jpegPath: r.post.path,
          mediaType: media_type,
          caption: r.post.legenda,
        });
        await q`UPDATE posts SET status = 'published' WHERE id = ${r.post.postId}`;
        return { ok: true as const, postId: r.post.postId, mediaType: media_type, igMediaId };
      },
    }),
  };
}

/** Ações irreversíveis. O AI SDK para o loop e pede aprovação humana antes de executar. */
export const APROVACAO = {
  publicar_agora: "user-approval",
  agendar_publicacao: "user-approval",
} as const;
