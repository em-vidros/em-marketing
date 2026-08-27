import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
import { db } from "../db";
import { TEXT_MODEL, definirHeadline, escreverLegenda } from "../caption";
import { generate3Arts, deriveStory, type Brief } from "../art/pipeline";
import { sendMessage, sendMediaGroup, inlineKeyboard } from "../telegram/api";
import { enqueue, listQueue, cancelQueueItem } from "../scheduler";
import { publishStep } from "../publish";
import { createIssue, commentOnIssue, attachJpeg, moveIssueState } from "../linear";

let _ai: GoogleGenAI | null = null;
const ai = () => (_ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

const systemPrompt = () =>
  [
    "Você é o agente de marketing da EM Vidros no Telegram. Fala português coloquial, é direto e eficiente.",
    "Fluxo: pedido → brief estruturado (confirmar antes de gastar geração) → formato (Feed/Stories/Os dois) → headline → 3 artes → escolha → legenda (só Feed) → Linear → entregar pra publicar (manual) ou agendar lembrete.",
    "Publicação é MANUAL: o bot entrega a arte final + legenda no Telegram e o time posta na mão no Instagram. Não fale que 'publiquei no Instagram'.",
    "REGRAS RÍGIDAS: (1) nunca chame gerar_3_artes sem formato definido e sem definir_headline antes; (2) nunca chame escrever_legenda quando formato=stories; (3) só entregue/agende com confirmação humana explícita.",
    "Se o usuário já disser o formato na mensagem, não pergunte de novo — só confirme no brief.",
    "\n--- BRANDBOOK ---\n" + readFileSync("brand/BRANDBOOK.md", "utf8"),
    "\n--- TOM DE VOZ ---\n" + readFileSync("brand/voice.md", "utf8"),
    "\n--- TOKENS ---\n" + readFileSync("brand/tokens.json", "utf8"),
  ].join("\n");

const TOOLS = [
  {
    type: "function",
    name: "montar_brief",
    description: "Registra o brief estruturado do post e o apresenta ao usuário para confirmação.",
    parameters: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["data-comemorativa-regional", "dia-da-profissao", "produto-tecnico", "educacional", "promocao-sorteio", "institucional-bastidor"] },
        tema: { type: "string" },
        angulo: { type: "string" },
        data: { type: "string" },
        formato: { type: "string", enum: ["feed", "stories", "ambos"], description: "só se o usuário já disse" },
      },
      required: ["tipo", "tema"],
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
    description: "Agenda um lembrete: no horário definido, o bot entrega a arte + legenda no Telegram para o time publicar na mão. publish_at em ISO 8601 com offset de America/Sao_Paulo, já confirmado com o usuário.",
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
    description: "Entrega agora a arte final e a legenda no Telegram para o time publicar na mão no Instagram. Só depois de confirmação humana explícita.",
    parameters: {
      type: "object",
      properties: { media_type: { type: "string", enum: ["IMAGE", "STORIES"] } },
      required: ["media_type"],
    },
  },
  { type: "function", name: "listar_agenda", description: "Lista a fila de publicações agendadas.", parameters: { type: "object", properties: {} } },
  {
    type: "function",
    name: "cancelar_agendamento",
    description: "Cancela um item da fila pelo id.",
    parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  },
] as any[];

const TZ = "America/Sao_Paulo";

/**
 * O modelo às vezes devolve `2026-08-08T09:00:00` sem offset, e o JS lê ISO sem
 * offset como UTC — o agendamento sairia 3 h adiantado. O Brasil não tem mais
 * horário de verão desde 2019, então -03:00 é fixo.
 */
function saoPauloInstant(publishAt: string): Date {
  const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(publishAt.trim());
  const d = new Date(naive ? `${publishAt.trim().replace(" ", "T")}-03:00` : publishAt);
  if (Number.isNaN(d.getTime())) throw new Error(`data inválida: ${publishAt}`);
  return d;
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
      const { formato, ...b } = args;
      const r = db
        .query("INSERT INTO posts (chat_id, brief, formato) VALUES (?, ?, ?) RETURNING id")
        .get(chatId, JSON.stringify(b), formato ?? null) as any;
      upsertConversation(chatId, { post_id: r.id });
      return `Brief registrado (post ${r.id}). ${formato ? `Formato já definido: ${formato}.` : "Formato ainda não definido."} Apresente o brief ao usuário e peça confirmação.`;
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
      const { headline, apoio } = await definirHeadline(brief, post.formato ?? "feed");
      db.query("UPDATE posts SET headline = ? WHERE id = ?").run(JSON.stringify({ headline, apoio }), post.id);
      return `Headline definido: "${headline}" / apoio: "${apoio}".`;
    }
    case "gerar_3_artes": {
      if (!post || !brief) return "ERRO: sem brief.";
      if (!post.formato) return "ERRO (invariante 1): formato não definido — chame perguntar_formato.";
      if (!post.headline) return "ERRO (invariante 2): chame definir_headline antes.";
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
      const aprovadas = arts.filter((a) => a.qa?.aprovada).length;
      const pendentes = arts
        .filter((a) => a.qa && !a.qa.aprovada)
        .map((a) => `v${a.variant}: ${a.qa!.pendencias.join("; ")}`);
      return `3 artes enviadas com botões. Controle de qualidade automático: ${aprovadas}/3 aprovadas.${
        pendentes.length ? ` Informe o usuário das pendências: ${pendentes.join(" | ")}.` : ""
      } Aguarde a escolha.`;
    }
    case "escrever_legenda": {
      if (!post || !brief) return "ERRO: sem brief.";
      if (post.formato === "stories") return "ERRO (invariante 3): stories não têm legenda — não chame esta tool.";
      const { headline } = post.headline ? JSON.parse(post.headline) : { headline: "" };
      const legenda = await escreverLegenda(brief, headline);
      db.query("UPDATE posts SET legenda = ? WHERE id = ?").run(legenda, post.id);
      return `Legenda gerada:\n${legenda}\nApresente ao usuário.`;
    }
    case "derivar_story": {
      if (!post?.arts || !post?.chosen) return "ERRO: nenhuma arte escolhida ainda.";
      const arts = JSON.parse(post.arts);
      const chosen = arts.find((a: any) => a.variant === post.chosen);
      const { headline } = JSON.parse(post.headline);
      const { path, qa } = await deriveStory({ postId: post.id, brief: brief!, headline, chosen });
      db.query("UPDATE posts SET story_path = ? WHERE id = ?").run(path, post.id);
      const { sendPhoto } = await import("../telegram/api");
      await sendPhoto(chatId, path, { caption: "Versão Stories do conceito escolhido — confirma?" });
      return qa.aprovada
        ? "Story derivado e enviado para confirmação."
        : `Story derivado e enviado para confirmação, mas o controle de qualidade apontou pendências: ${qa.pendencias.join("; ")}. Informe o usuário.`;
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
      await moveIssueState(issue.id, "Em revisão");
      db.query("UPDATE posts SET status = 'archived' WHERE id = ?").run(post.id);
      return `Issue salva no Linear${issue.url ? `: ${issue.url}` : ""}.`;
    }
    case "agendar_publicacao": {
      if (!post) return "ERRO: sem post.";
      const at = saoPauloInstant(args.publish_at);
      enqueue(post.id, args.media_type, at.toISOString().replace("T", " ").slice(0, 19));
      return `Agendado ${args.media_type} para ${at.toLocaleString("pt-BR", { timeZone: TZ })} (horário de Brasília).`;
    }
    case "publicar_agora": {
      if (!post) return "ERRO: sem post.";
      return await publishStep(chatId, post, args.media_type);
    }
    case "listar_agenda": {
      const items = listQueue(chatId);
      if (!items.length) return "Fila vazia.";
      return items
        .map((i) => `#${i.id} ${i.media_type} em ${i.publish_at} — ${JSON.parse(i.brief ?? "{}").tema ?? ""}`)
        .join("\n");
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
