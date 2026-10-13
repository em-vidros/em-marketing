import { tool } from "ai";
import { z } from "zod";
import { db } from "../../db";
import { definirHeadline, escreverLegenda } from "../../domain/caption";
import { deriveStory, generate3Arts, PILARES, type Brief } from "../../domain/art/pipeline";
import { temErro } from "../../domain/brand/validate";
import { buscarFotos, pegarFoto, prepararFoto } from "../../domain/fotos";
import { publishImage } from "../../domain/instagram";
import { attachJpeg, commentOnIssue, createIssue, moveIssueState } from "../../domain/linear";
import { enqueue } from "../../domain/scheduler";
import { urlDaMidia } from "../midia";
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
import { fotoPublica } from "./fotos";

const formato = z.enum(["feed", "stories", "ambos"]);
const mediaType = z.enum(["IMAGE", "STORIES"]);

/** Grava o evento e devolve o estado novo, ou a recusa da máquina de estados. */
function aplicar(conversaId: string, evento: Evento) {
  const r = transicionar(postDaConversa(conversaId), evento);
  if (!r.ok) return r;
  gravarPost(r.post);
  return { ok: true as const, etapa: r.post.etapa, proximoPasso: proximoPasso(r.post) };
}

const artePublica = (a: { variant: number; style: string; path: string; problemas: unknown[] }) => ({
  variante: a.variant,
  estilo: a.style,
  url: urlDaMidia(a.path),
  problemas: a.problemas,
});

export function toolsDePost(conversaId: string) {
  const atual = (): EtapaPost | null => postDaConversa(conversaId);

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
        const post = criarPost(conversaId, brief, formato ?? null);
        const candidatas = brief.precisaFotoReal ? buscarFotos(`${brief.tema} ${brief.angulo ?? ""}`).map(fotoPublica) : [];
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
        const r = exigir(atual(), "headline");
        if (!r.ok) return r;
        const { headline, apoio, problemas } = await definirHeadline(r.post.brief, r.post.formato);
        const estado = aplicar(conversaId, { tipo: "headline", headline: { headline, apoio } });
        return { ...estado, headline, apoio, problemas, bloqueia: temErro(problemas) };
      },
    }),

    gerar_3_artes: tool({
      description: "Gera as 3 variações de arte no formato escolhido. Refazer as artes é chamar de novo.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = exigir(atual(), "artes");
        if (!r.ok) return r;
        const p = r.post;
        const headline = headlineParaGerar(p);
        if (!headline) return { ok: false as const, motivo: "Sem headline para gerar." };
        // "ambos": feed primeiro, o stories sai depois por derivar_story (PRD US-2).
        const alvo = p.formato === "ambos" ? "feed" : p.formato;
        const artes = await generate3Arts({ postId: p.postId, brief: p.brief, formato: alvo, ...headline });
        const estado = aplicar(conversaId, { tipo: "artes", artes });
        return { ...estado, artes: artes.map(artePublica) };
      },
    }),

    escolher_arte: tool({
      description: "Registra a variação que o usuário escolheu.",
      inputSchema: z.object({ variante: z.number().int().min(1).max(3) }),
      execute: async ({ variante }) => aplicar(conversaId, { tipo: "escolha", variante }),
    }),

    usar_foto: tool({
      description:
        "Usa uma foto do banco como a arte do post. É o caminho dos posts que exigem foto real e por isso não podem ser gerados. Pré-requisito: formato definido.",
      inputSchema: z.object({ foto_id: z.number().int() }),
      execute: async ({ foto_id }) => {
        const r = exigir(atual(), "foto");
        if (!r.ok) return r;
        const foto = pegarFoto(foto_id);
        if (!foto) return { ok: false as const, motivo: `A foto #${foto_id} não existe no banco.` };
        const { postId, formato } = r.post;
        // Foto real não passa pelo gate visual de art/validate.ts: aquele gate mede a
        // paleta do sistema, e uma foto de obra traz as cores do mundo.
        const principal = formato === "ambos" ? "feed" : formato;
        const path = await prepararFoto({ fotoId: foto.id, postId, formato: principal });
        const storyPath = formato === "ambos" ? await prepararFoto({ fotoId: foto.id, postId, formato: "stories" }) : null;
        const arte = { variant: 1, style: "foto-real", path, interactionId: "", problemas: [] };
        const estado = aplicar(conversaId, { tipo: "foto", arte, storyPath });
        return {
          ...estado,
          fotoId: foto.id,
          url: urlDaMidia(path),
          storyUrl: storyPath && urlDaMidia(storyPath),
          recorte: "automático, confirme o enquadramento com o usuário",
        };
      },
    }),

    derivar_story: tool({
      description: "No formato ambos, gera a versão 9:16 do conceito escolhido.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = exigir(atual(), "story");
        if (!r.ok) return r;
        const p = r.post;
        if (p.peca.origem !== "gerada") return { ok: false as const, motivo: "A arte escolhida é foto real." };
        const { path, problemas } = await deriveStory({
          postId: p.postId,
          brief: p.brief,
          headline: p.peca.headline.headline,
          chosen: p.peca.arte,
        });
        const estado = aplicar(conversaId, { tipo: "story", path });
        return { ...estado, url: urlDaMidia(path), problemas };
      },
    }),

    escrever_legenda: tool({
      description: "Gera a legenda de publicação do post escolhido. Proibido quando formato=stories.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = exigir(atual(), "legenda");
        if (!r.ok) return r;
        const p = r.post;
        const headline = p.peca.origem === "gerada" ? p.peca.headline.headline : "";
        const { legenda, problemas } = await escreverLegenda(p.brief, headline);
        const estado = aplicar(conversaId, { tipo: "legenda", legenda });
        return { ...estado, legenda, problemas, bloqueia: temErro(problemas) };
      },
    }),

    salvar_linear: tool({
      description: "Cria a issue no Linear com os JPEGs finais e a legenda ou o brief.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = exigir(atual(), "registro");
        if (!r.ok) return r;
        const p = r.post;
        const issue = await createIssue({
          title: `Post IG: ${p.brief.tema}`,
          description: `Brief:\n\`\`\`json\n${JSON.stringify(p.brief, null, 2)}\n\`\`\``,
        });
        await attachJpeg(issue.id, p.peca.arte.path, `feed-v${p.peca.arte.variant}.jpg`);
        if (p.storyPath) await attachJpeg(issue.id, p.storyPath, "story.jpg");
        const headline = p.peca.origem === "gerada" ? p.peca.headline.headline : "";
        await commentOnIssue(
          issue.id,
          p.etapa === "legenda" ? `**Legenda aprovada:**\n\n${p.legenda}` : `**Headline na arte:** ${headline}`,
        );
        await moveIssueState(issue.id, "In Review");
        const estado = aplicar(conversaId, { tipo: "registro", linearId: issue.id });
        return { ...estado, linearId: issue.id, url: issue.url };
      },
    }),

    agendar_publicacao: tool({
      description: "Agenda a publicação no Instagram.",
      inputSchema: z.object({
        publish_at: z.iso.datetime({ offset: true }).describe("ISO 8601 com o offset de America/Sao_Paulo"),
        media_type: mediaType,
      }),
      execute: async ({ publish_at, media_type }) => {
        const r = midiaParaPublicar(atual(), media_type);
        if (!r.ok) return r;
        enqueue(r.post.postId, media_type, new Date(publish_at).toISOString().replace("T", " ").slice(0, 19));
        return { ok: true as const, postId: r.post.postId, mediaType: media_type, publishAt: publish_at };
      },
    }),

    publicar_agora: tool({
      description: "Publica imediatamente no Instagram.",
      inputSchema: z.object({ media_type: mediaType }),
      execute: async ({ media_type }) => {
        const r = midiaParaPublicar(atual(), media_type);
        if (!r.ok) return r;
        const igMediaId = await publishImage({
          postId: r.post.postId,
          jpegPath: r.post.path,
          mediaType: media_type,
          caption: r.post.legenda,
        });
        db.query("UPDATE posts SET status = 'published' WHERE id = ?").run(r.post.postId);
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
