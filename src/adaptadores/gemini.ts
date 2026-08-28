/**
 * Designer e diretor de arte sobre a Interactions API do Gemini (PRD §3.1).
 *
 * O designer emite na resolução do modelo e os bytes voltam como vieram: quem decide
 * o pixel final é `normalizarMestre`, que aceita PNG e JPEG. Separar as duas coisas é
 * o que faz a dimensão exata da US-5 sobreviver a uma troca de modelo.
 *
 * O `aprovada` do veredito é nosso, não do modelo: o modelo dá nota e lista violação,
 * e a regra de corte (nota mínima mais violação bloqueante) fica aqui, onde dá para
 * mudar sem depender de o juiz ter entendido o critério.
 */

import { GoogleGenAI } from "@google/genai";
import tokens from "../../brand/tokens.json";
import type { DirecaoVisual, Formato } from "../modelos/tipos";
import type { Designer, DiretorDeArte, Veredito } from "./tipos";

export const MODELO_IMAGEM = "gemini-3.1-flash-image";
export const MODELO_REVISAO = "gemini-3.6-flash";

const NOTA_MINIMA = 7;
const CRITERIOS_BLOQUEANTES = new Set(["paleta", "logo", "texto"]);

/** Base64 curto demais é ícone ou placeholder, nunca a arte de 2K. */
const MIN_BASE64_IMAGEM = 1000;

export interface ClienteInteracoes {
  interactions: { create(pedido: Record<string, unknown>): Promise<unknown> };
}

export function clienteGemini(chave: string): ClienteInteracoes {
  const ai = new GoogleGenAI({ apiKey: chave });
  type Pedido = Parameters<typeof ai.interactions.create>[0];
  return { interactions: { create: (pedido) => ai.interactions.create(pedido as Pedido) } };
}

// ----------------------------------------------------------------------------
// Narração de JSON externo
// ----------------------------------------------------------------------------

function campo(bruto: unknown, nome: string): unknown {
  if (typeof bruto !== "object" || bruto === null) return undefined;
  return Reflect.get(bruto, nome);
}

function descrever(valor: unknown): string {
  if (valor === undefined) return "nada";
  if (valor === null) return "null";
  if (Array.isArray(valor)) return `lista de ${valor.length}`;
  if (typeof valor === "string") return "texto vazio";
  return typeof valor;
}

function exigirTexto(valor: unknown, onde: string): string {
  if (typeof valor !== "string" || valor.trim() === "")
    throw new Error(`${onde}: esperava texto não vazio, veio ${descrever(valor)}.`);
  return valor.trim();
}

function exigirLista(valor: unknown, onde: string): readonly unknown[] {
  if (!Array.isArray(valor)) throw new Error(`${onde}: esperava lista, veio ${descrever(valor)}.`);
  return valor;
}

/** O juiz costuma embrulhar o JSON em cerca de markdown, e isso é tolerado. */
export function jsonDoTexto(texto: string, onde: string): unknown {
  const limpo = texto.replace(/```json?/gi, "").replace(/```/g, "").trim();
  if (!limpo) throw new Error(`${onde}: resposta vazia.`);
  try {
    return JSON.parse(limpo);
  } catch {
    throw new Error(`${onde}: não é JSON válido. Começa com ${limpo.slice(0, 120)}`);
  }
}

export function parseVeredito(bruto: unknown): Veredito {
  const score = campo(bruto, "score");
  if (typeof score !== "number" || !Number.isFinite(score))
    throw new Error(`veredito.score: esperava número de 0 a 10, veio ${descrever(score)}.`);

  const cru = campo(bruto, "violacoes");
  const violacoes = (cru === undefined || cru === null ? [] : exigirLista(cru, "veredito.violacoes")).map(
    (v, i) => ({
      criterio: exigirTexto(campo(v, "criterio"), `veredito.violacoes[${i}].criterio`),
      problema: exigirTexto(campo(v, "problema"), `veredito.violacoes[${i}].problema`),
    }),
  );

  const bloqueante = violacoes.some((v) => CRITERIOS_BLOQUEANTES.has(v.criterio.trim().toLowerCase()));
  return { aprovada: score >= NOTA_MINIMA && !bloqueante, score, violacoes };
}

function extrairImagem(interacao: unknown): Buffer {
  const achar = (no: unknown): string | undefined => {
    if (Array.isArray(no)) {
      for (const item of no) {
        const achado = achar(item);
        if (achado) return achado;
      }
      return undefined;
    }
    if (typeof no !== "object" || no === null) return undefined;
    const dados = Reflect.get(no, "data");
    if (Reflect.get(no, "type") === "image" && typeof dados === "string" && dados.length > MIN_BASE64_IMAGEM)
      return dados;
    for (const valor of Object.values(no)) {
      const achado = achar(valor);
      if (achado) return achado;
    }
    return undefined;
  };

  const dados = achar(campo(interacao, "outputs") ?? campo(interacao, "steps") ?? interacao);
  if (!dados) throw new Error(`${MODELO_IMAGEM}: a interação voltou sem imagem.`);
  return Buffer.from(dados, "base64");
}

function textoDaInteracao(interacao: unknown): string {
  const partes: string[] = [];
  const varrer = (no: unknown): void => {
    if (Array.isArray(no)) return no.forEach(varrer);
    if (typeof no !== "object" || no === null) return;
    const texto = Reflect.get(no, "text");
    if (Reflect.get(no, "type") === "text" && typeof texto === "string") partes.push(texto);
    for (const valor of Object.values(no)) varrer(valor);
  };
  varrer(campo(interacao, "outputs") ?? campo(interacao, "steps") ?? interacao);
  return partes.join("").trim();
}

function idDaInteracao(interacao: unknown): string | undefined {
  const id = campo(interacao, "id");
  return typeof id === "string" && id !== "" ? id : undefined;
}

// ----------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------

const NOME_DO_FORMATO: Record<Formato, string> = {
  feed: "Instagram Feed, 4:5 portrait",
  stories: "Instagram Stories, 9:16 vertical",
};

/**
 * Em inglês de propósito: o modelo de imagem obedece melhor a instrução de layout em
 * inglês. O que ele renderiza dentro da arte continua sendo o português literal da
 * direção, entre aspas, para não sobrar margem de tradução.
 */
export function montarPromptDesigner(direcao: DirecaoVisual, formato: Formato): string {
  const linhas = [
    `Create one ${NOME_DO_FORMATO[formato]} image for EM Vidros, a flat glass manufacturer in Imperatriz, Brazil.`,
    "",
    `Visual territory: ${direcao.territory}`,
    `Composition: ${direcao.composition}`,
    `Main element: ${direcao.main_element}`,
    `Typography: ${direcao.typography}`,
    `Color palette, use only these colors: ${direcao.palette.join(", ")}. Teal is always the dominant brand color.`,
    "",
    `Render this headline as the literal text of the artwork, in Brazilian Portuguese, spelled exactly as written, with no rewording and no translation: "${direcao.headline}"`,
  ];

  if (direcao.support_text)
    linhas.push(`Render this support line, also exactly as written: "${direcao.support_text}"`);

  linhas.push(
    "",
    `Logo: the attached image is the official EM Vidros logo. Place it as-is, never redraw, retype, recolor or restyle it. ${direcao.logo_rule}`,
    `Logo placement for this format: ${tokens.formats[formato].logoPlacement}.`,
    `Never add any of these: ${direcao.prohibited_elements.join("; ")}.`,
    "",
    "Text must be flawless Brazilian Portuguese and legible on a phone screen. No lorem ipsum, no invented words, no extra text beyond what is quoted above.",
  );

  if (formato === "stories") {
    const zonas = tokens.formats.stories.safeZones;
    const final = tokens.formats.stories.final;
    linhas.push(
      `Safe zones: the image is cropped to ${final.width}x${final.height} px for delivery. Keep the top ${zonas.topPx} px and the bottom ${zonas.bottomPx} px free of headline, support text and logo, because the Instagram interface covers them.`,
    );
  }

  return linhas.join("\n");
}

/** A instrução termina sempre pela preservação: é o critério da US-3. */
export function instrucaoDeEdicao(instrucao: string, formato: Formato): string {
  const linhas = [
    "Edit the attached EM Vidros artwork.",
    "",
    `What to change: ${instrucao}`,
    "",
  ];

  if (formato === "stories") {
    const zonas = tokens.formats.stories.safeZones;
    linhas.push(
      `Keep the top ${zonas.topPx} px and the bottom ${zonas.bottomPx} px of the final 9:16 crop free of headline, support text and logo.`,
      "",
    );
  }

  linhas.push(
    "Keep everything the instruction did not mention exactly as it is: concept, composition, colors, typography, headline wording and spelling, support text, main element and the logo. Do not restyle, recrop or regenerate what was not asked about.",
  );
  return linhas.join("\n");
}

/** Rubrica portada de `src/art/review.ts`, com o headline literal da direção. */
export function montarRubrica(e: { formato: Formato; direcao: DirecaoVisual; tema: string }): string {
  const cor = tokens.color;
  const zonas =
    e.formato === "stories"
      ? `\n- Zonas seguras: nada essencial nos ${tokens.formats.stories.safeZones.topPx}px de topo nem nos ${tokens.formats.stories.safeZones.bottomPx}px de base.`
      : "";

  return `Avalie esta arte de Instagram (${e.formato === "feed" ? "Feed 4:5" : "Stories 9:16"}).

Tema pedido no brief: ${e.tema}
Headline que deveria estar renderizado na arte: "${e.direcao.headline}"

Regras do brandbook EM Vidros:
- Paleta: teal dominante obrigatório, família ${cor.primary.tealEM} / ${cor.accent.tealVivo} / ${cor.primaryLight.tealClaro}. Nenhuma outra cor pode ser a dominante. A direção pediu ${e.direcao.palette.join(", ")}.
- Logo: ${tokens.formats[e.formato].logoPlacement}. O logo oficial entra como imagem, nunca redesenhado.${zonas}
- Texto: português impecável, zero erro de grafia. O headline aparece exatamente como escrito acima e é legível em tela de celular.
- Aderência: a imagem corresponde ao tema pedido e ao elemento principal da direção (${e.direcao.main_element}).
- Proibido nesta direção: ${e.direcao.prohibited_elements.join("; ")}.

Responda só um JSON válido, sem markdown:
{"score": <0-10>, "aprovada": <true|false>, "violacoes": [{"criterio": "<paleta|logo|texto|zonas|aderencia>", "problema": "<o que está errado e como corrigir>"}]}

Seja rigoroso com erro de português e com logo redesenhado.`;
}

// ----------------------------------------------------------------------------
// Adaptadores
// ----------------------------------------------------------------------------

function imagem(bytes: Buffer, mediaTipo: string): Record<string, unknown> {
  return { type: "image", data: bytes.toString("base64"), mime_type: mediaTipo };
}

export class GeminiDesigner implements Designer {
  private readonly cliente: ClienteInteracoes;

  constructor(chave: string, cliente: ClienteInteracoes = clienteGemini(chave)) {
    this.cliente = cliente;
  }

  async gerar(e: {
    direcao: DirecaoVisual;
    formato: Formato;
    logo: Buffer;
  }): Promise<{ png: Buffer; modelo: string; refId?: string }> {
    const interacao = await this.cliente.interactions.create({
      model: MODELO_IMAGEM,
      input: [imagem(e.logo, "image/png"), { type: "text", text: montarPromptDesigner(e.direcao, e.formato) }],
      response_format: formatoDeSaida(e.formato),
      store: true,
    });
    return { png: extrairImagem(interacao), modelo: MODELO_IMAGEM, refId: idDaInteracao(interacao) };
  }

  async editar(e: {
    base: Buffer;
    instrucao: string;
    formato: Formato;
    logo: Buffer;
    refId?: string;
  }): Promise<{ png: Buffer; modelo: string; refId?: string }> {
    const texto = { type: "text", text: instrucaoDeEdicao(e.instrucao, e.formato) };

    // Com refId a base e o logo já estão na interação anterior; reenviar os bytes
    // custaria upload e ainda daria ao modelo duas cópias da mesma imagem.
    const pedido: Record<string, unknown> = e.refId
      ? { input: [texto], previous_interaction_id: e.refId }
      : { input: [imagem(e.base, "image/png"), imagem(e.logo, "image/png"), texto] };

    const interacao = await this.cliente.interactions.create({
      model: MODELO_IMAGEM,
      response_format: formatoDeSaida(e.formato),
      store: true,
      ...pedido,
    });
    return { png: extrairImagem(interacao), modelo: MODELO_IMAGEM, refId: idDaInteracao(interacao) ?? e.refId };
  }
}

function formatoDeSaida(formato: Formato): Record<string, unknown> {
  const geracao = tokens.formats[formato].generation;
  return { type: "image", aspect_ratio: geracao.aspectRatio, image_size: geracao.imageSize };
}

export class GeminiDiretorDeArte implements DiretorDeArte {
  private readonly cliente: ClienteInteracoes;

  constructor(chave: string, cliente: ClienteInteracoes = clienteGemini(chave)) {
    this.cliente = cliente;
  }

  async revisar(e: {
    png: Buffer;
    formato: Formato;
    direcao: DirecaoVisual;
    tema: string;
  }): Promise<Veredito> {
    const interacao = await this.cliente.interactions.create({
      model: MODELO_REVISAO,
      system_instruction:
        "Você é o controle de qualidade visual da EM Vidros. Avalia a arte contra o brandbook e responde só o JSON pedido.",
      input: [imagem(e.png, "image/png"), { type: "text", text: montarRubrica(e) }],
    });
    return parseVeredito(jsonDoTexto(textoDaInteracao(interacao), `${MODELO_REVISAO}.veredito`));
  }
}
