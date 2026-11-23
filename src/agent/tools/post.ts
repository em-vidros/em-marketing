import { tool } from "ai";
import { z } from "zod";
import { emOrdem, idDaImagem, urlDaMidia } from "../../db";
import { definirHeadline, escreverLegenda } from "../../domain/caption";
import { deriveStory, generate3Arts, PILARES, type Brief } from "../../domain/art/pipeline";
import { temErro } from "../../domain/brand/validate";
import { montarBrief, PUBLICOS } from "../../domain/publico";
import { buscarFotos, pegarFoto, prepararFoto } from "../../domain/fotos";
import { publishImage } from "../../domain/instagram";
import {
  criarPost,
  entrarNaFila,
  exigir,
  headlineParaGerar,
  gravarPost,
  midiaParaPublicar,
  postDaConversa,
  proximoPasso,
  transicionar,
  type Arte,
  type Evento,
  type EtapaPost,
  type FotoReal,
} from "../post";
import { ajustarArteDoPost, voltarArteDoPost } from "../ajuste";
import { agendarPecaPronta, agendarPost, pecaProntaParaPublicar } from "../fila";
import { banco, q } from "../../v2/banco";
import { fotoPublica } from "./fotos";
import type { ReferenciasDoTurno } from "../pedido";
import { artePublica, AVISO_DE_LINKS, baixarImagens, produzirPost, referenciasOuNenhuma, type ProgressoDoPost } from "../produzir";

const formato = z.enum(["feed", "stories", "ambos"]);

const mediaType = z.enum(["IMAGE", "STORIES"]);

const pecaProntaId = z
  .uuid()
  .optional()
  .describe("O id de uma peça pronta de listar_pecas_prontas. Omita para o post desta conversa. media_type segue o formato da peça: feed é IMAGE, story é STORIES.");

/** Grava o evento e devolve o estado novo, ou a recusa da máquina de estados. */
async function aplicar(conversaId: string, evento: Evento) {
  const r = transicionar(await postDaConversa(conversaId), evento);
  if (!r.ok) return r;
  await gravarPost(r.post);
  return { ok: true as const, etapa: r.post.etapa, proximoPasso: proximoPasso(r.post) };
}

export function toolsDePost(conversaId: string, referencias?: ReferenciasDoTurno) {
  const atual = (): Promise<EtapaPost | null> => postDaConversa(conversaId);

  return {
    produzir_post: tool({
      description:
        "Produz um post do pedido às 3 artes de uma vez: monta o brief, escreve a headline, gera as 3 variações e escreve a legenda enquanto elas renderizam. Não para para confirmar o brief. Cada arte aparece na conversa, com o botão de escolha, assim que fica pronta. As referências que a pessoa marcou ou colou no pedido guiam as variações sozinhas, sem você repassar. Gerar de novo, inclusive em outro estilo, é chamar de novo.",
      inputSchema: z.object({
        pedido: z.string().describe("O pedido completo, com as palavras da pessoa: tema, data, formato, público e estilo que ela disse, e o que já foi decidido na conversa."),
        direcao: z
          .string()
          .max(1500)
          .optional()
          .describe("Direção de arte concreta quando a pessoa pediu outro estilo, escrita a partir de pesquisar_referencias: composição, elementos, tipografia, textura e luz. Omita no estilo da casa."),
        imagens: z
          .array(z.string().url())
          .max(3)
          .optional()
          .describe("Links diretos de imagens que a pessoa colou na conversa como referência (terminam em .jpg, .png ou .webp, ou são de CDN de imagem)."),
        sem_foto_real: z.boolean().optional().describe("true quando o banco não tem foto real que sirva: a peça sai tipográfica, sem mostrar produto, obra nem pessoas."),
      }),
      execute: async function* ({ pedido, direcao, imagens, sem_foto_real }): AsyncGenerator<ProgressoDoPost> {
        const sair = await entrarNaFila(conversaId);
        try {
          yield* produzirPost(conversaId, { pedido, direcao, imagens, semFotoReal: sem_foto_real }, referencias);
        } finally {
          sair();
        }
      },
    }),

    montar_brief: tool({
      description: "Registra o brief estruturado de um post novo e o devolve para o usuário confirmar.",
      inputSchema: z.object({
        pilar: z.enum(PILARES).describe("§12.1, a que pilar de conteúdo o post pertence"),
        publico: z
          .enum(PUBLICOS)
          .optional()
          .describe("§1.2, para quem o post fala: vidraceiro, arquiteto ou consumidor. Omita só se o pedido não diz; sai vidraceiro. A chamada da headline e da legenda segue esse público."),
        tema: z.string(),
        angulo: z.string().optional(),
        data: z.string().optional(),
        precisa_foto_real: z
          .boolean()
          .describe("§8.2, true se a peça representa produto, obra, fábrica, maquinário ou pessoas da EM Vidros"),
        formato: formato.optional().describe("só se o usuário já disse"),
      }),
      execute: async ({ precisa_foto_real, formato, ...resto }) => {
        const brief = montarBrief({ ...resto, precisaFotoReal: precisa_foto_real });
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
        "Gera as 3 variações de arte no formato escolhido. Cada variação parte de uma imagem diferente, que vai ao modelo: primeiro as referências que a pessoa marcou e as imagens que ela colou no pedido, sozinhas, sem você repassar; sem escolha dela, a referência subida mais recente e uma rotação da Biblioteca que prefere o pilar do post. Refazer as artes é chamar de novo. Quando o usuário pedir outro estilo, passe direcao com o que ele pediu, detalhado com o que você achou em pesquisar_referencias.",
      inputSchema: z.object({
        direcao: z
          .string()
          .max(1500)
          .optional()
          .describe(
            "Direção de arte pedida pelo usuário, em inglês ou português: estilo, elementos, composição, tipografia, clima. Concreta, como um diretor de arte escreveria. Omita para o estilo padrão da casa.",
          ),
        imagens: z
          .array(z.string().url())
          .max(3)
          .optional()
          .describe("Links diretos de imagens que o usuário colou na conversa como referência (terminam em .jpg, .png ou .webp, ou são de CDN de imagem)."),
      }),
      execute: async ({ direcao, imagens }) => {
        const r = exigir(await atual(), "artes");
        if (!r.ok) return r;
        const p = r.post;
        const headline = headlineParaGerar(p);
        if (!headline) return { ok: false as const, motivo: "Sem headline para gerar." };

        // "ambos": feed primeiro, o stories sai depois por derivar_story (PRD US-2).
        const alvo = p.formato === "ambos" ? "feed" : p.formato;
        // Até 3 âncoras, uma por variação; o que a pessoa escolheu além disso vai junto nas 3, como os links colados.
        const carregadas = await referenciasOuNenhuma(referencias, p.brief.pilar);
        const baixadas = imagens?.length ? await baixarImagens(imagens) : { imagens: [], recusadas: [] };
        const anexos = [...carregadas.slice(3).map((r) => r.imagem), ...baixadas.imagens];

        const artes = await generate3Arts({ postId: p.postId, brief: p.brief, formato: alvo, ...headline, direcao, referencias: carregadas.slice(0, 3), anexos });
        referencias?.usar(carregadas);
        const estado = await aplicar(conversaId, { tipo: "artes", artes });

        return {
          ...estado,
          artes: await emOrdem(artes, artePublica),
          ...(baixadas.recusadas.length ? { imagensRecusadas: baixadas.recusadas, aviso: AVISO_DE_LINKS } : {}),
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
        const arte: FotoReal = { variant: 1, foto: true, path, problemas: [] };
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
          apoio: p.peca.headline.apoio || undefined,
          chosen: p.peca.arte,
        });
        const estado = await aplicar(conversaId, { tipo: "story", path });
        return { ...estado, postId: p.postId, url: await urlDaMidia(path), imagemId: await idDaImagem(path), problemas };
      },
    }),

    ajustar_arte: tool({
      description:
        "Muda uma coisa pontual na arte escolhida, como trocar um texto ou tirar um objeto, e mantém o resto da arte igual. A versão de antes fica guardada. Só chame quando a pessoa pedir a mudança nesta conversa. Nunca chame por conta própria, nem para corrigir um aviso da conferência do texto: sugira e espere o pedido. Um pedido por chamada.",
      inputSchema: z.object({
        tipo: z.enum(["texto", "objeto"]).describe("texto: trocar um texto pintado na arte. objeto: mudar ou tirar um elemento da cena."),
        texto_atual: z.string().max(400).optional().describe("Só em tipo texto: o texto que está na arte hoje, como aparece nela."),
        texto_novo: z.string().min(1).max(400).optional().describe("Só em tipo texto: o texto que entra no lugar, exatamente como a pessoa quer."),
        objeto: z.string().max(300).optional().describe("Só em tipo objeto: o elemento e onde fica, em inglês, como 'the vase in the bottom left corner'."),
        mudanca: z.string().max(500).optional().describe("Só em tipo objeto: o que fazer com ele, em inglês, como 'remove it'."),
      }),
      execute: async ({ tipo, texto_atual, texto_novo, objeto, mudanca }) => {
        if (tipo === "texto" && !(texto_atual && texto_novo)) return { ok: false as const, motivo: "Num ajuste de texto, mande texto_atual e texto_novo." };
        if (tipo === "objeto" && !(objeto && mudanca)) return { ok: false as const, motivo: "Num ajuste de objeto, mande objeto e mudanca." };
        const pedido = tipo === "texto" ? { tipo, atual: texto_atual!, novo: texto_novo! } : { tipo, objeto: objeto!, mudanca: mudanca! };
        return ajustarArteDoPost(await atual(), pedido);
      },
    }),

    voltar_arte: tool({
      description: "Desfaz o último ajuste da arte escolhida: ela volta a ser como estava antes dele. Chame quando a pessoa pedir para voltar como estava.",
      inputSchema: z.object({}),
      execute: async () => voltarArteDoPost(await atual()),
    }),

    escrever_legenda: tool({
      description: "Gera a legenda de publicação do post escolhido. Proibido quando formato=stories.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = exigir(await atual(), "legenda");
        if (!r.ok) return r;
        const p = r.post;
        const headline = !("peca" in p) ? p.headline.headline : p.peca.origem === "gerada" ? p.peca.headline.headline : "";
        const { legenda, problemas } = await escreverLegenda(p.brief, headline);
        const estado = await aplicar(conversaId, { tipo: "legenda", legenda });
        return { ...estado, legenda, problemas, bloqueia: temErro(problemas) };
      },
    }),

    agendar_publicacao: tool({
      description:
        "Agenda a publicação no Instagram. Sem peca_pronta_id, agenda o post desta conversa. Com peca_pronta_id, agenda aquela peça pronta da Biblioteca como está, com a legenda guardada nela, que a pessoa revisa no cartão de aprovação.",
      inputSchema: z.object({
        publish_at: z.iso.datetime({ offset: true }).describe("ISO 8601 com o offset de America/Sao_Paulo"),
        media_type: mediaType,
        peca_pronta_id: pecaProntaId,
      }),
      execute: async ({ publish_at, media_type, peca_pronta_id }) => {
        if (peca_pronta_id) {
          const r = await agendarPecaPronta(banco(), peca_pronta_id, media_type, Date.parse(publish_at));
          if (!r.ok) return { ok: false as const, motivo: r.motivo };
          return { ok: true as const, pecaProntaId: peca_pronta_id, mediaType: media_type, publishAt: publish_at };
        }
        const r = await agendarPost(await atual(), media_type, Date.parse(publish_at));
        if (!r.ok) return { ok: false as const, motivo: r.motivo };
        return { ok: true as const, postId: r.postId, mediaType: media_type, publishAt: publish_at };
      },
    }),

    publicar_agora: tool({
      description:
        "Publica imediatamente no Instagram. Sem peca_pronta_id, publica o post desta conversa. Com peca_pronta_id, publica aquela peça pronta da Biblioteca como está, com a legenda guardada nela.",
      inputSchema: z.object({ media_type: mediaType, peca_pronta_id: pecaProntaId }),
      execute: async ({ media_type, peca_pronta_id }) => {
        if (peca_pronta_id) {
          const p = await pecaProntaParaPublicar(banco(), peca_pronta_id, media_type);
          if (!p.ok) return { ok: false as const, motivo: p.motivo };
          const { fonte, jpegPath, legenda } = p.peca;
          const igMediaId = await publishImage({ fonte, jpegPath, mediaType: media_type, caption: legenda ?? undefined });
          return { ok: true as const, pecaProntaId: peca_pronta_id, mediaType: media_type, igMediaId };
        }
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
