import sharp from "sharp";
import { gravarArquivo, lerArquivo } from "../../armazem";
import { primeira } from "../../db";
import { q } from "../../v2/banco";
import { MODELO_DE_TEXTO, openai } from "../../openai";
import { tokens } from "../brand";
import type { Formato } from "../art/generate";

/**
 * Banco de fotos reais.
 *
 * O §8.2 proíbe gerar produto, obra, fábrica, maquinário e pessoas da EM Vidros
 * — e a F4 passou a recusar essas peças em código. Recusa sem alternativa vira
 * paralisia: o caminho de menor resistência volta a ser gerar por IA e mentir no
 * brief. Este módulo é a alternativa — a foto que a equipe já tem no celular
 * entra no banco, é catalogada e vira a arte do post.
 *
 * A catalogação é automática de propósito: banco que depende de alguém preencher
 * campo na hora do upload fica sem tags em duas semanas e deixa de ser buscável.
 */

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

export async function salvarFoto(buffer: Buffer): Promise<{ id: number; path: string; largura: number; altura: number }> {
  // Normaliza para JPEG sRGB sem metadado (o EXIF de celular carrega GPS).
  const jpeg = await sharp(buffer).rotate().toColorspace("srgb").jpeg({ quality: 92 }).toBuffer();
  const { width = 0, height = 0 } = await sharp(jpeg).metadata();

  const row = (await primeira(q<{ id: number }>`INSERT INTO fotos (path, largura, altura) VALUES ('', ${width}, ${height}) RETURNING id`))!;

  const path = await gravarArquivo("fotos", `${row.id}.jpg`, jpeg, "image/jpeg");
  await q`UPDATE fotos SET path = ${path} WHERE id = ${row.id}`;
  return { id: row.id, path, largura: width, altura: height };
}

/**
 * Descreve a foto com o modelo de visão e grava os campos de busca.
 * A unidade vem da legenda do usuário, nunca da imagem: nenhum modelo sabe olhar
 * uma foto e dizer se aquilo é a loja do Angelim ou a de Imperatriz.
 */
export async function catalogarFoto(id: number, legendaDoUsuario?: string): Promise<Foto> {
  const foto = await pegarFoto(id);
  if (!foto) throw new Error(`Foto ${id} não existe`);

  const data = (await sharp(await bytesDa(foto)).resize(768, null, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer()).toString(
    "base64",
  );

  const resposta = await openai().responses.create({
    model: MODELO_DE_TEXTO,
    input: [
      {
        role: "user",
        content: [
          { type: "input_image", detail: "auto", image_url: `data:image/jpeg;base64,${data}` },
          {
            type: "input_text",
            text: [
              "Você cataloga o banco de fotos de uma vidraçaria industrial (EM Vidros, Maranhão/Pará/Piauí).",
              "Descreva SOMENTE o que está visível. Não deduza marca, cidade nem cliente.",
              legendaDoUsuario ? `O usuário escreveu junto: "${legendaDoUsuario}" — use isso para unidade e produto.` : "",
              "Responda só com JSON, sem cercas de código:",
              `{"descricao": "uma frase em português", "produto": "box|guarda-corpo|espelho|fachada|janela|porta|ACM|vidro temperado|vidro laminado|outro|", "unidade": "", "contexto": "${CONTEXTOS.join("|")}", "tags": ["até 6 palavras-chave em português"]}`,
              "Campo que você não sabe fica como string vazia. Nunca invente.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    ],
    store: false,
  });

  const bruto = resposta.output_text.replace(/^```(?:json)?|```$/gm, "").trim();
  let j: any = {};
  try {
    j = JSON.parse(bruto.slice(bruto.indexOf("{"), bruto.lastIndexOf("}") + 1));
  } catch {
    // catálogo é conveniência: foto sem tag ainda é foto utilizável
    j = { descricao: bruto.slice(0, 200) };
  }

  const contexto = CONTEXTOS.includes(j.contexto) ? j.contexto : null;
  const tags = Array.isArray(j.tags) ? j.tags.join(", ") : (j.tags ?? null);
  await q`UPDATE fotos SET descricao = ${j.descricao || null}, produto = ${j.produto || null}, unidade = ${j.unidade || null},
    contexto = ${contexto}, tags = ${tags || null} WHERE id = ${id}`;
  return (await pegarFoto(id))!;
}

async function bytesDa(foto: Foto): Promise<Uint8Array> {
  const bytes = await lerArquivo(foto.path);
  if (!bytes) throw new Error(`O arquivo da foto ${foto.id} sumiu.`);
  return bytes;
}

export function pegarFoto(id: number): Promise<Foto | null> {
  return primeira(q<Foto>`SELECT * FROM fotos WHERE id = ${id}`);
}

export async function buscarFotos(termo?: string, limite = 8): Promise<Foto[]> {
  if (!termo?.trim()) return q<Foto>`SELECT * FROM fotos ORDER BY id DESC LIMIT ${limite}`;
  // Busca por palavra: "box temperado imperatriz" acha foto marcada só com "box".
  const palavras = termo.toLowerCase().split(/\s+/).filter((p) => p.length >= 3).slice(0, 5);
  if (!palavras.length) return [];
  return q<Foto>`SELECT * FROM (
      SELECT *, (SELECT count(*) FROM unnest(${palavras.map((p) => `%${p}%`)}::text[]) padrao
        WHERE lower(coalesce(descricao,'') || ' ' || coalesce(produto,'') || ' ' || coalesce(unidade,'') || ' ' || coalesce(contexto,'') || ' ' || coalesce(tags,'')) LIKE padrao)::int AS score
      FROM fotos
    ) f WHERE score > 0 ORDER BY score DESC, id DESC LIMIT ${limite}`;
}

export async function contarFotos(): Promise<number> {
  return (await primeira(q<{ n: number }>`SELECT count(*)::int AS n FROM fotos`))!.n;
}

/**
 * Recorta a foto para o formato do post. Mesmo tratamento das artes geradas
 * (cover + position attention → JPEG q90 sRGB), para que o Instagram e o resto
 * do fluxo funcionem sem saber que a origem foi uma foto.
 */
export async function prepararFoto(opts: {
  fotoId: number;
  postId: number;
  formato: Formato;
}): Promise<string> {
  const foto = await pegarFoto(opts.fotoId);
  if (!foto) throw new Error(`Foto ${opts.fotoId} não existe`);
  const alvo = tokens.formats[opts.formato].final;

  const jpeg = await sharp(await bytesDa(foto))
    .resize(alvo.width, alvo.height, { fit: "cover", position: "attention" })
    .toColorspace("srgb")
    .jpeg({ quality: tokens.output.quality })
    .toBuffer();

  const path = await gravarArquivo("arts", `post${opts.postId}-${opts.formato}-foto${foto.id}.jpg`, jpeg, "image/jpeg");
  await q`UPDATE fotos SET usos = usos + 1 WHERE id = ${foto.id}`;
  return path;
}

export function resumir(f: Foto): string {
  const campos = [f.produto, f.unidade, f.contexto].filter(Boolean).join(" · ");
  return `#${f.id} ${f.descricao ?? "(sem descrição)"}${campos ? ` [${campos}]` : ""} — ${f.largura}×${f.altura}, usada ${f.usos}×`;
}
