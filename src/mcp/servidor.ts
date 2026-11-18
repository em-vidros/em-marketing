import { q } from "../v2/banco";
import { chamadorDe } from "./permissao";

// O MCP que a Consulta do EM Hub usa para ler o em-marketing, montado em /api/mcp. Só lê. Fala
// JSON-RPC por HTTP, sem sessão, como o api/mcp.ts do Molde no em-hub.

const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];

const FUSO = "America/Sao_Paulo";
// O Brasil não tem horário de verão desde 2019: o dia em São Paulo começa às 03:00 UTC.
const OFFSET = "-03:00";

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

const SO_LEITURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const DE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Primeiro dia, AAAA-MM-DD em America/Sao_Paulo. Inclusivo." };
const ATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Último dia, AAAA-MM-DD em America/Sao_Paulo. Inclusivo." };
const LIMITE = {
  type: "integer",
  minimum: 1,
  maximum: LIMITE_MAXIMO,
  description: `Quantos itens, até ${LIMITE_MAXIMO}. O padrão é ${LIMITE_PADRAO}. \`total\` conta todos, mesmo os que passaram do limite.`,
};
const JANELA = { type: "object", properties: { de: DE, ate: ATE, limite: LIMITE } };

const lista = (item: Record<string, unknown>) => ({
  type: "object",
  properties: { total: { type: "integer" }, itens: { type: "array", items: { type: "object", properties: item } } },
  required: ["total", "itens"],
});

type Args = Record<string, unknown>;

/** Um pedido que a ferramenta recusa volta ao modelo como `isError`, para ele corrigir e tentar de novo. */
class Recusa extends Error {}

class ErroDoProtocolo extends Error {
  constructor(
    readonly codigo: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}


const DIA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;

const formatoLocal = new Intl.DateTimeFormat("sv-SE", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** As colunas antigas guardam UTC como "AAAA-MM-DD HH:MM:SS"; as do estúdio voltam como Date. Sai "AAAA-MM-DD HH:MM" em São Paulo. */
function horaLocal(valor: unknown): string | null {
  if (valor instanceof Date) return formatoLocal.format(valor);
  if (typeof valor !== "string" || valor === "") return null;
  const data = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(valor) ? `${valor.replace(" ", "T")}Z` : valor);
  return Number.isNaN(data.getTime()) ? valor : formatoLocal.format(data);
}

const hojeLocal = () => formatoLocal.format(new Date()).slice(0, 10);

const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00${OFFSET}`);
const diaSeguinte = (dia: string) => new Date(inicioDoDia(dia).getTime() + 86_400_000).toISOString().slice(0, 10);
/** O formato de queue.publish_at, posts.created_at e publicacoes.published_at, que comparam como texto. */
const utcTexto = (data: Date) => data.toISOString().replace("T", " ").slice(0, 19);

function diaPedido(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string" || !DIA.test(valor) || Number.isNaN(inicioDoDia(valor).getTime())) {
    throw new Recusa(`${campo} precisa ser um dia AAAA-MM-DD, como ${hojeLocal()}.`);
  }
  return valor;
}

/** A janela em dias de São Paulo, `de` e `ate` inclusivos, e o mesmo intervalo em instantes UTC com o fim exclusivo. */
function janela(args: Args) {
  const de = diaPedido(args.de, "de");
  const ate = diaPedido(args.ate, "ate");
  if (de && ate && de > ate) throw new Recusa("de vem depois de ate.");
  const desde = de ? inicioDoDia(de) : null;
  const antes = ate ? inicioDoDia(diaSeguinte(ate)) : null;
  return { de, ate, desde, antes };
}

function limitePedido(valor: unknown) {
  if (valor === undefined || valor === null) return LIMITE_PADRAO;
  const n = Math.trunc(Number(valor));
  if (!Number.isFinite(n) || n < 1) throw new Recusa(`limite precisa ser um número de 1 a ${LIMITE_MAXIMO}.`);
  return Math.min(n, LIMITE_MAXIMO);
}


const TIPO: Record<string, string> = { IMAGE: "feed", STORIES: "stories" };
const STATUS_DA_FILA: Record<string, string> = { pending: "agendado", publishing: "publicando", failed: "falhou" };
const STATUS_DA_PECA: Record<string, string> = {
  draft: "rascunho",
  generated: "artes geradas",
  chosen: "arte escolhida",
  scheduled: "agendada",
  published: "publicada",
  failed: "falhou",
};

function json(texto: unknown): unknown {
  if (typeof texto !== "string") return texto;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/** posts.headline é o JSON {headline, apoio} que o bot grava, ou texto puro nas peças antigas. */
function headlineDo(coluna: string | null) {
  if (!coluna) return { titulo: null, apoio: null };
  const valor = json(coluna) as { headline?: unknown; apoio?: unknown } | null;
  if (valor && typeof valor === "object" && typeof valor.headline === "string") {
    return { titulo: valor.headline, apoio: typeof valor.apoio === "string" ? valor.apoio : null };
  }
  return { titulo: coluna, apoio: null };
}

function temaDo(brief: string | null): string | null {
  const valor = json(brief) as { tema?: unknown } | null;
  return valor && typeof valor === "object" && typeof valor.tema === "string" ? valor.tema : null;
}

/** Os textos que aparecem na arte, na ordem das camadas. */
function textosDa(camadas: unknown): string[] {
  const lidas = json(camadas);
  if (!Array.isArray(lidas)) return [];
  return lidas.flatMap((c) => (c && typeof c === "object" && c.tipo === "texto" && typeof c.texto === "string" ? [c.texto] : []));
}

/** queue e publicacoes apontam para uma peça do fluxo dos bots ou para uma arte do estúdio. */
function origemDa(r: { post_id: number | null; headline: string | null; pilar: string | null; arte_pedido: string | null }) {
  if (r.post_id !== null) return { origem: `peça ${r.post_id}`, titulo: headlineDo(r.headline).titulo, pilar: r.pilar };
  return { origem: "arte do estúdio", titulo: r.arte_pedido, pilar: null };
}

const totalDe = (linhas: readonly { total: number }[]) => linhas[0]?.total ?? 0;


type LinhaDaFonte = { post_id: number | null; headline: string | null; pilar: string | null; arte_pedido: string | null; total: number };

async function listarAgenda(args: Args) {
  const { desde, antes } = janela(args);
  const limite = limitePedido(args.limite);
  const de = desde && utcTexto(desde);
  const ate = antes && utcTexto(antes);
  const linhas = await q<LinhaDaFonte & { id: number; media_type: string; publish_at: string; status: string; error: string | null; legenda: string | null }>`
    SELECT fila.id, fila.media_type, fila.publish_at, fila.status, fila.error, fila.legenda, fila.post_id,
      p.headline, p.pilar, a.pedido AS arte_pedido, count(*) OVER ()::int AS total
    FROM queue fila
    LEFT JOIN posts p ON p.id = fila.post_id
    LEFT JOIN artes a ON a.id::text = fila.arte_id
    WHERE fila.status IN ('pending', 'publishing', 'failed')
      AND (${de}::text IS NULL OR fila.publish_at >= ${de}::text)
      AND (${ate}::text IS NULL OR fila.publish_at < ${ate}::text)
    ORDER BY fila.publish_at, fila.id
    LIMIT ${limite}`;
  return {
    total: totalDe(linhas),
    itens: linhas.map((r) => ({
      id: r.id,
      quando: horaLocal(r.publish_at),
      onde: TIPO[r.media_type] ?? r.media_type,
      status: STATUS_DA_FILA[r.status] ?? r.status,
      erro: r.error,
      ...origemDa(r),
      legenda: r.legenda,
    })),
  };
}

async function listarPecas(args: Args) {
  const { desde, antes } = janela(args);
  const limite = limitePedido(args.limite);
  const de = desde && utcTexto(desde);
  const ate = antes && utcTexto(antes);
  const linhas = await q<{
    id: number;
    headline: string | null;
    legenda: string | null;
    brief: string | null;
    pilar: string | null;
    formato: string | null;
    status: string | null;
    created_at: string;
    total: number;
  }>`
    SELECT id, headline, legenda, brief, pilar, formato, status, created_at, count(*) OVER ()::int AS total
    FROM posts
    WHERE (${de}::text IS NULL OR created_at >= ${de}::text)
      AND (${ate}::text IS NULL OR created_at < ${ate}::text)
    ORDER BY created_at DESC, id DESC
    LIMIT ${limite}`;
  return {
    total: totalDe(linhas),
    itens: linhas.map((r) => ({
      id: r.id,
      criada_em: horaLocal(r.created_at),
      ...headlineDo(r.headline),
      tema: temaDo(r.brief),
      pilar: r.pilar,
      formato: r.formato,
      status: STATUS_DA_PECA[r.status ?? "draft"] ?? r.status,
      legenda: r.legenda,
    })),
  };
}

async function listarPublicacoes(args: Args) {
  const { desde, antes } = janela(args);
  const limite = limitePedido(args.limite);
  const de = desde && utcTexto(desde);
  const ate = antes && utcTexto(antes);
  const linhas = await q<LinhaDaFonte & { id: number; media_type: string; permalink: string | null; published_at: string }>`
    SELECT u.id, u.media_type, u.permalink, u.published_at, u.post_id,
      p.headline, p.pilar, a.pedido AS arte_pedido, count(*) OVER ()::int AS total
    FROM publicacoes u
    LEFT JOIN posts p ON p.id = u.post_id
    LEFT JOIN artes a ON a.id::text = u.arte_id
    WHERE (${de}::text IS NULL OR u.published_at >= ${de}::text)
      AND (${ate}::text IS NULL OR u.published_at < ${ate}::text)
    ORDER BY u.published_at DESC, u.id DESC
    LIMIT ${limite}`;
  return {
    total: totalDe(linhas),
    itens: linhas.map((r) => ({
      id: r.id,
      publicada_em: horaLocal(r.published_at),
      onde: TIPO[r.media_type] ?? r.media_type,
      ...origemDa(r),
      link: r.permalink,
    })),
  };
}

async function listarPautas(args: Args) {
  const { de, ate } = janela(args);
  const limite = limitePedido(args.limite);
  const linhas = await q<{ id: number; dia: string; hora: string | null; titulo: string; pilar: string | null; nota: string; total: number }>`
    SELECT id, dia, hora, titulo, pilar, nota, count(*) OVER ()::int AS total
    FROM pautas
    WHERE apagada_em IS NULL
      AND (${de}::text IS NULL OR dia >= ${de}::text)
      AND (${ate}::text IS NULL OR dia <= ${ate}::text)
    ORDER BY dia, hora NULLS FIRST, id
    LIMIT ${limite}`;
  return {
    total: totalDe(linhas),
    itens: linhas.map((r) => ({ id: r.id, dia: r.dia, hora: r.hora, titulo: r.titulo, pilar: r.pilar, nota: r.nota || null })),
  };
}

async function listarArtes(args: Args) {
  const { desde, antes } = janela(args);
  const limite = limitePedido(args.limite);
  const de = desde?.toISOString() ?? null;
  const ate = antes?.toISOString() ?? null;
  const linhas = await q<{ id: string; pedido: string; formato: string; camadas: unknown; criada_em: Date | string; total: number }>`
    SELECT id::text AS id, pedido, formato, camadas, criada_em, count(*) OVER ()::int AS total
    FROM artes
    WHERE (${de}::timestamptz IS NULL OR criada_em >= ${de}::timestamptz)
      AND (${ate}::timestamptz IS NULL OR criada_em < ${ate}::timestamptz)
    ORDER BY criada_em DESC
    LIMIT ${limite}`;
  return {
    total: totalDe(linhas),
    itens: linhas.map((r) => ({ id: r.id, criada_em: horaLocal(r.criada_em), pedido: r.pedido, formato: r.formato, textos: textosDa(r.camadas) })),
  };
}

async function resumoDoMes(args: Args) {
  const pedido = args.mes;
  if (pedido !== undefined && pedido !== null && pedido !== "" && (typeof pedido !== "string" || !MES.test(pedido))) {
    throw new Recusa(`mes precisa ser AAAA-MM, como ${hojeLocal().slice(0, 7)}.`);
  }
  const mes = typeof pedido === "string" && pedido !== "" ? pedido : hojeLocal().slice(0, 7);
  const primeiro = `${mes}-01`;
  const [ano, m] = mes.split("-").map(Number) as [number, number];
  const seguinte = m === 12 ? `${ano + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, "0")}-01`;
  const de = utcTexto(inicioDoDia(primeiro));
  const ate = utcTexto(inicioDoDia(seguinte));

  const [porPilar, [artes], [fila], [publicadas], [pautas]] = await Promise.all([
    q<{ pilar: string; quantidade: number }>`
      SELECT coalesce(pilar, 'sem pilar') AS pilar, count(*)::int AS quantidade
      FROM posts WHERE created_at >= ${de} AND created_at < ${ate}
      GROUP BY 1 ORDER BY 2 DESC, 1`,
    q<{ n: number }>`
      SELECT count(*)::int AS n FROM artes
      WHERE criada_em >= ${inicioDoDia(primeiro).toISOString()}::timestamptz AND criada_em < ${inicioDoDia(seguinte).toISOString()}::timestamptz`,
    q<{ agendadas: number; com_falha: number }>`
      SELECT count(*) FILTER (WHERE status IN ('pending', 'publishing'))::int AS agendadas,
        count(*) FILTER (WHERE status = 'failed')::int AS com_falha
      FROM queue WHERE publish_at >= ${de} AND publish_at < ${ate}`,
    q<{ n: number }>`SELECT count(*)::int AS n FROM publicacoes WHERE published_at >= ${de} AND published_at < ${ate}`,
    q<{ n: number }>`SELECT count(*)::int AS n FROM pautas WHERE apagada_em IS NULL AND dia >= ${primeiro} AND dia < ${seguinte}`,
  ]);
  return {
    mes,
    pecas_criadas: porPilar.reduce((soma, g) => soma + g.quantidade, 0),
    pecas_por_pilar: porPilar,
    artes_criadas: artes?.n ?? 0,
    publicadas: publicadas?.n ?? 0,
    agendadas: fila?.agendadas ?? 0,
    com_falha: fila?.com_falha ?? 0,
    pautas: pautas?.n ?? 0,
  };
}

const ORIGEM = {
  origem: { type: "string", description: '"peça N" para as peças dos bots, "arte do estúdio" para as artes.' },
  titulo: { type: ["string", "null"] },
  pilar: { type: ["string", "null"] },
};

const FERRAMENTAS: Record<string, { definicao: Record<string, unknown>; executar: (args: Args) => Promise<Record<string, unknown>> }> = {
  listar_agenda: {
    executar: listarAgenda,
    definicao: {
      title: "Agenda do Instagram",
      description:
        "Lista o que está na fila para sair no Instagram (feed ou stories) e ainda não saiu: agendado, publicando ou com falha, do mais cedo para o mais tarde. A janela filtra pelo horário marcado para publicar.",
      inputSchema: JANELA,
      outputSchema: lista({
        id: { type: "integer" },
        quando: { type: "string", description: "AAAA-MM-DD HH:MM em America/Sao_Paulo." },
        onde: { type: "string", enum: ["feed", "stories"] },
        status: { type: "string", enum: ["agendado", "publicando", "falhou"] },
        erro: { type: ["string", "null"] },
        ...ORIGEM,
        legenda: { type: ["string", "null"] },
      }),
    },
  },
  listar_publicacoes: {
    executar: listarPublicacoes,
    definicao: {
      title: "Publicações no Instagram",
      description: "Lista o que já saiu no Instagram, do mais recente para o mais antigo, com o link de cada post. A janela filtra pelo dia da publicação.",
      inputSchema: JANELA,
      outputSchema: lista({
        id: { type: "integer" },
        publicada_em: { type: "string", description: "AAAA-MM-DD HH:MM em America/Sao_Paulo." },
        onde: { type: "string", enum: ["feed", "stories"] },
        ...ORIGEM,
        link: { type: ["string", "null"] },
      }),
    },
  },
  listar_pecas: {
    executar: listarPecas,
    definicao: {
      title: "Peças criadas com os bots",
      description:
        "Lista as peças criadas na conversa com os bots, da mais nova para a mais antiga, com headline, apoio, tema, pilar (PROVA, AUTORIDADE, GENTE ou MARCA), formato, status e legenda. As artes feitas no estúdio ficam em listar_artes. A janela filtra pelo dia da criação.",
      inputSchema: JANELA,
      outputSchema: lista({
        id: { type: "integer" },
        criada_em: { type: "string" },
        titulo: { type: ["string", "null"] },
        apoio: { type: ["string", "null"] },
        tema: { type: ["string", "null"] },
        pilar: { type: ["string", "null"] },
        formato: { type: ["string", "null"] },
        status: { type: "string" },
        legenda: { type: ["string", "null"] },
      }),
    },
  },
  listar_artes: {
    executar: listarArtes,
    definicao: {
      title: "Artes do estúdio",
      description:
        "Lista as artes feitas no estúdio, da mais nova para a mais antiga, com o pedido de quem criou, o formato (feed ou story) e os textos que aparecem na arte. A janela filtra pelo dia da criação.",
      inputSchema: JANELA,
      outputSchema: lista({
        id: { type: "string" },
        criada_em: { type: "string" },
        pedido: { type: "string" },
        formato: { type: "string" },
        textos: { type: "array", items: { type: "string" } },
      }),
    },
  },
  listar_pautas: {
    executar: listarPautas,
    definicao: {
      title: "Pautas do calendário",
      description:
        "Lista as pautas do calendário editorial, as ideias do que postar em cada dia antes de virar peça, em ordem de dia e hora. Hora vazia quer dizer o dia inteiro. A janela filtra pelo dia da pauta.",
      inputSchema: JANELA,
      outputSchema: lista({
        id: { type: "integer" },
        dia: { type: "string" },
        hora: { type: ["string", "null"] },
        titulo: { type: "string" },
        pilar: { type: ["string", "null"] },
        nota: { type: ["string", "null"] },
      }),
    },
  },
  resumo_do_mes: {
    executar: resumoDoMes,
    definicao: {
      title: "Resumo do mês",
      description:
        "Conta o mês de uma vez: peças criadas com os bots e quantas de cada pilar, artes do estúdio criadas, publicações que saíram, itens agendados e com falha na fila, e pautas do calendário. Use para qualquer pergunta de quantidade.",
      inputSchema: {
        type: "object",
        properties: {
          mes: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "AAAA-MM em America/Sao_Paulo. O padrão é o mês atual." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          mes: { type: "string" },
          pecas_criadas: { type: "integer" },
          pecas_por_pilar: {
            type: "array",
            items: { type: "object", properties: { pilar: { type: "string" }, quantidade: { type: "integer" } }, required: ["pilar", "quantidade"] },
          },
          artes_criadas: { type: "integer" },
          publicadas: { type: "integer" },
          agendadas: { type: "integer" },
          com_falha: { type: "integer" },
          pautas: { type: "integer" },
        },
        required: ["mes", "pecas_criadas", "pecas_por_pilar", "artes_criadas", "publicadas", "agendadas", "com_falha", "pautas"],
      },
    },
  },
};

const LISTA_DE_FERRAMENTAS = Object.entries(FERRAMENTAS).map(([name, { definicao }]) => ({ name, ...definicao, annotations: SO_LEITURA }));

const instrucoes = () =>
  `Dados do em-marketing, o App de marketing da EM Vidros: peças criadas com os bots, artes do estúdio, a agenda do Instagram, o que já saiu e as pautas do calendário. Hoje é ${hojeLocal()}. Datas e horas estão em America/Sao_Paulo, e de e ate são dias AAAA-MM-DD nesse fuso, os dois inclusivos. Para contar, use resumo_do_mes ou o campo total, nunca conte itens à mão. Responda só com o que as ferramentas devolverem e diga quando vierem vazias.`;


type Id = string | number;
type Chamada = { id: Id | undefined; method: string; params: Args };

export async function rotaMcp(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });

  if (!chamadorDe(req)) return Response.json({ erro: "Sem acesso" }, { status: 401, headers: { "www-authenticate": "Bearer" } });

  const versao = req.headers.get("mcp-protocol-version");
  if (versao !== null && !VERSOES.includes(versao)) {
    return Response.json(erro(null, -32600, `Versão do MCP sem suporte: ${versao}`), { status: 400 });
  }

  const chamada = lerChamada(await req.json().catch(() => null));
  if (!chamada) return Response.json(erro(null, -32600, "Pedido inválido"), { status: 400 });
  if (chamada.id === undefined) return new Response(null, { status: 202 });

  try {
    return Response.json({ jsonrpc: "2.0", id: chamada.id, result: await responder(chamada) });
  } catch (falha) {
    if (falha instanceof ErroDoProtocolo) return Response.json(erro(chamada.id, falha.codigo, falha.message));
    console.error("[mcp]", falha);
    return Response.json(erro(chamada.id, -32603, "Erro ao ler os dados do em-marketing"));
  }
}

function lerChamada(corpo: unknown): Chamada | null {
  if (!ehObjeto(corpo) || corpo.jsonrpc !== "2.0" || typeof corpo.method !== "string") return null;
  const { id, params } = corpo;
  if (id !== undefined && typeof id !== "string" && typeof id !== "number") return null;
  return { id, method: corpo.method, params: ehObjeto(params) ? params : {} };
}

async function responder({ method, params }: Chamada) {
  switch (method) {
    case "initialize": {
      const pedida = params.protocolVersion;
      return {
        protocolVersion: typeof pedida === "string" && VERSOES.includes(pedida) ? pedida : VERSOES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "em-marketing", title: "EM Marketing", version: "1.0.0" },
        instructions: instrucoes(),
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: LISTA_DE_FERRAMENTAS };
    case "tools/call":
      return chamarFerramenta(params);
    default:
      throw new ErroDoProtocolo(-32601, `Método desconhecido: ${method}`);
  }
}

async function chamarFerramenta(params: Args) {
  const ferramenta = typeof params.name === "string" ? FERRAMENTAS[params.name] : undefined;
  if (!ferramenta) throw new ErroDoProtocolo(-32602, `Ferramenta desconhecida: ${String(params.name)}`);
  try {
    const dados = await ferramenta.executar(ehObjeto(params.arguments) ? params.arguments : {});
    // O MCP de 2025-06-18 pede o objeto em `structuredContent` e o mesmo JSON em texto, para os clientes que não leem o primeiro.
    return { content: [{ type: "text", text: JSON.stringify(dados) }], structuredContent: dados };
  } catch (falha) {
    if (falha instanceof Recusa) return recusado(falha.message);
    console.error("[mcp]", falha);
    return recusado(`O banco recusou a leitura${falha instanceof Error ? `: ${falha.message}` : ""}.`);
  }
}

const recusado = (mensagem: string) => ({ content: [{ type: "text", text: mensagem }], isError: true });

const ehObjeto = (valor: unknown): valor is Args => typeof valor === "object" && valor !== null && !Array.isArray(valor);

const erro = (id: Id | null, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
