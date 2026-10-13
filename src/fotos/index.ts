import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { db } from "../db";
import { TEXT_MODEL } from "../caption";
import { tokens } from "../brand";
import type { Formato } from "../art/generate";

/**
 * Banco de fotos reais.
 *
 * O §8.2 proíbe gerar produto, obra, fábrica, maquinário e pessoas da EM Vidros
 * — e a F4 passou a recusar essas peças em código. Recusa sem alternativa vira
 * paralisia: o caminho de menor resistência volta a ser gerar por IA e mentir no
 * brief. Este módulo é a alternativa — a foto que a equipe já tem no celular
 * entra pelo Telegram, é catalogada e vira a arte do post.
 *
 * A catalogação é automática de propósito: banco que depende de alguém preencher
 * campo na hora do upload fica sem tags em duas semanas e deixa de ser buscável.
 */

let _ai: GoogleGenAI | null = null;
const ai = () => (_ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

export interface Foto {
  id: number;
  path: string;
  descricao: string | null;
  produto: string | null;
  unidade: string | null;
  contexto: string | null;
  tags: string | null;
  largura: number;
  altura: number;
  usos: number;
}

const CONTEXTOS = ["obra", "fabrica", "loja", "equipe", "produto", "outro"] as const;

export async function salvarFoto(opts: {
  chatId: number;
  buffer: Buffer;
  fileId?: string;
}): Promise<{ id: number; path: string; largura: number; altura: number }> {
  mkdirSync("data/fotos", { recursive: true });
  // Normaliza para JPEG sRGB sem metadado (o EXIF de celular carrega GPS).
  const jpeg = await sharp(opts.buffer).rotate().toColorspace("srgb").jpeg({ quality: 92 }).toBuffer();
  const { width = 0, height = 0 } = await sharp(jpeg).metadata();

  const row = db
    .query("INSERT INTO fotos (chat_id, path, file_id, largura, altura) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get(opts.chatId, "", opts.fileId ?? null, width, height) as { id: number };

  const path = `data/fotos/${row.id}.jpg`;
  writeFileSync(path, jpeg);
  db.query("UPDATE fotos SET path = ? WHERE id = ?").run(path, row.id);
  return { id: row.id, path, largura: width, altura: height };
}

function extrairTexto(interaction: any): string {
  let texto = "";
  const scan = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text" && typeof n.text === "string") texto += n.text;
    for (const v of Array.isArray(n) ? n : Object.values(n)) scan(v);
  };
  scan(interaction.steps ?? interaction);
  return texto;
}

/**
 * Descreve a foto com o modelo de visão e grava os campos de busca.
 * A unidade vem da legenda do usuário, nunca da imagem: nenhum modelo sabe olhar
 * uma foto e dizer se aquilo é a loja do Angelim ou a de Imperatriz.
 */
export async function catalogarFoto(id: number, legendaDoUsuario?: string): Promise<Foto> {
  const foto = pegarFoto(id);
  if (!foto) throw new Error(`Foto ${id} não existe`);

  const data = (await sharp(foto.path).resize(768, null, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer()).toString(
    "base64",
  );

  const interaction: any = await ai().interactions.create({
    model: TEXT_MODEL,
    input: [
      { type: "image", data, mime_type: "image/jpeg" },
      {
        type: "text",
        text: [
          "Você cataloga o banco de fotos de uma vidraçaria industrial (EM Vidros, Maranhão/Pará/Piauí).",
          "Descreva SOMENTE o que está visível. Não deduza marca, cidade nem cliente.",
          legendaDoUsuario ? `O usuário escreveu junto: "${legendaDoUsuario}" — use isso para unidade e produto.` : "",
          "Responda só com JSON, sem cercas de código:",
          `{"descricao": "uma frase em português", "produto": "box|guarda-corpo|espelho|fachada|janela|porta|ACM|vidro temperado|vidro laminado|outro|", "unidade": "", "contexto": "${CONTEXTOS.join("|")}", "tags": ["até 6 palavras-chave em português"]}`,
          'Campo que você não sabe fica como string vazia. Nunca invente.',
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ] as any,
    store: false,
  });

  const bruto = extrairTexto(interaction).replace(/^```(?:json)?|```$/gm, "").trim();
  let j: any = {};
  try {
    j = JSON.parse(bruto.slice(bruto.indexOf("{"), bruto.lastIndexOf("}") + 1));
  } catch {
    // catálogo é conveniência: foto sem tag ainda é foto utilizável
    j = { descricao: bruto.slice(0, 200) };
  }

  const contexto = CONTEXTOS.includes(j.contexto) ? j.contexto : null;
  const tags = Array.isArray(j.tags) ? j.tags.join(", ") : (j.tags ?? null);
  db.query("UPDATE fotos SET descricao = ?, produto = ?, unidade = ?, contexto = ?, tags = ? WHERE id = ?").run(
    j.descricao || null,
    j.produto || null,
    j.unidade || null,
    contexto,
    tags || null,
    id,
  );
  return pegarFoto(id)!;
}

export function pegarFoto(id: number): Foto | null {
  return (db.query("SELECT * FROM fotos WHERE id = ?").get(id) as Foto) ?? null;
}

export function buscarFotos(termo?: string, limite = 8): Foto[] {
  if (!termo?.trim())
    return db.query("SELECT * FROM fotos ORDER BY id DESC LIMIT ?").all(limite) as Foto[];
  // Busca por palavra: "box temperado imperatriz" acha foto marcada só com "box".
  const palavras = termo.toLowerCase().split(/\s+/).filter((p) => p.length >= 3).slice(0, 5);
  if (!palavras.length) return [];
  const campo = "lower(coalesce(descricao,'') || ' ' || coalesce(produto,'') || ' ' || coalesce(unidade,'') || ' ' || coalesce(contexto,'') || ' ' || coalesce(tags,''))";
  const pontos = palavras.map(() => `(CASE WHEN ${campo} LIKE ? THEN 1 ELSE 0 END)`).join(" + ");
  return db
    .query(`SELECT *, (${pontos}) AS score FROM fotos WHERE score > 0 ORDER BY score DESC, id DESC LIMIT ?`)
    .all(...palavras.map((p) => `%${p}%`), limite) as Foto[];
}

export function contarFotos(): number {
  return (db.query("SELECT COUNT(*) n FROM fotos").get() as { n: number }).n;
}

/**
 * Recorta a foto para o formato do post. Mesmo tratamento das artes geradas
 * (cover + position attention → JPEG q90 sRGB), para que tudo a jusante — Linear,
 * Instagram, media group — funcione sem saber que a origem foi uma foto.
 */
export async function prepararFoto(opts: {
  fotoId: number;
  postId: number;
  formato: Formato;
}): Promise<string> {
  const foto = pegarFoto(opts.fotoId);
  if (!foto) throw new Error(`Foto ${opts.fotoId} não existe`);
  const alvo = tokens.formats[opts.formato].final;

  mkdirSync("data/arts", { recursive: true });
  const jpeg = await sharp(foto.path)
    .resize(alvo.width, alvo.height, { fit: "cover", position: "attention" })
    .toColorspace("srgb")
    .jpeg({ quality: tokens.output.quality })
    .toBuffer();

  const path = `data/arts/post${opts.postId}-${opts.formato}-foto${foto.id}.jpg`;
  writeFileSync(path, jpeg);
  db.query("UPDATE fotos SET usos = usos + 1 WHERE id = ?").run(foto.id);
  return path;
}

export function resumir(f: Foto): string {
  const campos = [f.produto, f.unidade, f.contexto].filter(Boolean).join(" · ");
  return `#${f.id} ${f.descricao ?? "(sem descrição)"}${campos ? ` [${campos}]` : ""} — ${f.largura}×${f.altura}, usada ${f.usos}×`;
}
