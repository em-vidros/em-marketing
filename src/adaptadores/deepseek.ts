/**
 * Diretor criativo e redator sobre a Chat Completions da DeepSeek (PRD §3.1).
 *
 * A saída do modelo é dado externo, do mesmo jeito que o corpo de um request é: cada
 * contrato tem uma função `parse` que narra `unknown` para o tipo e recusa o que não
 * bate, nomeando o campo. É a fronteira onde um JSON criativo demais vira erro com
 * endereço, em vez de virar artefato torto três estados adiante.
 *
 * `direction_id` é nosso, nunca do modelo: o id é a chave que o callback do Telegram
 * carrega, e um id inventado pelo modelo colidiria entre rodadas.
 */

import { createHash } from "node:crypto";
import type { DirecaoVisual, Pedido } from "../modelos/tipos";
import type { Artigo, ContextoMarca, DiretorCriativo, Redator } from "./tipos";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
export const MODELO_TEXTO = "deepseek-v4-pro";
const TIMEOUT_MS = 120_000;

const TOTAL_DIRECOES = 3;
const MAX_PALAVRAS_HEADLINE = 6;
const TOTAL_ANGULOS = 3;

/**
 * A validação aceita de 60 a 150 palavras e o prompt pede de 70 a 120. A folga é
 * de propósito: mirar no meio da janela faz um deslize de contagem custar nada, e
 * mirar na borda faria cada legenda comprida gastar uma retentativa.
 */
const MIN_PALAVRAS_LEGENDA = 60;
const MAX_PALAVRAS_LEGENDA = 150;
const PROMPT_MIN_PALAVRAS = 70;
const PROMPT_MAX_PALAVRAS = 120;

export type Buscador = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Mensagem {
  readonly role: "system" | "user";
  readonly content: string;
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
  if (typeof valor === "string") return `texto vazio`;
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

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Mesmo formato do `idCurto` do fake: 12 chars é o que o callback_data reserva. */
function idCurto(...partes: readonly string[]): string {
  const bytes = createHash("sha256").update(partes.join("\0")).digest();
  let saida = "";
  for (let i = 0; i < 12; i++) {
    const bit = i * 5;
    const byte = bit >> 3;
    const janela = ((bytes[byte]! << 8) | bytes[byte + 1]!) >> (11 - (bit & 7));
    saida += CROCKFORD[janela & 31]!;
  }
  return saida;
}

/**
 * Toda cor `#RRGGBB` que existe no snapshot de marca. Sai do `ContextoMarca`, e não
 * de um import do arquivo, para a paleta aceita ser exatamente a da versão que o
 * artefato vai declarar.
 */
export function coresDosTokens(tokens: unknown): ReadonlySet<string> {
  const cores = new Set<string>();
  const varrer = (no: unknown): void => {
    if (typeof no === "string") {
      if (/^#[0-9a-f]{6}$/i.test(no)) cores.add(no.toUpperCase());
      return;
    }
    if (typeof no !== "object" || no === null) return;
    for (const valor of Object.values(no)) varrer(valor);
  };
  varrer(tokens);
  if (cores.size === 0)
    throw new Error("tokens: nenhuma cor #RRGGBB no contexto de marca. O snapshot não carregou.");
  return cores;
}

export function parseDirecoes(
  bruto: unknown,
  e: { tema: string; rodada: number; cores: ReadonlySet<string> },
): readonly DirecaoVisual[] {
  const lista = exigirLista(Array.isArray(bruto) ? bruto : campo(bruto, "direcoes"), "direcoes");
  if (lista.length !== TOTAL_DIRECOES)
    throw new Error(
      `direcoes: o modelo devolveu ${lista.length} direções e o contrato pede exatamente ${TOTAL_DIRECOES}.`,
    );

  const direcoes = lista.map((item, i) => {
    const onde = `direcoes[${i}]`;

    const headline = exigirTexto(campo(item, "headline"), `${onde}.headline`);
    const palavras = headline.split(/\s+/).filter(Boolean);
    if (palavras.length > MAX_PALAVRAS_HEADLINE)
      throw new Error(
        `${onde}.headline: ${palavras.length} palavras, o máximo é ${MAX_PALAVRAS_HEADLINE} ("${headline}").`,
      );

    const paleta = exigirLista(campo(item, "palette"), `${onde}.palette`).map((c, j) =>
      exigirTexto(c, `${onde}.palette[${j}]`).toUpperCase(),
    );
    if (paleta.length === 0)
      throw new Error(`${onde}.palette: paleta vazia. Escolha as cores em tokens.json.`);
    for (const cor of paleta)
      if (!e.cores.has(cor))
        throw new Error(
          `${onde}.palette: a cor ${cor} não existe em tokens.json. Só as cores da marca são permitidas.`,
        );

    const variante = campo(item, "logo_variant");
    if (variante !== "cor" && variante !== "branco")
      throw new Error(
        `${onde}.logo_variant: esperava "cor" ou "branco", veio ${JSON.stringify(variante) ?? "nada"}.`,
      );

    const proibidos = exigirLista(campo(item, "prohibited_elements"), `${onde}.prohibited_elements`).map(
      (p, j) => exigirTexto(p, `${onde}.prohibited_elements[${j}]`),
    );
    if (proibidos.length === 0)
      throw new Error(
        `${onde}.prohibited_elements: lista vazia. O designer precisa saber o que não pode entrar na peça.`,
      );

    const direcao: DirecaoVisual = {
      direction_id: idCurto(e.tema, String(e.rodada), String(i), headline),
      territory: exigirTexto(campo(item, "territory"), `${onde}.territory`),
      composition: exigirTexto(campo(item, "composition"), `${onde}.composition`),
      palette: paleta,
      typography: exigirTexto(campo(item, "typography"), `${onde}.typography`),
      main_element: exigirTexto(campo(item, "main_element"), `${onde}.main_element`),
      headline,
      logo_variant: variante,
      logo_rule: exigirTexto(campo(item, "logo_rule"), `${onde}.logo_rule`),
      rationale: exigirTexto(campo(item, "rationale"), `${onde}.rationale`),
      prohibited_elements: proibidos,
    };
    const apoio = campo(item, "support_text");
    if (typeof apoio === "string" && apoio.trim() !== "") direcao.support_text = apoio.trim();
    return direcao;
  });

  const territorios = new Set(direcoes.map((d) => d.territory.trim().toLowerCase()));
  if (territorios.size !== direcoes.length)
    throw new Error(
      `direcoes: territórios repetidos (${direcoes.map((d) => d.territory).join(" | ")}). As três precisam ocupar territórios distintos.`,
    );
  return direcoes;
}

export function parseLegenda(bruto: unknown): string {
  const legenda = exigirTexto(campo(bruto, "legenda"), "legenda");

  const hashtags = legenda.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (hashtags.length === 0)
    throw new Error("legenda: nenhuma hashtag. O guia de voz pede de 5 a 10, com #EMVidros na frente.");
  const primeira = hashtags[0]!;
  if (primeira.toLowerCase() !== "#emvidros")
    throw new Error(`legenda: a primeira hashtag é ${primeira} e tem que ser #EMVidros.`);

  const corpo = legenda.slice(0, legenda.indexOf(primeira));
  const palavras = corpo.split(/\s+/).filter(Boolean).length;
  if (palavras < MIN_PALAVRAS_LEGENDA || palavras > MAX_PALAVRAS_LEGENDA)
    throw new Error(
      `legenda: ${palavras} palavras antes das hashtags, e o texto precisa ficar entre ${MIN_PALAVRAS_LEGENDA} e ${MAX_PALAVRAS_LEGENDA}.`,
    );
  return legenda;
}

export function parseAngulos(bruto: unknown): readonly { titulo: string; angulo: string }[] {
  const lista = exigirLista(campo(bruto, "angulos"), "angulos");
  if (lista.length !== TOTAL_ANGULOS)
    throw new Error(`angulos: o modelo devolveu ${lista.length} e o contrato pede ${TOTAL_ANGULOS}.`);
  return lista.map((item, i) => ({
    titulo: exigirTexto(campo(item, "titulo"), `angulos[${i}].titulo`),
    angulo: exigirTexto(campo(item, "angulo"), `angulos[${i}].angulo`),
  }));
}

export function parseArtigo(bruto: unknown): Artigo {
  const slug = exigirTexto(campo(bruto, "slug"), "artigo.slug");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
    throw new Error(`artigo.slug: "${slug}" não é um slug. Use só minúsculas, números e hífen.`);

  const pendencias = campo(bruto, "pendencias");
  return {
    titulo: exigirTexto(campo(bruto, "titulo"), "artigo.titulo"),
    markdown: exigirTexto(campo(bruto, "markdown"), "artigo.markdown"),
    tituloSeo: exigirTexto(campo(bruto, "tituloSeo"), "artigo.tituloSeo"),
    descricaoSeo: exigirTexto(campo(bruto, "descricaoSeo"), "artigo.descricaoSeo"),
    slug,
    pendencias:
      pendencias === undefined
        ? []
        : exigirLista(pendencias, "artigo.pendencias").map((p, i) =>
            exigirTexto(p, `artigo.pendencias[${i}]`),
          ),
  };
}

// ----------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------

function secao(nome: string, corpo: string): string {
  return `===== ${nome} =====\n${corpo.trim()}\n`;
}

/** O contexto de marca entra identificado pela versão (PRD §3.4). */
export function sistemaDaMarca(marca: ContextoMarca, papel: string): string {
  const estilos = Object.entries(marca.estilos)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, md]) => secao(`styles/${id}.md`, md));
  return [
    papel,
    "",
    `Contexto de marca na versão ${marca.brandVersionId}. Ele é imutável nesta tarefa: não invente cor, fonte, filial, preço, estoque, certificação nem especificação que não esteja escrita abaixo.`,
    "",
    secao("brand/BRANDBOOK.md", marca.brandbook),
    secao("brand/voice.md", marca.voz),
    secao("brand/tokens.json", JSON.stringify(marca.tokens, null, 2)),
    ...estilos,
  ].join("\n");
}

const PAPEL_CRIATIVO =
  "Você é o diretor criativo da EM Vidros, indústria e comércio de vidro plano em Imperatriz, no Maranhão. Você transforma um tema em direções visuais que o designer executa sem precisar perguntar nada. Responde só JSON.";

const PAPEL_REDATOR =
  "Você é o redator da EM Vidros, indústria e comércio de vidro plano em Imperatriz, no Maranhão. Escreve em português do Brasil, simples, direto e humano, para vidraceiros, serralheiros, arquitetos e clientes finais. Responde só JSON.";

function descreverPedido(pedido: Pedido): string {
  const linhas = [`Tema: ${pedido.theme}`, `Formato do pedido: ${pedido.format}`];
  if (pedido.objective) linhas.push(`Objetivo: ${pedido.objective}`);
  if (pedido.constraints && Object.keys(pedido.constraints).length)
    linhas.push(`Restrições do brief: ${JSON.stringify(pedido.constraints)}`);
  return linhas.join("\n");
}

export function promptDirecoes(e: {
  pedido: Pedido;
  rodada: number;
  excluir: readonly string[];
  cores: ReadonlySet<string>;
}): string {
  const paleta = [...e.cores].sort().join(", ");
  const recusadas = e.excluir.length
    ? [
        "",
        `O Ricardo já recusou ${e.excluir.length} direção(ões) nas rodadas anteriores (ids ${e.excluir.join(", ")}).`,
        "Não repita território nem composição das rodadas anteriores. Mude o território visual e a estrutura da peça, não só a semente: uma variação do mesmo layout conta como repetição.",
      ].join("\n")
    : "";

  return `${descreverPedido(e.pedido)}
Rodada: ${e.rodada}.${recusadas}

Proponha exatamente ${TOTAL_DIRECOES} direções visuais para uma peça estática de Instagram.

Regras:
- As ${TOTAL_DIRECOES} direções ocupam territórios visuais distintos entre si. Duas variações do mesmo território não valem.
- "headline" é o texto literal que o designer vai renderizar dentro da arte. Português do Brasil, no máximo ${MAX_PALAVRAS_HEADLINE} palavras, sem erro de grafia.
- "palette" usa só cores desta lista, em maiúsculas: ${paleta}. O teal é sempre a cor dominante da marca.
- "logo_variant" é "cor" para fundo claro e "branco" para fundo escuro. "logo_rule" diz posição e tamanho.
- "prohibited_elements" nunca vem vazia: liste o que o designer não pode acrescentar nesta direção.
- "rationale" liga tema, público e direção em uma ou duas frases.
- Não invente preço, filial, prazo nem certificação.

Responda só este JSON:
{"direcoes": [{"territory": "...", "composition": "...", "palette": ["#RRGGBB"], "typography": "...", "main_element": "...", "headline": "...", "support_text": "...", "logo_variant": "cor", "logo_rule": "...", "rationale": "...", "prohibited_elements": ["..."]}]}`;
}

export function promptLegenda(e: {
  pedido: Pedido;
  direcao: DirecaoVisual;
  anterior?: string;
  ajuste?: string;
}): string {
  const reescrita =
    e.anterior && e.ajuste
      ? `
Reescreva a legenda abaixo atendendo ao pedido do Ricardo e preservando tudo que ele não citou: mantenha abertura, argumento, CTA, emojis e hashtags que o pedido não mencionou.

Pedido do Ricardo: ${e.ajuste}

Legenda atual:
${e.anterior}
`
      : "";

  return `${descreverPedido(e.pedido)}
Headline que já está renderizado na arte: "${e.direcao.headline}"
${reescrita}
Escreva a legenda de publicação do Feed, seguindo brand/voice.md.

Regras:
- Estrutura: abertura de uma ou duas linhas, corpo com contexto e benefício, CTA suave, linha em branco, hashtags.
- Entre ${PROMPT_MIN_PALAVRAS} e ${PROMPT_MAX_PALAVRAS} palavras antes das hashtags.
- De 5 a 10 hashtags, e #EMVidros é sempre a primeira.
- Emojis com moderação. O coração teal 🩵 é a assinatura da marca.
- Não cite preço, estoque, prazo, filial, certificação nem especificação que não esteja no brandbook.
- Não repita o headline palavra por palavra: a legenda continua a conversa que a arte começou.
- Português impecável, sem erro de grafia.

Responda só este JSON:
{"legenda": "texto completo com as hashtags no fim"}`;
}

export function promptAngulos(tema: string): string {
  return `Tema do artigo: ${tema}

Proponha exatamente ${TOTAL_ANGULOS} títulos com ângulos diferentes para um artigo do blog da EM Vidros, escrito de vidraceiro para vidraceiro.

Regras:
- Cada ângulo resolve uma dúvida diferente de quem trabalha com vidro. Nada de três recortes do mesmo assunto.
- Título direto, sem linguagem corporativa e sem exagero comercial.
- "angulo" diz em uma frase o que o artigo entrega e para quem.

Responda só este JSON:
{"angulos": [{"titulo": "...", "angulo": "..."}]}`;
}

export function promptArtigo(e: {
  titulo: string;
  angulo: string;
  fontes: readonly string[];
  ajuste?: string;
}): string {
  const fontes = e.fontes.length ? e.fontes.map((f) => `- ${f}`).join("\n") : "- Nenhuma fonte anexada ao brief.";
  const ajuste = e.ajuste ? `\nPedido de ajuste do Ricardo, atenda só a isso e preserve o resto: ${e.ajuste}\n` : "";

  return `Título: ${e.titulo}
Ângulo: ${e.angulo}

Fontes anexadas ao brief:
${fontes}
${ajuste}
Escreva o artigo do blog da EM Vidros, de vidraceiro para vidraceiro.

Regras:
- Entre 700 e 1200 palavras, com título, introdução, seções, conclusão e chamada para ação.
- Frases claras, exemplos práticos e os termos do trabalho real. Sem linguagem corporativa e sem exagero comercial.
- Toda afirmação técnica sai do brandbook ou de uma fonte acima. O que não tiver fonte entra em "pendencias" e não aparece como fato no texto.
- "slug" em minúsculas, números e hífen. "descricaoSeo" com no máximo 160 caracteres.

Responda só este JSON:
{"titulo": "...", "markdown": "# ...", "tituloSeo": "...", "descricaoSeo": "...", "slug": "...", "pendencias": ["..."]}`;
}

// ----------------------------------------------------------------------------
// Cliente
// ----------------------------------------------------------------------------

export class ClienteDeepSeek {
  constructor(
    private readonly chave: string,
    private readonly buscar: Buscador = globalThis.fetch,
  ) {}

  async completar(mensagens: readonly Mensagem[]): Promise<unknown> {
    const resposta = await this.buscar(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.chave}`,
      },
      body: JSON.stringify({
        model: MODELO_TEXTO,
        messages: mensagens,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resposta.ok)
      throw new Error(
        `DeepSeek ${MODELO_TEXTO}: HTTP ${resposta.status}. ${(await resposta.text()).slice(0, 300)}`,
      );

    const bruto: unknown = await resposta.json();
    const escolhas = exigirLista(campo(bruto, "choices"), "resposta.choices");
    if (escolhas.length === 0) throw new Error("resposta.choices: lista vazia.");
    const conteudo = exigirTexto(
      campo(campo(escolhas[0], "message"), "content"),
      "resposta.choices[0].message.content",
    );
    try {
      return JSON.parse(conteudo);
    } catch {
      throw new Error(
        `resposta.choices[0].message.content: não é JSON válido. Começa com ${conteudo.slice(0, 120)}`,
      );
    }
  }

  /**
   * Uma retentativa com o erro de validação anexado ao pedido. O modelo erra o
   * contrato com frequência bastante para valer o segundo turno, e raramente erra
   * duas vezes o mesmo campo depois de ler a recusa.
   */
  async narrar<T>(sistema: string, usuario: string, narrar: (bruto: unknown) => T): Promise<T> {
    const mensagens = (texto: string): readonly Mensagem[] => [
      { role: "system", content: sistema },
      { role: "user", content: texto },
    ];

    let primeiro: string;
    try {
      return narrar(await this.completar(mensagens(usuario)));
    } catch (erro) {
      primeiro = erro instanceof Error ? erro.message : String(erro);
    }

    const correcao = `${usuario}

A resposta anterior foi recusada pela validação com este erro:
${primeiro}

Refaça a resposta inteira corrigindo exatamente isso, no mesmo formato JSON.`;

    try {
      return narrar(await this.completar(mensagens(correcao)));
    } catch (erro) {
      const segundo = erro instanceof Error ? erro.message : String(erro);
      throw new Error(`DeepSeek recusado duas vezes. Primeira: ${primeiro} Segunda: ${segundo}`);
    }
  }
}

export class DeepSeekDiretorCriativo implements DiretorCriativo {
  private readonly cliente: ClienteDeepSeek;

  constructor(chave: string, buscar: Buscador = globalThis.fetch) {
    this.cliente = new ClienteDeepSeek(chave, buscar);
  }

  async direcoes(e: {
    pedido: Pedido;
    marca: ContextoMarca;
    rodada: number;
    excluir?: readonly string[];
  }): Promise<readonly DirecaoVisual[]> {
    const cores = coresDosTokens(e.marca.tokens);
    return this.cliente.narrar(
      sistemaDaMarca(e.marca, PAPEL_CRIATIVO),
      promptDirecoes({ pedido: e.pedido, rodada: e.rodada, excluir: e.excluir ?? [], cores }),
      (bruto) => parseDirecoes(bruto, { tema: e.pedido.theme, rodada: e.rodada, cores }),
    );
  }
}

export class DeepSeekRedator implements Redator {
  private readonly cliente: ClienteDeepSeek;

  constructor(chave: string, buscar: Buscador = globalThis.fetch) {
    this.cliente = new ClienteDeepSeek(chave, buscar);
  }

  async legenda(e: {
    pedido: Pedido;
    direcao: DirecaoVisual;
    marca: ContextoMarca;
    anterior?: string;
    ajuste?: string;
  }): Promise<string> {
    return this.cliente.narrar(
      sistemaDaMarca(e.marca, PAPEL_REDATOR),
      promptLegenda({ pedido: e.pedido, direcao: e.direcao, anterior: e.anterior, ajuste: e.ajuste }),
      parseLegenda,
    );
  }

  async angulos(e: {
    tema: string;
    marca: ContextoMarca;
  }): Promise<readonly { titulo: string; angulo: string }[]> {
    return this.cliente.narrar(sistemaDaMarca(e.marca, PAPEL_REDATOR), promptAngulos(e.tema), parseAngulos);
  }

  async artigo(e: {
    titulo: string;
    angulo: string;
    marca: ContextoMarca;
    fontes: readonly string[];
    ajuste?: string;
  }): Promise<Artigo> {
    return this.cliente.narrar(
      sistemaDaMarca(e.marca, PAPEL_REDATOR),
      promptArtigo({ titulo: e.titulo, angulo: e.angulo, fontes: e.fontes, ajuste: e.ajuste }),
      parseArtigo,
    );
  }
}
