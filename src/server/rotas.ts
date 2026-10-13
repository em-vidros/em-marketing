import { readdirSync } from "node:fs";
import { safeValidateUIMessages } from "ai";
import type { BunRequest } from "bun";
import { z } from "zod";
import { BOTS, ehBotId, type BotId } from "../agent/bots";
import {
  apagarPauta,
  agendadoPorId,
  conversaDaPauta,
  criarPauta,
  diasNaJanela,
  ehDia,
  itensDoCalendario,
  JANELA_MAXIMA,
  mudarPauta,
  restaurarPauta,
  type Dia,
} from "../agent/calendario";
import { configDoBot, detalheDoBot, gravarVersao, restaurarPadrao, restaurarVersao, versaoDoBot, versoesDoBot } from "../agent/config";
import {
  apagarConversa,
  apagarMensagem,
  conversaDoUsuario,
  conversasDoUsuario,
  mensagensDaConversa,
  mudarConversa,
  restaurarConversa,
  restaurarMensagens,
  type Recusa,
} from "../agent/conversas";
import { agendar, cancelar, postsProntos, reagendar, restaurar, type RecusaDaFila } from "../agent/fila";
import { ehModelId, modelos, problemaDoModelo, type ModelId } from "../agent/models";
import { postPorId } from "../agent/post";
import { pegarTarefa, tarefasAtivas, tarefasDaConversa, trabalhoDoBot } from "../agent/tarefas";
import {
  agendamentos,
  aprovacoesPendentes,
  db,
  inicioDoDia,
  pecasDoUsuario,
  publicacoesRecentes,
  tarefasEmCurso,
  tarefasFeitas,
  type Agora,
  type Historico,
} from "../db";
import { PILARES } from "../domain/art/pipeline";
import { auth, usuarioDa, type Usuario } from "./auth";
import { rotaDeChat, type OpcoesChat } from "./chat";

/** Ícones e logos de brand/assets (espelho da pasta oficial; `bun run assets`). Lidos no boot, servidos da memória. */
const marca = Object.fromEntries([
  ...readdirSync("brand/assets/web").map((nome) => [`/${nome}`, Bun.file(`brand/assets/web/${nome}`)] as const),
  ...readdirSync("brand/assets/logo")
    .filter((nome) => nome.endsWith(".svg"))
    .map((nome) => [`/logo/${nome}`, Bun.file(`brand/assets/logo/${nome}`)] as const),
]);

const naoEncontrado = () => Response.json({ erro: "Não encontrado." }, { status: 404 });
const invalido = (mensagem: string) => Response.json({ erro: mensagem }, { status: 400 });

/** A sessão é lida uma vez aqui; a rota recebe o usuário já tipado. */
function comSessao<P extends string>(rota: (req: BunRequest<P>, usuario: Usuario) => Response | Promise<Response>) {
  return async (req: BunRequest<P>) => {
    const usuario = await usuarioDa(req);
    return usuario ? rota(req, usuario) : Response.json({ erro: "Entre para continuar." }, { status: 401 });
  };
}

/** Uma rota de /api/bots/:id. Bot desconhecido dá 404 antes de chegar à rota. */
function doBot<P extends `/api/bots/:id${string}`>(rota: (req: BunRequest<P>, usuario: Usuario, botId: BotId) => Response | Promise<Response>) {
  return comSessao<P>((req, usuario) => {
    const { id } = req.params as Record<string, string>;
    return id !== undefined && ehBotId(id) ? rota(req, usuario, id) : naoEncontrado();
  });
}

/** O corpo validado, ou a resposta 400 com a primeira mensagem do schema, já em português. */
async function lerCorpo<S extends z.ZodType>(req: Request, schema: S): Promise<{ dados: z.output<S> } | { resposta: Response }> {
  const r = schema.safeParse(await req.json().catch(() => null));
  return r.success ? { dados: r.data } : { resposta: invalido(r.error.issues[0]?.message ?? "Pedido inválido.") };
}

const recusar = ({ status, erro }: Recusa) => Response.json({ erro }, { status });
const recusarNaFila = ({ status, motivo }: RecusaDaFila) => Response.json({ erro: motivo }, { status });

/** O :id numérico da rota; qualquer outra coisa é um id que não existe. */
const idDa = (s: string) => (/^[1-9]\d{0,15}$/.test(s) ? Number(s) : null);

const algumCampo = (o: object) => Object.values(o).some((v) => v !== undefined);

const texto = (campo: string, max: number) =>
  z
    .string({ error: `${campo} precisa ser texto.` })
    .trim()
    .min(1, `${campo} não pode ficar vazio.`)
    .max(max, `${campo} passa de ${max.toLocaleString("pt-BR")} caracteres.`);

const Modelo = z.string({ error: "O modelo precisa ser texto." }).transform((id, ctx): ModelId => {
  const problema = problemaDoModelo(id);
  if (problema === null && ehModelId(id)) return id;
  ctx.addIssue({ code: "custom", message: problema ?? `Modelo desconhecido: ${id}.` });
  return z.NEVER;
});

/** PUT /api/bots/:id/config. Só os campos mandados mudam. */
const EdicaoBot = z
  .object(
    { nome: texto("O nome", 40).optional(), descricao: texto("A descrição", 300).optional(), modelo: Modelo.optional(), prompt: texto("O prompt", 20_000).optional() },
    { error: "Mande um objeto JSON." },
  )
  .refine(algumCampo, "Mande ao menos um campo para mudar.");

/** PATCH /api/conversas/:id */
const EdicaoConversa = z
  .object(
    { titulo: texto("O título", 120).optional(), arquivada: z.boolean({ error: "arquivada precisa ser true ou false." }).optional() },
    { error: "Mande um objeto JSON." },
  )
  .refine(algumCampo, "Mande titulo ou arquivada.");

/** POST /api/conversas/:id/mensagens/restaurar: o corpo é a resposta do DELETE da mensagem. */
const Remocao = z.object(
  {
    removidas: z.array(z.unknown(), { error: "removidas precisa ser uma lista." }).min(1, "Mande ao menos uma mensagem."),
    depoisDe: z.string({ error: "depoisDe precisa ser texto ou null." }).nullable(),
    antesDe: z.string({ error: "antesDe precisa ser texto ou null." }).nullable(),
  },
  { error: "Mande um objeto JSON." },
);

const Pagina = z.object({
  offset: z.coerce.number({ error: "offset precisa ser um número." }).int("offset precisa ser inteiro.").min(0, "offset não pode ser negativo.").default(0),
  limite: z.coerce.number({ error: "limite precisa ser um número." }).int("limite precisa ser inteiro.").min(1, "limite mínimo é 1.").max(100, "limite máximo é 100.").default(30),
});

const dia = (campo: string) =>
  z.string({ error: `${campo} precisa ser uma data AAAA-MM-DD.` }).transform((s, ctx): Dia => {
    if (ehDia(s)) return s;
    ctx.addIssue({ code: "custom", message: `${campo} não é uma data válida (AAAA-MM-DD).` });
    return z.NEVER;
  });

/** GET /api/calendario?de=AAAA-MM-DD&ate=AAAA-MM-DD */
const Janela = z
  .object({ de: dia("de"), ate: dia("ate") })
  .refine(({ de, ate }) => de <= ate, "de precisa vir antes de ate.")
  .refine(({ de, ate }) => diasNaJanela(de, ate) <= JANELA_MAXIMA, `A janela passa de ${JANELA_MAXIMA} dias.`);

const CamposPauta = {
  dia: dia("A data"),
  hora: z
    .string({ error: "A hora precisa ser texto HH:MM ou null." })
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida. Use HH:MM, de 00:00 a 23:59.")
    .nullable(),
  titulo: texto("O título", 200),
  pilar: z.enum(PILARES, { error: "Pilar inválido. Use PROVA, AUTORIDADE, GENTE, MARCA ou null." }).nullable(),
  nota: z.string({ error: "A nota precisa ser texto." }).trim().max(5000, "A nota passa de 5.000 caracteres."),
};

/** POST /api/pautas */
const NovaPauta = z.object(
  { ...CamposPauta, hora: CamposPauta.hora.default(null), pilar: CamposPauta.pilar.default(null), nota: CamposPauta.nota.default("") },
  { error: "Mande um objeto JSON." },
);

/** PATCH /api/pautas/:id. Só os campos mandados mudam. */
const EdicaoPauta = z
  .object(
    {
      dia: CamposPauta.dia.optional(),
      hora: CamposPauta.hora.optional(),
      titulo: CamposPauta.titulo.optional(),
      pilar: CamposPauta.pilar.optional(),
      nota: CamposPauta.nota.optional(),
    },
    { error: "Mande um objeto JSON." },
  )
  .refine(algumCampo, "Mande ao menos um campo para mudar.");

const PublicaEm = z.number({ error: "publicaEm precisa ser um número em epoch ms." }).int("publicaEm precisa ser inteiro, em epoch ms.");

/** POST /api/fila */
const NovoAgendamento = z.object(
  {
    postId: z.number({ error: "postId precisa ser um número." }).int("postId precisa ser inteiro."),
    midia: z.enum(["IMAGE", "STORIES"], { error: "midia precisa ser IMAGE ou STORIES." }),
    publicaEm: PublicaEm,
  },
  { error: "Mande um objeto JSON." },
);

/** PATCH /api/fila/:id */
const Reagendamento = z.object({ publicaEm: PublicaEm }, { error: "Mande um objeto JSON." });

const BOT_IDS = Object.keys(BOTS) as BotId[];

export function rotas(opcoes: OpcoesChat = {}) {
  return {
    ...marca,
    "/health": () => Response.json({ ok: true, ts: new Date().toISOString() }),

    "/api/auth/*": (req: Request) => auth.handler(req),

    "/api/modelos": { GET: comSessao(() => Response.json(modelos())) },
    "/api/bots": { GET: comSessao(() => Response.json(BOT_IDS.map(configDoBot))) },
    "/api/bots/:id/config": {
      GET: doBot<"/api/bots/:id/config">((_, __, botId) => Response.json(detalheDoBot(botId))),
      PUT: doBot<"/api/bots/:id/config">(async (req, u, botId) => {
        const corpo = await lerCorpo(req, EdicaoBot);
        return "resposta" in corpo ? corpo.resposta : Response.json(gravarVersao(botId, corpo.dados, u.email));
      }),
    },
    "/api/bots/:id/versoes": { GET: doBot<"/api/bots/:id/versoes">((_, __, botId) => Response.json(versoesDoBot(botId))) },
    "/api/bots/:id/versoes/:versao/restaurar": {
      POST: doBot<"/api/bots/:id/versoes/:versao/restaurar">((req, u, botId) => {
        const versao = versaoDoBot(botId, Number(req.params.versao));
        if (!versao) return naoEncontrado();
        const problema = problemaDoModelo(versao.modelo);
        return problema ? invalido(problema) : Response.json(restaurarVersao(versao, u.email));
      }),
    },
    "/api/bots/:id/padrao": { POST: doBot<"/api/bots/:id/padrao">((_, u, botId) => Response.json(restaurarPadrao(botId, u.email))) },
    "/api/bots/:id/tarefas": {
      GET: doBot<"/api/bots/:id/tarefas">((req, u, botId) => {
        const pagina = Pagina.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!pagina.success) return invalido(pagina.error.issues[0]?.message ?? "Página inválida.");
        return Response.json(trabalhoDoBot(u.id, botId, pagina.data.offset, pagina.data.limite));
      }),
    },
    "/api/chat": { POST: comSessao(rotaDeChat(opcoes)) },
    "/api/conversas": {
      GET: comSessao((req, u) => Response.json(conversasDoUsuario(u.id, new URL(req.url).searchParams.get("arquivadas") === "1"))),
    },
    "/api/conversas/:id": {
      GET: comSessao<"/api/conversas/:id">((req, u) => {
        const conversa = conversaDoUsuario(u.id, req.params.id);
        return conversa ? Response.json({ conversa, mensagens: mensagensDaConversa(conversa.id) }) : naoEncontrado();
      }),
      PATCH: comSessao<"/api/conversas/:id">(async (req, u) => {
        const corpo = await lerCorpo(req, EdicaoConversa);
        if ("resposta" in corpo) return corpo.resposta;
        const conversa = mudarConversa(u.id, req.params.id, corpo.dados);
        return conversa ? Response.json(conversa) : naoEncontrado();
      }),
      DELETE: comSessao<"/api/conversas/:id">((req, u) => (apagarConversa(u.id, req.params.id) ? new Response(null, { status: 204 }) : naoEncontrado())),
    },
    "/api/conversas/:id/restaurar": {
      POST: comSessao<"/api/conversas/:id/restaurar">((req, u) => {
        const conversa = restaurarConversa(u.id, req.params.id);
        return conversa ? Response.json(conversa) : naoEncontrado();
      }),
    },
    "/api/conversas/:id/mensagens/:mensagemId": {
      DELETE: comSessao<"/api/conversas/:id/mensagens/:mensagemId">((req, u) => {
        const r = apagarMensagem(u.id, req.params.id, req.params.mensagemId);
        return r.ok ? Response.json({ removidas: r.removidas, depoisDe: r.depoisDe, antesDe: r.antesDe }) : recusar(r);
      }),
    },
    "/api/conversas/:id/mensagens/restaurar": {
      POST: comSessao<"/api/conversas/:id/mensagens/restaurar">(async (req, u) => {
        const corpo = await lerCorpo(req, Remocao);
        if ("resposta" in corpo) return corpo.resposta;
        const removidas = await safeValidateUIMessages({ messages: corpo.dados.removidas });
        if (!removidas.success) return invalido("As mensagens mandadas não são válidas.");
        const r = restaurarMensagens(u.id, req.params.id, { ...corpo.dados, removidas: removidas.data });
        return r.ok ? Response.json({ mensagens: r.mensagens }) : recusar(r);
      }),
    },
    "/api/conversas/:id/tarefas": {
      GET: comSessao<"/api/conversas/:id/tarefas">((req, u) =>
        conversaDoUsuario(u.id, req.params.id) ? Response.json(tarefasDaConversa(req.params.id)) : naoEncontrado(),
      ),
    },
    "/api/tarefas/:id": {
      GET: comSessao<"/api/tarefas/:id">((req, u) => {
        const tarefa = pegarTarefa(req.params.id);
        return tarefa && conversaDoUsuario(u.id, tarefa.conversaId) ? Response.json(tarefa) : naoEncontrado();
      }),
    },
    "/api/atividade": { GET: comSessao((_, u) => Response.json(tarefasAtivas(u.id))) },
    "/api/atividade/agora": {
      GET: comSessao((_, u) => {
        const hoje = inicioDoDia();
        const agora: Agora = {
          trabalhando: tarefasEmCurso(u.id),
          esperando: aprovacoesPendentes(u.id),
          concluidas: tarefasFeitas(u.id, hoje, Number.MAX_SAFE_INTEGER),
        };
        return Response.json(agora);
      }),
    },
    "/api/atividade/agendado": { GET: comSessao(() => Response.json(agendamentos())) },
    "/api/atividade/historico": {
      GET: comSessao((_, u) => {
        const historico: Historico = { tarefas: tarefasFeitas(u.id, 0, inicioDoDia()), publicacoes: publicacoesRecentes() };
        return Response.json(historico);
      }),
    },
    "/api/pecas": { GET: comSessao((_, u) => Response.json(pecasDoUsuario(u.id))) },
    "/api/calendario": {
      GET: comSessao((req, u) => {
        const janela = Janela.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!janela.success) return invalido(janela.error.issues[0]?.message ?? "Janela inválida.");
        return Response.json(itensDoCalendario(u.id, janela.data.de, janela.data.ate));
      }),
    },
    "/api/pautas": {
      POST: comSessao(async (req, u) => {
        const corpo = await lerCorpo(req, NovaPauta);
        return "resposta" in corpo ? corpo.resposta : Response.json(criarPauta(u.id, corpo.dados), { status: 201 });
      }),
    },
    "/api/pautas/:id": {
      PATCH: comSessao<"/api/pautas/:id">(async (req, u) => {
        const id = idDa(req.params.id);
        if (id === null) return naoEncontrado();
        const corpo = await lerCorpo(req, EdicaoPauta);
        if ("resposta" in corpo) return corpo.resposta;
        const pauta = mudarPauta(u.id, id, corpo.dados);
        return pauta ? Response.json(pauta) : naoEncontrado();
      }),
      DELETE: comSessao<"/api/pautas/:id">((req) => {
        const id = idDa(req.params.id);
        return id !== null && apagarPauta(id) ? new Response(null, { status: 204 }) : naoEncontrado();
      }),
    },
    "/api/pautas/:id/restaurar": {
      POST: comSessao<"/api/pautas/:id/restaurar">((req, u) => {
        const id = idDa(req.params.id);
        const pauta = id === null ? null : restaurarPauta(u.id, id);
        return pauta ? Response.json(pauta) : naoEncontrado();
      }),
    },
    "/api/pautas/:id/conversa": {
      POST: comSessao<"/api/pautas/:id/conversa">((req, u) => {
        const id = idDa(req.params.id);
        const conversa = id === null ? null : conversaDaPauta(u.id, id);
        return conversa ? Response.json(conversa) : naoEncontrado();
      }),
    },
    "/api/posts/prontos": { GET: comSessao(() => Response.json(postsProntos())) },
    "/api/fila": {
      POST: comSessao(async (req) => {
        const corpo = await lerCorpo(req, NovoAgendamento);
        if ("resposta" in corpo) return corpo.resposta;
        const { postId, midia, publicaEm } = corpo.dados;
        const post = postPorId(postId);
        if (!post) return Response.json({ erro: "Post não encontrado." }, { status: 404 });
        const r = agendar(post, midia, publicaEm);
        return r.ok ? Response.json(agendadoPorId(r.filaId), { status: 201 }) : recusarNaFila(r);
      }),
    },
    "/api/fila/:id": {
      PATCH: comSessao<"/api/fila/:id">(async (req) => {
        const id = idDa(req.params.id);
        if (id === null) return naoEncontrado();
        const corpo = await lerCorpo(req, Reagendamento);
        if ("resposta" in corpo) return corpo.resposta;
        const r = reagendar(id, corpo.dados.publicaEm);
        return r.ok ? Response.json({ item: r.item, anterior: r.anterior }) : recusarNaFila(r);
      }),
      DELETE: comSessao<"/api/fila/:id">((req) => {
        const id = idDa(req.params.id);
        if (id === null) return naoEncontrado();
        const r = cancelar(id);
        return r.ok ? new Response(null, { status: 204 }) : recusarNaFila(r);
      }),
    },
    "/api/fila/:id/restaurar": {
      POST: comSessao<"/api/fila/:id/restaurar">((req) => {
        const id = idDa(req.params.id);
        if (id === null) return naoEncontrado();
        const r = restaurar(id);
        return r.ok ? Response.json(r.item) : recusarNaFila(r);
      }),
    },
    "/api/*": naoEncontrado,

    // Público de propósito: a Meta baixa a imagem por esta URL na hora de publicar, sem sessão.
    // O id é aleatório de 128 bits e expira depois da publicação.
    "/media/:id": async (req: BunRequest<"/media/:id">) => {
      const row = db.query("SELECT path, expired FROM media WHERE id = ?").get(req.params.id) as { path: string; expired: number } | null;
      const arquivo = row && !row.expired ? Bun.file(row.path) : null;
      if (!arquivo || !(await arquivo.exists())) return naoEncontrado();
      return new Response(arquivo, { headers: { "content-type": "image/jpeg" } });
    },
  };
}
