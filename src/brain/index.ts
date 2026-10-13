import { GoogleGenAI } from "@google/genai";
import { db } from "../db";
import { TEXT_MODEL, definirHeadline, escreverLegenda } from "../caption";
import { generate3Arts, deriveStory, PILARES, type Brief } from "../art/pipeline";
import { CONVERSA, tokens } from "../brand";
import { formatarProblemas, temErro } from "../brand/validate";
import { sendMessage, sendMediaGroup, inlineKeyboard } from "../telegram/api";
import { enqueue, listQueue, cancelQueueItem } from "../scheduler";
import { proximasDatas } from "../scheduler/calendar";
import { buscarFotos, contarFotos, pegarFoto, prepararFoto, resumir } from "../fotos";
import { publishImage } from "../instagram";
import { createIssue, commentOnIssue, attachJpeg, moveIssueState } from "../linear";

let _ai: GoogleGenAI | null = null;
const ai = () => (_ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

const systemPrompt = () =>
  [
    "Você é o agente de marketing da EM Vidros no Telegram. Fala português coloquial, é direto e eficiente.",
    "Fluxo: pedido → brief estruturado (confirmar antes de gastar geração) → formato (Feed/Stories/Os dois) → headline → 3 artes → escolha → legenda (só Feed) → Linear → publicar/agendar.",
    "REGRAS RÍGIDAS: (1) nunca chame gerar_3_artes sem formato definido e sem definir_headline antes; (2) nunca chame escrever_legenda quando formato=stories; (3) publicação só com confirmação humana explícita.",
    "Se o usuário já disser o formato na mensagem, não pergunte de novo — só confirme no brief.",
    "",
    "TODO POST TEM UM PILAR (§12.1). Classifique no brief: PROVA (obra entregue, produto na prateleira, capacidade fabril), AUTORIDADE (norma, espessura, tipo de vidro, erro de especificação), GENTE (bastidor, equipe, rota, vaga), MARCA (aniversário, data do setor ou da região, comunicado).",
    "",
    "POLÍTICA DE IMAGEM (§8.2) — classifique no brief o campo precisa_foto_real. Marque true se a peça representa produto da EM Vidros, obra entregue, a fábrica, maquinário ou pessoas da empresa. Teste: se alguém pode olhar a imagem e acreditar que aquilo é uma obra, um produto ou uma pessoa da EM Vidros, é foto real e o sistema NÃO gera. PROVA e GENTE quase sempre pedem foto real.",
    "Quando precisa_foto_real for true o fluxo muda: buscar_fotos → usar_foto (no lugar de definir_headline → gerar_3_artes). Só peça foto nova ao usuário depois de olhar o banco. Qualquer foto mandada no chat é arquivada e catalogada automaticamente.",
    "",
    "As legendas, os headlines e as artes são validados por código: texto contra o checklist do capítulo 16, imagem contra a paleta e as zonas seguras. Quando uma tool devolver problemas, mostre-os ao usuário em português claro em vez de ignorá-los.",
    "\n--- BRANDBOOK (capítulos de conteúdo) ---\n" + CONVERSA(),
    "\n--- TOKENS ---\n" + JSON.stringify(tokens),
  ].join("\n");

const TOOLS = [
  {
    type: "function",
    name: "montar_brief",
    description: "Registra o brief estruturado do post e o apresenta ao usuário para confirmação.",
    parameters: {
      type: "object",
      properties: {
        pilar: { type: "string", enum: [...PILARES], description: "§12.1 — a que pilar de conteúdo o post pertence" },
        tema: { type: "string" },
        angulo: { type: "string" },
        data: { type: "string" },
        precisa_foto_real: {
          type: "boolean",
          description:
            "§8.2 — true se a peça representa produto, obra, fábrica, maquinário ou pessoas da EM Vidros. Nesse caso o sistema não gera a imagem e você deve pedir a foto.",
        },
        formato: { type: "string", enum: ["feed", "stories", "ambos"], description: "só se o usuário já disse" },
      },
      required: ["pilar", "tema", "precisa_foto_real"],
    },
  },
  {
    type: "function",
    name: "perguntar_formato",
    description: "Mostra os botões Feed/Stories/Os dois. Chame quando o brief estiver confirmado e o formato ainda não estiver definido.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "definir_headline",
    description: "Gera o texto que vai DENTRO da arte. Pré-requisito obrigatório de gerar_3_artes.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "gerar_3_artes",
    description: "Gera as 3 variações de arte no formato escolhido e envia ao usuário com botões de escolha.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "buscar_fotos",
    description:
      "Busca no banco de fotos reais da EM Vidros. Chame SEMPRE que o brief exigir foto real (§8.2), antes de pedir foto nova ao usuário — pode já existir uma.",
    parameters: {
      type: "object",
      properties: {
        termo: { type: "string", description: "produto, unidade ou contexto — ex.: 'box temperado Imperatriz'. Omita para ver as mais recentes." },
      },
    },
  },
  {
    type: "function",
    name: "usar_foto",
    description:
      "Usa uma foto do banco como a arte do post em andamento. É o caminho dos posts que exigem foto real e por isso não podem ser gerados. Pré-requisito: formato definido.",
    parameters: { type: "object", properties: { foto_id: { type: "number" } }, required: ["foto_id"] },
  },
  {
    type: "function",
    name: "escrever_legenda",
    description: "Gera a legenda de publicação. PROIBIDO quando formato=stories.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "derivar_story",
    description: "No fluxo 'ambos', gera a versão 9:16 do conceito escolhido.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "salvar_linear",
    description: "Cria a issue no Linear com os JPEGs finais e a legenda/brief.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "agendar_publicacao",
    description: "Agenda a publicação. publish_at em ISO 8601 com offset de America/Sao_Paulo, já confirmado com o usuário.",
    parameters: {
      type: "object",
      properties: {
        publish_at: { type: "string" },
        media_type: { type: "string", enum: ["IMAGE", "STORIES"] },
      },
      required: ["publish_at", "media_type"],
    },
  },
  {
    type: "function",
    name: "publicar_agora",
    description: "Publica imediatamente no Instagram. Só depois de confirmação humana explícita.",
    parameters: {
      type: "object",
      properties: { media_type: { type: "string", enum: ["IMAGE", "STORIES"] } },
      required: ["media_type"],
    },
  },
  { type: "function", name: "listar_agenda", description: "Lista a fila de publicações agendadas.", parameters: { type: "object", properties: {} } },
  {
    type: "function",
    name: "status_do_mes",
    description:
      "Mostra a cota do mês contra as metas do brandbook: mix de pilares 40/25/20/15 (§12.1), 8 a 10 publicações (§13.3) e 60% em vídeo (§12.3). Chame quando perguntarem o que falta postar, ou antes de propor pauta.",
    parameters: { type: "object", properties: { mes: { type: "string", description: "AAAA-MM; omita para o mês corrente" } } },
  },
  {
    type: "function",
    name: "cancelar_agendamento",
    description: "Cancela um item da fila pelo id.",
    parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  },
] as any[];

// --- cota de pilares (§12.1) ---

export interface ItemDeCota {
  pilar: keyof typeof tokens.pilares;
  feitos: number;
  ideal: number;
  faltam: number;
}

/**
 * A base é o mês fechado na cadência mínima, não o que já saiu.
 * Com 2 posts publicados, 40% de 2 arredonda para 1: o sistema diria "PROVA no
 * alvo" com o mês inteiro pela frente, e o buraco só apareceria no dia 30.
 */
export function cotaDePilares(feitosPorPilar: Record<string, number>, total: number): { base: number; itens: ItemDeCota[] } {
  const base = Math.max(total, tokens.cadencia.publicacoesPorMesMin);
  const itens = (Object.keys(tokens.pilares) as (keyof typeof tokens.pilares)[]).map((pilar) => {
    const feitos = feitosPorPilar[pilar] ?? 0;
    const ideal = Math.round(tokens.pilares[pilar].percentual * base);
    return { pilar, feitos, ideal, faltam: Math.max(0, ideal - feitos) };
  });
  return { base, itens };
}

// --- estado do post em andamento ---

function currentPost(chatId: number): any {
  const conv = db.query("SELECT post_id FROM conversations WHERE chat_id = ?").get(chatId) as any;
  if (!conv?.post_id) return null;
  return db.query("SELECT * FROM posts WHERE id = ?").get(conv.post_id);
}

function upsertConversation(chatId: number, fields: { interaction_id?: string | null; post_id?: number | null }) {
  db.query(
    `INSERT INTO conversations (chat_id, interaction_id, post_id) VALUES ($c, $i, $p)
     ON CONFLICT(chat_id) DO UPDATE SET
       interaction_id = COALESCE($i, interaction_id),
       post_id = COALESCE($p, post_id),
       updated_at = datetime('now')`,
  ).run({ $c: chatId, $i: fields.interaction_id ?? null, $p: fields.post_id ?? null });
}

// --- execução das tools (invariantes checadas AQUI, não confiadas ao modelo) ---

async function execTool(chatId: number, name: string, args: any): Promise<string> {
  const post = currentPost(chatId);
  const brief: Brief | null = post?.brief ? JSON.parse(post.brief) : null;

  switch (name) {
    case "montar_brief": {
      const { formato, precisa_foto_real, ...resto } = args;
      const b = { ...resto, pilar: String(args.pilar).toUpperCase(), precisaFotoReal: !!precisa_foto_real };
      if (!(PILARES as readonly string[]).includes(b.pilar))
        return `ERRO: pilar "${args.pilar}" não existe. Use um de ${PILARES.join(", ")} (§12.1).`;
      const r = db
        .query("INSERT INTO posts (chat_id, brief, pilar, formato) VALUES (?, ?, ?, ?) RETURNING id")
        .get(chatId, JSON.stringify(b), b.pilar, formato ?? null) as any;
      upsertConversation(chatId, { post_id: r.id });
      const candidatas = b.precisaFotoReal ? buscarFotos(`${b.tema} ${b.angulo ?? ""}`) : [];
      const aviso = b.precisaFotoReal
        ? " ATENÇÃO: você marcou que a peça representa algo real (§8.2) — o sistema não vai gerar essa imagem." +
          (candidatas.length
            ? ` O banco tem ${candidatas.length} foto(s) que podem servir:\n${candidatas.map(resumir).join("\n")}\nOfereça-as antes de pedir foto nova.`
            : " Não há foto no banco para esse tema — peça a foto ao usuário e explique a regra.")
        : "";
      return `Brief registrado (post ${r.id}), pilar ${b.pilar}. ${formato ? `Formato já definido: ${formato}.` : "Formato ainda não definido."}${aviso} Apresente o brief ao usuário e peça confirmação.`;
    }
    case "perguntar_formato": {
      if (!post) return "ERRO: não há post em andamento — chame montar_brief primeiro.";
      await sendMessage(chatId, "Qual o formato do post?", inlineKeyboard([[
        { text: "Feed", data: `fmt:feed:${post.id}` },
        { text: "Stories", data: `fmt:stories:${post.id}` },
        { text: "Os dois", data: `fmt:ambos:${post.id}` },
      ]]));
      return "Botões enviados. Aguarde a escolha do usuário; não gere nada até lá.";
    }
    case "definir_headline": {
      if (!post || !brief) return "ERRO: sem brief.";
      const { headline, apoio, problemas } = await definirHeadline(brief, post.formato ?? "feed");
      db.query("UPDATE posts SET headline = ? WHERE id = ?").run(JSON.stringify({ headline, apoio }), post.id);
      const nota = problemas.length
        ? `\nO validador do capítulo 16 ainda aponta:\n${formatarProblemas(problemas)}${temErro(problemas) ? "\nMostre isso ao usuário antes de gerar as artes." : ""}`
        : "";
      return `Headline definido: "${headline}" / apoio: "${apoio}".${nota}`;
    }
    case "gerar_3_artes": {
      if (!post || !brief) return "ERRO: sem brief.";
      if (!post.formato) return "ERRO (invariante 1): formato não definido — chame perguntar_formato.";
      if (!post.headline) return "ERRO (invariante 2): chame definir_headline antes.";
      if (brief.precisaFotoReal)
        return (
          "ERRO (invariante 4, §8.2): esta peça representa produto, obra, fábrica ou pessoas da EM Vidros e exige foto real. Não gere." +
          " Chame buscar_fotos primeiro — o banco pode já ter a foto. Se não tiver, peça ao usuário com o guia do §8.3:" +
          " luz natural difusa de lado, ângulo 15–30° fora do eixo, fundo limpo, enquadramento vertical."
        );
      const { headline, apoio } = JSON.parse(post.headline);
      const formato = post.formato === "ambos" ? "feed" : post.formato; // "os dois": Feed primeiro (PRD US-2)
      const arts = await generate3Arts({ postId: post.id, brief, formato, headline, apoio });
      db.query("UPDATE posts SET arts = ?, status = 'generated' WHERE id = ?").run(JSON.stringify(arts), post.id);
      await sendMediaGroup(chatId, arts.map((a) => a.path), `3 opções — ${brief.tema}`);
      const buttons = [
        [
          { text: "v1", data: `pick:1:${post.id}` },
          { text: "v2", data: `pick:2:${post.id}` },
          { text: "v3", data: `pick:3:${post.id}` },
        ],
        [{ text: "🔄 Refazer artes", data: `redo:${post.id}` }],
      ];
      if (post.formato !== "stories") buttons[1]!.push({ text: "✍️ Reescrever legenda", data: `recap:${post.id}` });
      await sendMessage(chatId, "Qual você prefere?", inlineKeyboard(buttons));

      // Gate visual: o modelo de imagem recebeu a paleta no prompt, mas quem
      // confere é a medição no JPEG (art/validate.ts).
      const laudo = arts
        .filter((a) => a.problemas.length)
        .map((a) => `v${a.variant} (${a.style}):\n${formatarProblemas(a.problemas)}`)
        .join("\n");
      return laudo
        ? `3 artes enviadas com botões. O gate visual apontou:\n${laudo}\n\nAvise o usuário em português claro — sobretudo os ERROS — e ofereça refazer.`
        : "3 artes enviadas com botões. Gate visual limpo. Aguarde a escolha.";
    }
    case "buscar_fotos": {
      const achadas = buscarFotos(args.termo);
      if (!achadas.length)
        return contarFotos()
          ? `Nenhuma foto do banco casa com "${args.termo ?? ""}". Peça a foto ao usuário com o guia do §8.3.`
          : "O banco de fotos está vazio. Peça a foto ao usuário — é só mandar no chat que eu arquivo e cataloco sozinho.";
      return `Fotos no banco:\n${achadas.map(resumir).join("\n")}\n\nMostre ao usuário e confirme qual usar antes de chamar usar_foto.`;
    }
    case "usar_foto": {
      if (!post || !brief) return "ERRO: sem brief.";
      if (!post.formato) return "ERRO (invariante 1): formato não definido — chame perguntar_formato.";
      const foto = pegarFoto(Number(args.foto_id));
      if (!foto) return `ERRO: foto #${args.foto_id} não existe no banco.`;

      // Foto real não passa pelo gate visual de art/validate.ts: aquele gate mede
      // a paleta do sistema, e uma foto de obra legitimamente traz as cores do
      // mundo. Reprovar aqui seria ruído garantido.
      const principal = post.formato === "ambos" ? "feed" : post.formato;
      const path = await prepararFoto({ fotoId: foto.id, postId: post.id, formato: principal });
      const arts = [{ variant: 1, style: "foto-real", path, interactionId: "", problemas: [] }];
      const storyPath =
        post.formato === "ambos"
          ? await prepararFoto({ fotoId: foto.id, postId: post.id, formato: "stories" })
          : post.formato === "stories"
            ? path
            : null;

      db.query("UPDATE posts SET arts = ?, chosen = 1, story_path = ?, status = 'chosen' WHERE id = ?").run(
        JSON.stringify(arts),
        storyPath,
        post.id,
      );
      const { sendPhoto } = await import("../telegram/api");
      await sendPhoto(chatId, path, { caption: `Foto #${foto.id} recortada para ${principal}. Confirma?` });
      return (
        `Foto #${foto.id} virou a arte do post ${post.id} (${principal}${storyPath && storyPath !== path ? " + stories" : ""}).` +
        " O recorte foi automático — confirme com o usuário se o enquadramento ficou bom antes de seguir." +
        (post.formato === "stories" ? "" : " Depois: legenda → Linear → publicar/agendar.") +
        " Não chame derivar_story: a versão vertical já saiu da própria foto."
      );
    }
    case "escrever_legenda": {
      if (!post || !brief) return "ERRO: sem brief.";
      if (post.formato === "stories") return "ERRO (invariante 3): stories não têm legenda — não chame esta tool.";
      const { headline } = post.headline ? JSON.parse(post.headline) : { headline: "" };
      const { legenda, problemas } = await escreverLegenda(brief, headline);
      db.query("UPDATE posts SET legenda = ? WHERE id = ?").run(legenda, post.id);
      const nota = problemas.length
        ? `\n\nO validador do capítulo 16 ainda aponta:\n${formatarProblemas(problemas)}${temErro(problemas) ? "\nMostre esses erros ao usuário e ofereça reescrever." : ""}`
        : "";
      return `Legenda gerada:\n${legenda}${nota}\n\nApresente ao usuário.`;
    }
    case "derivar_story": {
      if (!post?.arts || !post?.chosen) return "ERRO: nenhuma arte escolhida ainda.";
      const arts = JSON.parse(post.arts);
      const chosen = arts.find((a: any) => a.variant === post.chosen);
      if (chosen?.style === "foto-real")
        return "ERRO (§8.2): a arte escolhida é uma foto real e não pode ser regenerada em 9:16. A versão vertical já foi recortada da própria foto por usar_foto — siga o fluxo.";
      const { headline } = JSON.parse(post.headline);
      const { path, problemas } = await deriveStory({ postId: post.id, brief: brief!, headline, chosen });
      db.query("UPDATE posts SET story_path = ? WHERE id = ?").run(path, post.id);
      const { sendPhoto } = await import("../telegram/api");
      await sendPhoto(chatId, path, { caption: "Versão Stories do conceito escolhido — confirma?" });
      return problemas.length
        ? `Story derivado e enviado. O gate visual apontou:\n${formatarProblemas(problemas)}\nMostre isso ao usuário.`
        : "Story derivado e enviado para confirmação. Gate visual limpo.";
    }
    case "salvar_linear": {
      if (!post || !brief) return "ERRO: sem post.";
      const issue = post.linear_issue_id
        ? { id: post.linear_issue_id, url: "" }
        : await createIssue({ title: `Post IG — ${brief.tema}`, description: `Brief:\n\`\`\`json\n${post.brief}\n\`\`\`` });
      if (!post.linear_issue_id)
        db.query("UPDATE posts SET linear_issue_id = ? WHERE id = ?").run(issue.id, post.id);
      const arts = JSON.parse(post.arts ?? "[]");
      const chosen = arts.find((a: any) => a.variant === post.chosen);
      if (chosen) await attachJpeg(issue.id, chosen.path, `feed-v${post.chosen}.jpg`);
      if (post.story_path) await attachJpeg(issue.id, post.story_path, "story.jpg");
      const headline = post.headline ? JSON.parse(post.headline).headline : "";
      await commentOnIssue(issue.id, post.legenda ? `**Legenda aprovada:**\n\n${post.legenda}` : `**Brief:** ${post.brief}\n\n**Headline na arte:** ${headline}`);
      await moveIssueState(issue.id, "In Review");
      db.query("UPDATE posts SET status = 'archived' WHERE id = ?").run(post.id);
      return `Issue salva no Linear${issue.url ? `: ${issue.url}` : ""}.`;
    }
    case "agendar_publicacao": {
      if (!post) return "ERRO: sem post.";
      enqueue(post.id, args.media_type, new Date(args.publish_at).toISOString().replace("T", " ").slice(0, 19));
      return `Agendado ${args.media_type} para ${args.publish_at}.`;
    }
    case "publicar_agora": {
      if (!post) return "ERRO: sem post.";
      const arts = JSON.parse(post.arts ?? "[]");
      const chosen = arts.find((a: any) => a.variant === post.chosen);
      const jpegPath = args.media_type === "STORIES" ? (post.story_path ?? chosen?.path) : chosen?.path;
      if (!jpegPath) return "ERRO: arte escolhida não encontrada.";
      const igId = await publishImage({
        postId: post.id,
        jpegPath,
        mediaType: args.media_type,
        caption: args.media_type === "IMAGE" ? post.legenda : undefined,
      });
      db.query("UPDATE posts SET status = 'published' WHERE id = ?").run(post.id);
      return `Publicado! id ${igId}.`;
    }
    case "listar_agenda": {
      const items = listQueue(chatId);
      if (!items.length) return "Fila vazia.";
      return items
        .map((i) => `#${i.id} ${i.media_type} em ${i.publish_at} — ${JSON.parse(i.brief ?? "{}").tema ?? ""}`)
        .join("\n");
    }
    case "status_do_mes": {
      // Brasil é UTC-3 sem horário de verão desde 2019; created_at é UTC.
      const mes = args.mes ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date());
      const linhas = db
        .query(
          `SELECT COALESCE(pilar,'(sem pilar)') AS pilar, COUNT(*) AS n
             FROM posts
            WHERE strftime('%Y-%m', created_at, '-3 hours') = ?
              AND status IN ('archived','scheduled','published')
            GROUP BY 1`,
        )
        .all(mes) as { pilar: string; n: number }[];

      const total = linhas.reduce((s, l) => s + l.n, 0);
      const { publicacoesPorMesMin, publicacoesPorMesMax, videoMin, proporcaoVideoAlvo } = tokens.cadencia;
      const semPilar = linhas.find((l) => l.pilar === "(sem pilar)")?.n ?? 0;

      const { base, itens: cota } = cotaDePilares(
        Object.fromEntries(linhas.map((l) => [l.pilar, l.n])),
        total,
      );

      const mix = cota.map(
        (c) =>
          `- ${c.pilar}: ${c.feitos} de ${c.ideal} (meta ${Math.round(tokens.pilares[c.pilar].percentual * 100)}% de ${base}). ` +
          (c.faltam ? `faltam ${c.faltam}` : c.feitos > c.ideal ? `${c.feitos - c.ideal} acima` : "no alvo"),
      );

      const diagnostico = [
        total
          ? `Mês ${mes} — ${total} publicações (meta ${publicacoesPorMesMin}–${publicacoesPorMesMax}, §13.3).`
          : `Mês ${mes} — nenhuma publicação registrada ainda. Meta: ${publicacoesPorMesMin}–${publicacoesPorMesMax} publicações (§13.3).`,
        ...mix,
        semPilar ? `- ${semPilar} sem pilar registrado (posts anteriores à cota).` : "",
        `Vídeo: 0 de ${total}. A meta é ${videoMin} (${Math.round(proporcaoVideoAlvo * 100)}%, §12.3) e este sistema só produz peça estática — o vídeo é feito fora dele.`,
        total < publicacoesPorMesMin ? `Faltam ${publicacoesPorMesMin - total} publicações para a cadência mínima (D2).` : "",
      ].filter(Boolean);

      // Diagnóstico sem proposta é relatório. O código calcula o buraco e junta
      // o material (pilar deficitário, datas que passam no §12.4, fotos que já
      // existem no banco); quem redige a pauta é o modelo.
      const deficit = cota.filter((c) => c.faltam > 0).sort((a, b) => b.faltam - a.faltam);
      const proposta: string[] = ["", "--- PRÓXIMO PASSO (não é opcional: proponha, não pergunte) ---"];

      if (!deficit.length) {
        proposta.push("A cota está fechada. Se o usuário quiser mais, sugira reforçar PROVA, que é o pilar de maior peso.");
      } else {
        proposta.push(`Buraco por ordem de tamanho: ${deficit.map((d) => `${d.pilar} (${d.faltam})`).join(", ")}.`);
        for (const d of deficit.slice(0, 3)) {
          const t = tokens.pilares[d.pilar];
          proposta.push(`- ${d.pilar}: ${t.objetivo}. Formato natural: ${t.formato}. CTA: ${t.cta}.`);
        }
      }

      const datas = proximasDatas(45);
      proposta.push(
        datas.length
          ? `Datas que passam na trava do §12.4 nos próximos 45 dias: ${datas.map((d) => `${d.ocasiao} (em ${d.emDias} dia${d.emDias === 1 ? "" : "s"})`).join("; ")}. Só essas — não invente data.`
          : "Nenhuma data do §12.4 nos próximos 45 dias. Não force pauta de data comemorativa.",
      );

      const nFotos = contarFotos();
      proposta.push(
        `PROVA e GENTE quase sempre exigem foto real (§8.2). O banco tem ${nFotos} foto${nFotos === 1 ? "" : "s"} — ` +
          (nFotos ? "chame buscar_fotos antes de propor esses pilares e ancore a pauta no que já existe." : "sem foto no banco, peça uma ao usuário junto com a proposta."),
      );
      proposta.push(
        "Agora escreva 3 pautas concretas (tema + ângulo + pilar + formato), não categorias. Termine perguntando qual delas ele quer que você monte.",
      );

      return [...diagnostico, ...proposta].join("\n");
    }
    case "cancelar_agendamento":
      return cancelQueueItem(args.id) ? `Item #${args.id} cancelado.` : `Item #${args.id} não está pendente.`;
    default:
      return `Tool desconhecida: ${name}`;
  }
}

// --- loop do cérebro ---

function extractSteps(interaction: any): { text: string; calls: { id: string; name: string; arguments: any }[] } {
  let text = "";
  const calls: any[] = [];
  for (const step of interaction.steps ?? []) {
    if (step.type === "function_call") calls.push(step);
    const content = step.content ?? step;
    const scan = (n: any) => {
      if (!n || typeof n !== "object") return;
      if (n.type === "text" && typeof n.text === "string") text += n.text;
      if (n.type === "function_call") calls.push(n);
      for (const v of Array.isArray(n) ? n : Object.values(n)) scan(v);
    };
    scan(content);
  }
  return { text: text.trim(), calls };
}

export async function brainTurn(chatId: number, userInput: string): Promise<void> {
  const conv = db.query("SELECT interaction_id FROM conversations WHERE chat_id = ?").get(chatId) as any;
  let previousId: string | undefined = conv?.interaction_id ?? undefined;
  let input: any = userInput;

  for (let hop = 0; hop < 8; hop++) {
    const interaction: any = await ai().interactions.create({
      model: TEXT_MODEL,
      system_instruction: systemPrompt(),
      tools: TOOLS,
      input,
      previous_interaction_id: previousId,
      store: true,
    });
    previousId = interaction.id;
    upsertConversation(chatId, { interaction_id: interaction.id });

    const { text, calls } = extractSteps(interaction);
    if (!calls.length) {
      if (text) await sendMessage(chatId, text);
      return;
    }
    const results = [];
    for (const call of calls) {
      let result: string;
      try {
        result = await execTool(chatId, call.name, call.arguments ?? {});
      } catch (err: any) {
        result = `ERRO ao executar ${call.name}: ${err.message ?? err}`;
      }
      results.push({ type: "function_result", call_id: call.id, name: call.name, result });
    }
    input = results;
  }
  await sendMessage(chatId, "⚠️ Muitas etapas seguidas — me diga como continuar.");
}
