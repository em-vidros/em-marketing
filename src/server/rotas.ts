import { readdirSync } from "node:fs";
import type { BunRequest } from "bun";
import { z } from "zod";
import { BOTS, ehBotId, type BotId } from "../agent/bots";
import { configDoBot, detalheDoBot, gravarVersao, restaurarPadrao, restaurarVersao, versaoDoBot, versoesDoBot } from "../agent/config";
import {
  apagarConversa,
  conversaDoUsuario,
  conversasDoUsuario,
  mensagensDaConversa,
  mudarConversa,
  restaurarConversa,
} from "../agent/conversas";
import { ehModelId, modelos, problemaDoModelo, type ModelId } from "../agent/models";
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

const Pagina = z.object({
  offset: z.coerce.number({ error: "offset precisa ser um número." }).int("offset precisa ser inteiro.").min(0, "offset não pode ser negativo.").default(0),
  limite: z.coerce.number({ error: "limite precisa ser um número." }).int("limite precisa ser inteiro.").min(1, "limite mínimo é 1.").max(100, "limite máximo é 100.").default(30),
});

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
    "/api/*": naoEncontrado,

    // Público de propósito: a Meta baixa a imagem por esta URL na hora de publicar, sem sessão.
    // O id é aleatório de 128 bits e expira depois da publicação.
    "/media/:id": (req: BunRequest<"/media/:id">) => {
      const row = db.query("SELECT path, expired FROM media WHERE id = ?").get(req.params.id) as { path: string; expired: number } | null;
      if (!row || row.expired) return naoEncontrado();
      return new Response(Bun.file(row.path), { headers: { "content-type": "image/jpeg" } });
    },
  };
}
