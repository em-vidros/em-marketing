/**
 * Os adaptadores reais sem tocar a rede.
 *
 * O que quebra em produção não é o feliz caminho, é o modelo devolvendo três direções
 * com uma cor que não existe na marca, ou a legenda com a hashtag errada na frente, ou
 * o boot subindo em `real` com uma chave faltando. Nada disso precisa de rede para ser
 * provado: os `parse` recebem JSON literal, os montadores de prompt são puros e os
 * clientes HTTP recebem um `fetch` no construtor.
 */

import { carregarContextoMarca } from "../../src/adaptadores/marca";
import {
  ClienteDeepSeek,
  DeepSeekDiretorCriativo,
  DeepSeekRedator,
  ENDPOINT_DEEPSEEK,
  coresDosTokens,
  parseAngulos,
  parseArtigo,
  parseDirecoes,
  parseLegenda,
} from "../../src/adaptadores/deepseek";
import {
  instrucaoDeEdicao,
  jsonDoTexto,
  montarPromptDesigner,
  montarRubrica,
  parseVeredito,
} from "../../src/adaptadores/gemini";
import { BASE_TELEGRAM, TelegramReal } from "../../src/adaptadores/telegram";
import { carregarAdaptadores, perfilAtual } from "../../src/adaptadores/index";
import { FakePortaLinear } from "../../src/adaptadores/fake";
import tokens from "../../brand/tokens.json";
import type { DirecaoVisual, Pedido } from "../../src/modelos/tipos";

let falhas = 0;

function ok(condicao: unknown, descricao: string): void {
  if (condicao) return console.log(`ok      ${descricao}`);
  falhas++;
  console.error(`FALHOU  ${descricao}`);
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Não basta lançar: a mensagem tem que nomear o campo para alguém achar o defeito. */
function lanca(acao: () => unknown, trechos: readonly string[], descricao: string): void {
  let mensagem: string;
  try {
    acao();
    falhas++;
    return console.error(`FALHOU  ${descricao}\n        não lançou`);
  } catch (erro) {
    mensagem = mensagemDe(erro);
  }
  const faltando = trechos.filter((t) => !mensagem.includes(t));
  if (faltando.length === 0) return console.log(`ok      ${descricao}`);
  falhas++;
  console.error(
    `FALHOU  ${descricao}\n        a mensagem não cita ${faltando.join(", ")}\n        veio: ${mensagem}`,
  );
}

async function lancaAsync(
  acao: () => Promise<unknown>,
  trechos: readonly string[],
  descricao: string,
): Promise<void> {
  let mensagem: string;
  try {
    await acao();
    falhas++;
    return console.error(`FALHOU  ${descricao}\n        não lançou`);
  } catch (erro) {
    mensagem = mensagemDe(erro);
  }
  const faltando = trechos.filter((t) => !mensagem.includes(t));
  if (faltando.length === 0) return console.log(`ok      ${descricao}`);
  falhas++;
  console.error(
    `FALHOU  ${descricao}\n        a mensagem não cita ${faltando.join(", ")}\n        veio: ${mensagem}`,
  );
}

// ----------------------------------------------------------------------------
// Amostras
// ----------------------------------------------------------------------------

const marca = carregarContextoMarca();
const cores = coresDosTokens(marca.tokens);
const TEMA = "vidro temperado de 10 mm para fachada";
const PEDIDO: Pedido = { theme: TEMA, format: "both", objective: "falar com o vidraceiro" };

const TERRITORIOS = ["Minimal editorial", "Festivo comemorativo", "Institucional foto"];
const HEADLINES = ["Fachada que aguenta vento", "Dez milímetros de sossego", "Vidro que a obra pede"];

function direcaoBruta(i: number, ajustes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    territory: TERRITORIOS[i],
    composition: "fundo areia com muito respiro e headline grande à esquerda",
    palette: [tokens.color.neutral.areia, tokens.color.primary.tealEM, tokens.color.text.carvao],
    typography: "Montserrat Bold no headline, Inter no apoio",
    main_element: "painel de vidro temperado visto de canto",
    headline: HEADLINES[i],
    support_text: "Medição, projeto e instalação com a mesma equipe.",
    logo_variant: "cor",
    logo_rule: "logo colorido pequeno no rodapé",
    rationale: "o vidraceiro decide por segurança estrutural, e a peça mostra isso",
    prohibited_elements: ["foto de banco de imagem", "gradiente pesado"],
    ...ajustes,
  };
}

function direcoesBrutas(ajustes: readonly Record<string, unknown>[] = []): Record<string, unknown> {
  return { direcoes: [0, 1, 2].map((i) => direcaoBruta(i, ajustes[i] ?? {})) };
}

const CORPO_LEGENDA = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(" ");
const LEGENDA_BOA = `${CORPO_LEGENDA}\n\n#EMVidros #ImagineEmVidro #VidroTemperado #Vidracaria #Imperatriz`;

// ----------------------------------------------------------------------------
// parseDirecoes
// ----------------------------------------------------------------------------

const direcoes = parseDirecoes(direcoesBrutas(), { tema: TEMA, rodada: 1, cores });

ok(direcoes.length === 3, "parseDirecoes aceita o JSON bom e devolve três direções");
ok(
  direcoes.every((d) => /^[0-9A-HJ-KM-NP-TV-Z]{12}$/.test(d.direction_id)),
  "cada direção recebe um direction_id de 12 chars em base32 de Crockford",
);
ok(
  new Set(direcoes.map((d) => d.direction_id)).size === 3,
  "os três direction_id da rodada são distintos",
);
ok(
  parseDirecoes(direcoesBrutas(), { tema: TEMA, rodada: 1, cores })[0]!.direction_id ===
    direcoes[0]!.direction_id,
  "o direction_id é função do tema, da rodada, do índice e do headline, e não do relógio",
);
ok(
  parseDirecoes(direcoesBrutas(), { tema: TEMA, rodada: 2, cores })[0]!.direction_id !==
    direcoes[0]!.direction_id,
  "a rodada entra no direction_id, então a rodada 2 não colide com a 1",
);
ok(
  direcoes[0]!.logo_variant === "cor" && direcoes[0]!.support_text !== undefined,
  "logo_variant e support_text atravessam a narração",
);

lanca(
  () => parseDirecoes({ direcoes: [direcaoBruta(0), direcaoBruta(1)] }, { tema: TEMA, rodada: 1, cores }),
  ["direcoes", "2 direções", "exatamente 3"],
  "duas direções são recusadas nomeando o contrato",
);

lanca(
  () =>
    parseDirecoes(direcoesBrutas([{}, { palette: ["#FF0000"] }]), { tema: TEMA, rodada: 1, cores }),
  ["direcoes[1].palette", "#FF0000", "tokens.json"],
  "cor fora de tokens.json é recusada nomeando a cor",
);

lanca(
  () =>
    parseDirecoes(direcoesBrutas([{}, {}, { headline: "uma duas tres quatro cinco seis sete oito nove" }]), {
      tema: TEMA,
      rodada: 1,
      cores,
    }),
  ["direcoes[2].headline", "9 palavras", "máximo é 6"],
  "headline de 9 palavras é recusado nomeando o campo e a contagem",
);

lanca(
  () => parseDirecoes(direcoesBrutas([{ territory: "Minimal editorial" }, { territory: "Minimal editorial" }]), {
    tema: TEMA,
    rodada: 1,
    cores,
  }),
  ["direcoes", "territórios repetidos"],
  "duas direções no mesmo território são recusadas",
);

lanca(
  () => parseDirecoes(direcoesBrutas([{ logo_variant: "dourado" }]), { tema: TEMA, rodada: 1, cores }),
  ["direcoes[0].logo_variant"],
  "logo_variant fora de cor e branco é recusado",
);

lanca(
  () => parseDirecoes(direcoesBrutas([{ prohibited_elements: [] }]), { tema: TEMA, rodada: 1, cores }),
  ["direcoes[0].prohibited_elements"],
  "prohibited_elements vazio é recusado",
);

lanca(
  () => parseDirecoes({ direcoes: "três direções lindas" }, { tema: TEMA, rodada: 1, cores }),
  ["direcoes", "esperava lista"],
  "resposta que não é lista é recusada",
);

// ----------------------------------------------------------------------------
// parseLegenda, parseAngulos, parseArtigo
// ----------------------------------------------------------------------------

ok(parseLegenda({ legenda: LEGENDA_BOA }) === LEGENDA_BOA, "parseLegenda aceita a legenda boa");

lanca(
  () => parseLegenda({ legenda: `${CORPO_LEGENDA}\n\n#Vidracaria #EMVidros` }),
  ["legenda", "#Vidracaria", "#EMVidros"],
  "legenda sem #EMVidros na frente é recusada nomeando as duas hashtags",
);

lanca(
  () => parseLegenda({ legenda: "texto curto demais\n\n#EMVidros #Vidracaria" }),
  ["legenda", "palavras antes das hashtags"],
  "legenda curta demais é recusada pela contagem de palavras",
);

lanca(
  () => parseLegenda({ legenda: `${Array.from({ length: 200 }, (_, i) => `p${i}`).join(" ")} #EMVidros` }),
  ["legenda", "palavras antes das hashtags"],
  "legenda longa demais é recusada pela contagem de palavras",
);

lanca(() => parseLegenda({ legenda: CORPO_LEGENDA }), ["legenda", "nenhuma hashtag"], "legenda sem hashtag é recusada");

lanca(() => parseLegenda({}), ["legenda", "esperava texto"], "resposta sem o campo legenda é recusada");

const angulos = parseAngulos({
  angulos: [
    { titulo: "Como escolher a espessura", angulo: "guia de decisão pelo uso do ambiente" },
    { titulo: "Quanto custa e o que muda o preço", angulo: "abre a formação de custo" },
    { titulo: "Cinco erros de medição", angulo: "lista o que gera retrabalho" },
  ],
});
ok(angulos.length === 3 && angulos[0]!.titulo.startsWith("Como"), "parseAngulos devolve os três ângulos");
lanca(
  () => parseAngulos({ angulos: [{ titulo: "só um", angulo: "sozinho" }] }),
  ["angulos", "1"],
  "um ângulo só é recusado",
);

const artigo = parseArtigo({
  titulo: "Vidro temperado na fachada",
  markdown: "# Vidro temperado na fachada\n\nTexto.",
  tituloSeo: "Vidro temperado na fachada | EM Vidros",
  descricaoSeo: "O que pesa na escolha do vidro de fachada.",
  slug: "vidro-temperado-na-fachada",
  pendencias: [],
});
ok(artigo.slug === "vidro-temperado-na-fachada" && artigo.pendencias.length === 0, "parseArtigo narra o artigo");
lanca(
  () =>
    parseArtigo({
      titulo: "t",
      markdown: "m",
      tituloSeo: "s",
      descricaoSeo: "d",
      slug: "Slug Com Espaço",
      pendencias: [],
    }),
  ["artigo.slug"],
  "slug com maiúscula e espaço é recusado",
);

// ----------------------------------------------------------------------------
// Veredito
// ----------------------------------------------------------------------------

const vereditoBom = parseVeredito(
  jsonDoTexto('```json\n{"score": 9, "aprovada": true, "violacoes": []}\n```', "teste"),
);
ok(vereditoBom.aprovada && vereditoBom.score === 9, "veredito com nota 9 e sem violação é aprovado, com cerca de markdown");

ok(
  parseVeredito({ score: 9, aprovada: true, violacoes: [{ criterio: "paleta", problema: "coral dominante" }] })
    .aprovada === false,
  "violação de paleta reprova mesmo com nota alta e aprovada=true do modelo",
);
ok(
  parseVeredito({ score: 6, aprovada: true, violacoes: [] }).aprovada === false,
  "nota abaixo de 7 reprova mesmo sem violação",
);
ok(
  parseVeredito({ score: 8, violacoes: [{ criterio: "zonas", problema: "texto perto da base" }] }).aprovada === true,
  "violação que não é paleta, logo nem texto não bloqueia a aprovação",
);

lanca(
  () => parseVeredito({ aprovada: true, violacoes: [] }),
  ["veredito.score"],
  "veredito sem score é recusado nomeando o campo",
);
lanca(
  () => parseVeredito({ score: 8, violacoes: [{ problema: "sem critério" }] }),
  ["veredito.violacoes[0].criterio"],
  "violação sem critério é recusada nomeando o índice",
);
lanca(
  () => jsonDoTexto("desculpe, não consegui avaliar", "veredito"),
  ["veredito", "não é JSON válido"],
  "resposta do juiz sem JSON é recusada",
);

// ----------------------------------------------------------------------------
// Prompt do designer
// ----------------------------------------------------------------------------

const direcao: DirecaoVisual = direcoes[0]!;
const promptFeed = montarPromptDesigner(direcao, "feed");
const promptStories = montarPromptDesigner(direcao, "stories");
const zonas = tokens.formats.stories.safeZones;

ok(promptFeed.includes(`"${direcao.headline}"`), "o prompt do feed traz o headline literal entre aspas");
ok(promptStories.includes(`"${direcao.headline}"`), "o prompt do stories traz o headline literal entre aspas");
ok(
  direcao.palette.every((cor) => promptFeed.includes(cor)),
  "o prompt traz cada cor da paleta da direção",
);
ok(
  direcao.prohibited_elements.every((p) => promptFeed.includes(p)),
  "o prompt traz cada elemento proibido da direção",
);
ok(
  promptFeed.includes(direcao.composition) &&
    promptFeed.includes(direcao.typography) &&
    promptFeed.includes(direcao.main_element) &&
    promptFeed.includes(direcao.logo_rule),
  "o prompt traz composição, tipografia, elemento principal e regra do logo",
);
ok(
  promptStories.includes(`${zonas.topPx} px`) && promptStories.includes(`${zonas.bottomPx} px`),
  `o prompt do stories traz as zonas seguras de ${zonas.topPx} px e ${zonas.bottomPx} px`,
);
ok(
  !promptFeed.includes(String(zonas.topPx)),
  "o prompt do feed não fala em zona segura, que só existe no stories",
);

const instrucao = instrucaoDeEdicao("deixe o headline mais alto", "feed");
ok(
  instrucao.includes("deixe o headline mais alto") &&
    instrucao.trimEnd().endsWith("what was not asked about."),
  "a instrução de edição termina pedindo para preservar o que não foi citado",
);

const rubrica = montarRubrica({ formato: "stories", direcao, tema: TEMA });
ok(
  rubrica.includes(`"${direcao.headline}"`) && rubrica.includes(TEMA) && rubrica.includes(`${zonas.topPx}px`),
  "a rubrica do juiz traz headline literal, tema e as zonas seguras do stories",
);

// ----------------------------------------------------------------------------
// Clientes injetáveis
// ----------------------------------------------------------------------------

interface Pedidos {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fetchFalso(respostas: readonly { corpo?: unknown; status?: number; bytes?: Buffer }[]): {
  buscar: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  pedidos: Pedidos[];
} {
  const pedidos: Pedidos[] = [];
  let i = 0;
  return {
    pedidos,
    buscar: async (url, init) => {
      pedidos.push({ url: String(url), init });
      const resposta = respostas[i++];
      if (!resposta) throw new Error(`fetch falso: chamada ${i} sem resposta preparada.`);
      if (resposta.bytes)
        return new Response(new Uint8Array(resposta.bytes), { status: resposta.status ?? 200 });
      return new Response(JSON.stringify(resposta.corpo), {
        status: resposta.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

function respostaDeepSeek(carga: unknown): { corpo: unknown } {
  return { corpo: { choices: [{ message: { content: JSON.stringify(carga) } }] } };
}

{
  const { buscar, pedidos } = fetchFalso([respostaDeepSeek(direcoesBrutas())]);
  const criativo = new DeepSeekDiretorCriativo("chave-de-teste", buscar);
  const saida = await criativo.direcoes({ pedido: PEDIDO, marca, rodada: 1, excluir: ["ABC123XYZ789"] });

  ok(saida.length === 3, "o diretor criativo real devolve três direções pelo fetch injetado");
  const corpo = JSON.parse(String(pedidos[0]!.init?.body));
  ok(pedidos[0]!.url === ENDPOINT_DEEPSEEK, "o cliente chama a Chat Completions da DeepSeek");
  ok(corpo.model === "deepseek-v4-pro", "o pedido usa deepseek-v4-pro");
  ok(corpo.response_format?.type === "json_object", "o pedido exige response_format json_object");
  ok(
    String(corpo.messages[0].content).includes(marca.brandVersionId) &&
      String(corpo.messages[0].content).includes("Montserrat"),
    "o system carrega a versão da marca e o brandbook",
  );
  ok(
    Object.keys(marca.estilos).every((id) => String(corpo.messages[0].content).includes(`styles/${id}.md`)),
    `o system carrega os ${Object.keys(marca.estilos).length} estilos`,
  );
  ok(
    String(corpo.messages[1].content).includes("ABC123XYZ789") &&
      String(corpo.messages[1].content).includes("Não repita território nem composição"),
    "excluir vira o pedido explícito de não repetir território nem composição",
  );
}

{
  const { buscar, pedidos } = fetchFalso([
    respostaDeepSeek({ direcoes: [direcaoBruta(0), direcaoBruta(1)] }),
    respostaDeepSeek(direcoesBrutas()),
  ]);
  const criativo = new DeepSeekDiretorCriativo("chave-de-teste", buscar);
  const saida = await criativo.direcoes({ pedido: PEDIDO, marca, rodada: 1 });

  ok(saida.length === 3, "a retentativa recupera a resposta que falhou na validação");
  const segundo = JSON.parse(String(pedidos[1]!.init?.body));
  ok(
    String(segundo.messages[1].content).includes("2 direções"),
    "a retentativa manda o erro de validação de volta no prompt",
  );
}

await lancaAsync(
  async () => {
    const { buscar } = fetchFalso([
      respostaDeepSeek({ direcoes: [] }),
      respostaDeepSeek({ direcoes: [] }),
    ]);
    await new DeepSeekDiretorCriativo("chave-de-teste", buscar).direcoes({ pedido: PEDIDO, marca, rodada: 1 });
  },
  ["recusado duas vezes"],
  "duas recusas seguidas lançam com as duas mensagens",
);

{
  const { buscar } = fetchFalso([respostaDeepSeek({ legenda: LEGENDA_BOA })]);
  const redator = new DeepSeekRedator("chave-de-teste", buscar);
  const legenda = await redator.legenda({ pedido: PEDIDO, direcao, marca });
  ok(legenda === LEGENDA_BOA, "o redator real devolve a legenda validada");
}

{
  const { buscar, pedidos } = fetchFalso([respostaDeepSeek({ legenda: LEGENDA_BOA })]);
  const redator = new DeepSeekRedator("chave-de-teste", buscar);
  await redator.legenda({
    pedido: PEDIDO,
    direcao,
    marca,
    anterior: "legenda de ontem",
    ajuste: "deixe a abertura mais curta",
  });
  const corpo = JSON.parse(String(pedidos[0]!.init?.body));
  ok(
    String(corpo.messages[1].content).includes("legenda de ontem") &&
      String(corpo.messages[1].content).includes("deixe a abertura mais curta") &&
      String(corpo.messages[1].content).includes("preservando tudo que ele não citou"),
    "com anterior e ajuste o prompt pede reescrita preservando o que o ajuste não citou",
  );
}

await lancaAsync(
  async () => {
    const { buscar } = fetchFalso([
      { corpo: { error: "sem crédito" }, status: 402 },
      { corpo: { error: "sem crédito" }, status: 402 },
    ]);
    await new DeepSeekRedator("chave-de-teste", buscar).legenda({ pedido: PEDIDO, direcao, marca });
  },
  ["DeepSeek", "402"],
  "HTTP de erro da DeepSeek vira erro com o status",
);

// ----------------------------------------------------------------------------
// Telegram
// ----------------------------------------------------------------------------

const TOKEN_FALSO = "123456:segredo-que-nao-pode-vazar";
const JPEG = Buffer.from("jpeg falso");

{
  const { buscar, pedidos } = fetchFalso([{ corpo: { ok: true, result: [{ message_id: 7 }, { message_id: 8 }] } }]);
  const telegram = new TelegramReal(TOKEN_FALSO, buscar);
  const saida = await telegram.enviarAlbum(42, [JPEG, JPEG], "as três prévias");

  ok(saida.message_ids.join(",") === "7,8", "enviarAlbum devolve os message_id do grupo");
  const corpo = pedidos[0]!.init?.body;
  const midia = corpo instanceof FormData ? JSON.parse(String(corpo.get("media"))) : [];
  ok(
    midia.length === 2 && midia[0].caption === "as três prévias" && midia[1].caption === undefined,
    "a caption do álbum vai só na primeira foto",
  );
}

await lancaAsync(
  () => new TelegramReal(TOKEN_FALSO, fetchFalso([]).buscar).enviarAlbum(42, Array(11).fill(JPEG)),
  ["sendMediaGroup", "11 fotos", "10"],
  "álbum com mais de 10 fotos é recusado antes de sair da máquina",
);

{
  const { buscar } = fetchFalso([{ corpo: { ok: true, result: { message_id: 9, document: { file_id: "BQACAgE" } } } }]);
  const telegram = new TelegramReal(TOKEN_FALSO, buscar);
  const saida = await telegram.enviarDocumento(42, Buffer.from("png falso"), "em-vidros-feed-v1.png");
  ok(saida.file_id === "BQACAgE", "enviarDocumento devolve result.document.file_id");
}

{
  const { buscar, pedidos } = fetchFalso([{ bytes: Buffer.from("bytes do mestre") }]);
  const telegram = new TelegramReal(TOKEN_FALSO, buscar);
  const bytes = await telegram.baixarArquivo("documents/file_1.png");
  ok(bytes.toString() === "bytes do mestre", "baixarArquivo devolve os bytes crus");
  ok(
    pedidos[0]!.url === `${BASE_TELEGRAM}/file/bot${TOKEN_FALSO}/documents/file_1.png`,
    "baixarArquivo usa o caminho de arquivo da API, e não o de método",
  );
}

{
  const { buscar } = fetchFalso([{ corpo: { ok: false, description: "chat not found" } }]);
  const telegram = new TelegramReal(TOKEN_FALSO, buscar);
  let mensagem = "";
  try {
    await telegram.enviarMensagem(42, "oi");
  } catch (erro) {
    mensagem = mensagemDe(erro);
  }
  ok(mensagem === "Telegram sendMessage: chat not found", "erro da API vira Telegram <método>: <description>");
  ok(!mensagem.includes(TOKEN_FALSO), "a mensagem de erro não carrega o token");
}

{
  const { buscar } = fetchFalso([{ corpo: { ok: false, description: "query is too old" } }]);
  const telegram = new TelegramReal(TOKEN_FALSO, buscar);
  await telegram.responderCallback("cb-1", "anotado");
  ok(true, "responderCallback engole o erro da API");
}

// ----------------------------------------------------------------------------
// Perfis
// ----------------------------------------------------------------------------

const CHAVES_DE_AMBIENTE = [
  "ADAPTADORES",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "LINEAR_API_KEY",
  "LINEAR_LABEL_ID",
  "LINEAR_TEAM_ID",
] as const;

function comAmbiente<T>(variaveis: Record<string, string>, acao: () => T): T {
  const antes = new Map(CHAVES_DE_AMBIENTE.map((chave) => [chave, process.env[chave]]));
  for (const chave of CHAVES_DE_AMBIENTE) delete process.env[chave];
  Object.assign(process.env, variaveis);
  try {
    return acao();
  } finally {
    for (const chave of CHAVES_DE_AMBIENTE) {
      const valor = antes.get(chave);
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
  }
}

comAmbiente({}, () => {
  const adaptadores = carregarAdaptadores();
  ok(perfilAtual() === "fake", "ADAPTADORES vazio é o perfil fake");
  ok(adaptadores.linear instanceof FakePortaLinear, "o perfil fake sobe sem nenhuma variável de ambiente");
});

comAmbiente({ ADAPTADORES: "ensaio" }, () =>
  lanca(
    () => carregarAdaptadores(),
    ["ensaio", "TELEGRAM_BOT_TOKEN"],
    "ensaio sem TELEGRAM_BOT_TOKEN lança nomeando a variável",
  ),
);

comAmbiente({ ADAPTADORES: "ensaio", TELEGRAM_BOT_TOKEN: TOKEN_FALSO }, () => {
  const adaptadores = carregarAdaptadores();
  ok(adaptadores.telegram instanceof TelegramReal, "ensaio sobe com Telegram real");
  ok(adaptadores.linear instanceof FakePortaLinear, "ensaio mantém o Linear falso");
});

comAmbiente({ ADAPTADORES: "real" }, () =>
  lanca(
    () => carregarAdaptadores(),
    ["real", "DEEPSEEK_API_KEY", "GEMINI_API_KEY", "TELEGRAM_BOT_TOKEN", "LINEAR_API_KEY", "LINEAR_LABEL_ID"],
    "real sem nada lança nomeando as cinco variáveis de uma vez",
  ),
);

comAmbiente(
  {
    ADAPTADORES: "real",
    DEEPSEEK_API_KEY: "ds",
    GEMINI_API_KEY: "gm",
    TELEGRAM_BOT_TOKEN: TOKEN_FALSO,
    LINEAR_API_KEY: "ln",
    LINEAR_LABEL_ID: "label",
  },
  () => {
    const adaptadores = carregarAdaptadores();
    ok(
      adaptadores.criativo instanceof DeepSeekDiretorCriativo && adaptadores.telegram instanceof TelegramReal,
      "real com as cinco variáveis monta os adaptadores sem tocar a rede",
    );
  },
);

comAmbiente({ ADAPTADORES: "producao" }, () =>
  lanca(() => perfilAtual(), ["producao", "não existe"], "perfil desconhecido lança dizendo os que existem"),
);

// O cliente cru continua construível sem chave nem rede, que é o que deixa o arnês
// exercitar a narração da resposta sem subir servidor.
ok(new ClienteDeepSeek("chave", fetchFalso([]).buscar) instanceof ClienteDeepSeek, "o cliente DeepSeek é injetável");

if (falhas) {
  console.error(`\nadaptadores: ${falhas} asserção(ões) falharam`);
  process.exit(1);
}
console.log("\nadaptadores: ok");
