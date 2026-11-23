import { readdirSync } from "node:fs";
import { safeValidateUIMessages } from "ai";
import type { BunRequest } from "bun";
import { z } from "zod";
import type { BotId } from "../agent/bots";
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
import {
  botsParaDelegar,
  detalheDoBot,
  gravarMemoria,
  instrucoesDe,
  LIMITE_DA_MEMORIA,
  listarBots,
  restaurarPadrao,
  restaurarVersao,
  situacaoDoBot,
  versaoDoBot,
  versoesDoBot,
} from "../agent/config";
import { apagarBot, criarBot, EdicaoBot, editarBot, NovoBot, restaurarBot, type Resultado } from "../agent/equipe";
import {
  apagarConversa,
  apagarMensagem,
  conversaVisivel,
  conversasDaEquipe,
  conversasDoUsuario,
  mensagensDaConversa,
  mudarConversa,
  pararTurno,
  restaurarConversa,
  restaurarMensagens,
  type Recusa,
} from "../agent/conversas";
import { agendar, cancelar, prontos, reagendar, restaurar, type EstudioDaFila, type RecusaDaFila } from "../agent/fila";
import { modelos, problemaDoModelo } from "../agent/models";
import { pegarTarefa, tarefasAtivas, tarefasDaConversa, trabalhoDoBot } from "../agent/tarefas";
import { ehUrl, lerArquivo } from "../armazem";
import {
  agendamentos,
  aprovacoesPendentes,
  idDaImagem,
  imagemGerada,
  inicioDoDia,
  primeira,
  pecasDoUsuario,
  publicacoesRecentes,
  tarefasEmCurso,
  tarefasFeitas,
  urlDaMidia,
  type Agora,
  type Historico,
} from "../db";
import { PILARES } from "../domain/art/pipeline";
import { apagarData, criarData, dataPorId, diaExiste, mudarData, restaurarData, TESTES } from "../domain/scheduler/calendar";
import { conectarChave, desconectarChave, ehProvedor, estadosDasChaves } from "../domain/chaves";
import { informar, NovoMovimento, removerMovimento, saldo } from "../domain/saldo";
import { resumoDoUso } from "../domain/uso";
import { concluirLogin, urlDeLogin } from "../domain/instagram/meta-login";
import { arteDaImagem, listarArtes, pedidoDaImagem, resumoDaArte, resumosDasArtes } from "../v2/artes";
import { imagensDaBiblioteca } from "../domain/biblioteca";
import { postPorId } from "../agent/post";
import { ajustarArteDoPost, voltarArteDoPost } from "../agent/ajuste";
import { q } from "../v2/banco";
import { auth, usuarioDa, type Usuario } from "./auth";
import { rotaDeChat, type OpcoesChat } from "./chat";

/** Ícones, logos e fontes de brand/assets (espelho da pasta oficial; `bun run assets`). Lidos no boot, servidos da memória. */
const marca = Object.fromEntries([
  ...readdirSync("brand/assets/web").map((nome) => [`/${nome}`, Bun.file(`brand/assets/web/${nome}`)] as const),
  ...readdirSync("brand/assets/logo")
    .filter((nome) => nome.endsWith(".svg"))
    .map((nome) => [`/logo/${nome}`, Bun.file(`brand/assets/logo/${nome}`)] as const),
  ...readdirSync("brand/assets/fonts")
    .filter((nome) => nome.endsWith(".ttf"))
    .map((nome) => [`/fontes/${nome}`, Bun.file(`brand/assets/fonts/${nome}`)] as const),
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

/** Uma rota de /api/bots/:id. Bot desconhecido ou apagado dá 404 antes de chegar à rota. */
function doBot<P extends `/api/bots/:id${string}`>(rota: (req: BunRequest<P>, usuario: Usuario, botId: BotId) => Response | Promise<Response>) {
  return comSessao<P>(async (req, usuario) => {
    const { id } = req.params as Record<string, string>;
    return id !== undefined && (await situacaoDoBot(id)) === "ativo" ? rota(req, usuario, id) : naoEncontrado();
  });
}

/** O corpo validado, ou a resposta 400 com a primeira mensagem do schema, já em português. */
async function lerCorpo<S extends z.ZodType>(req: Request, schema: S): Promise<{ dados: z.output<S> } | { resposta: Response }> {
  const r = await schema.safeParseAsync(await req.json().catch(() => null));
  return r.success ? { dados: r.data } : { resposta: invalido(r.error.issues[0]?.message ?? "Pedido inválido.") };
}

const recusar = ({ status, erro }: Recusa) => Response.json({ erro }, { status });
const recusarNaFila = ({ status, motivo }: RecusaDaFila) => Response.json({ erro: motivo }, { status });

/** O :id numérico da rota; qualquer outra coisa é um id que não existe. */
const idDa = (s: string) => (/^[1-9]\d{0,15}$/.test(s) ? Number(s) : null);

const algumCampo = (o: object) => Object.values(o).some((v) => v !== undefined);

const responder = (r: Resultado) => (r.ok ? Response.json(r.bot) : Response.json({ erro: r.erro }, { status: r.status }));

const texto = (campo: string, max: number) =>
  z
    .string({ error: `${campo} precisa ser texto.` })
    .trim()
    .min(1, `${campo} não pode ficar vazio.`)
    .max(max, `${campo} passa de ${max.toLocaleString("pt-BR")} caracteres.`);

/** PUT /api/bots/:id/memoria. Vazio limpa a memória. */
const NovaMemoria = z.object(
  {
    texto: z
      .string({ error: "A memória precisa ser texto." })
      .trim()
      .max(LIMITE_DA_MEMORIA, `A memória passa de ${LIMITE_DA_MEMORIA.toLocaleString("pt-BR")} caracteres.`),
  },
  { error: "Mande um objeto JSON." },
);

/** O lugar do estado do post em GET /api/bots/:id/prompt, que não tem conversa. */
const ESTADO_DO_POST_DE_EXEMPLO = "(Aqui entra o estado do post da conversa, que muda a cada turno.)";

/** PATCH /api/conversas/:id */
const EdicaoConversa = z
  .object(
    { titulo: texto("O título", 120).optional(), arquivada: z.boolean({ error: "arquivada precisa ser true ou false." }).optional() },
    { error: "Mande um objeto JSON." },
  )
  .refine(algumCampo, "Mande titulo ou arquivada.");

const idDeBot = z.string().min(1).max(40);

/** POST /api/conversas/:id/restaurar: o corpo é a resposta do DELETE da conversa. */
const Excluida = z.object({
  conversa: z.object({
    id: z.string().min(1).max(100),
    botId: idDeBot,
    titulo: z.string().max(200).nullable(),
    postId: z.number().int().nullable(),
    // Uma string que não é lista JSON deixaria a conversa dando erro 500 para sempre ao abrir.
    mensagens: z.string().refine((t) => {
      try {
        return Array.isArray(JSON.parse(t));
      } catch {
        return false;
      }
    }, "As mensagens da conversa vieram corrompidas."),
    criadaEm: z.string(),
    atualizadaEm: z.string(),
    arquivadaEm: z.number().nullable(),
  }),
  tarefas: z.array(
    z.object({
      id: z.string().min(1).max(100),
      botId: idDeBot,
      pedido: z.string(),
      status: z.enum(["na_fila", "trabalhando", "concluida", "falhou"]),
      mensagens: z.string(),
      resumo: z.string().nullable(),
      erro: z.string().nullable(),
      criadaEm: z.number(),
      atualizadaEm: z.number(),
    }),
  ),
});

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

const CamposData = {
  nome: texto("O nome", 120),
  teste: z.enum(TESTES, { error: "teste inválido. Use setor, regiao ou empresa." }),
  porque: z.string({ error: "O porquê precisa ser texto." }).trim().max(500, "O porquê passa de 500 caracteres."),
  ano: z.number({ error: "ano precisa ser um número ou null." }).int("ano precisa ser inteiro.").min(2000, "ano fora do intervalo.").max(2200, "ano fora do intervalo.").nullable(),
};

const DIA_INEXISTENTE = "Esse dia não existe no calendário.";

/** POST /api/datas. Sem ano, a data repete todo ano. */
const NovaData = z
  .object(
    {
      mmdd: z.string({ error: "mmdd precisa ser texto MM-DD." }).regex(/^\d{2}-\d{2}$/, "mmdd precisa ser MM-DD."),
      ...CamposData,
      ano: CamposData.ano.default(null),
      teste: CamposData.teste.default("empresa"),
      porque: CamposData.porque.default(""),
    },
    { error: "Mande um objeto JSON." },
  )
  .refine((d) => diaExiste(d.mmdd, d.ano), DIA_INEXISTENTE);

/** PATCH /api/datas/:id. Só os campos mandados mudam; o dia não muda. */
const EdicaoData = z
  .object(
    { nome: CamposData.nome.optional(), teste: CamposData.teste.optional(), porque: CamposData.porque.optional(), ano: CamposData.ano.optional() },
    { error: "Mande um objeto JSON." },
  )
  .refine(algumCampo, "Mande ao menos um campo para mudar.");

const PublicaEm = z.number({ error: "publicaEm precisa ser um número em epoch ms." }).int("publicaEm precisa ser inteiro, em epoch ms.");

const FonteDoAgendamento = z.discriminatedUnion(
  "tipo",
  [
    z.object({ tipo: z.literal("post"), postId: z.number({ error: "postId precisa ser um número." }).int("postId precisa ser inteiro.") }),
    z.object({ tipo: z.literal("arte"), arteId: z.uuid({ error: "arteId precisa ser um uuid." }) }),
    z.object({ tipo: z.literal("peca"), pecaId: z.uuid({ error: "pecaId precisa ser um uuid." }) }),
  ],
  { error: 'fonte precisa ser {tipo: "post", postId}, {tipo: "arte", arteId} ou {tipo: "peca", pecaId}.' },
);

/** POST /api/posts/:id/ajuste: o mesmo pedido que a tool ajustar_arte recebe. */
const PedidoDeAjuste = z.discriminatedUnion(
  "tipo",
  [
    z.object({ tipo: z.literal("texto"), atual: texto("O texto atual", 400), novo: texto("O texto novo", 400) }),
    z.object({ tipo: z.literal("objeto"), objeto: texto("O objeto", 300), mudanca: texto("A mudança", 500) }),
  ],
  { error: "O ajuste é de texto (atual e novo) ou de objeto (objeto e mudanca)." },
);

/** A recusa do fluxo do post vira 409: o post existe, mas não está num ponto que aceita o pedido. */
const doAjuste = (r: Awaited<ReturnType<typeof voltarArteDoPost>>) => (r.ok ? Response.json(r) : Response.json({ erro: r.motivo }, { status: 409 }));

/** POST /api/fila. Sem legenda, o feed de um post leva a legenda do post; legenda vazia sai sem. */
const NovoAgendamento = z
  .object(
    {
      fonte: FonteDoAgendamento,
      midia: z.enum(["IMAGE", "STORIES"], { error: "midia precisa ser IMAGE ou STORIES." }),
      publicaEm: PublicaEm,
      legenda: z.string({ error: "A legenda precisa ser texto." }).trim().max(2200, "A legenda passa de 2.200 caracteres, o limite do Instagram.").optional(),
    },
    { error: "Mande um objeto JSON." },
  )
  .refine((a) => a.midia === "IMAGE" || a.legenda === undefined, "Stories não levam legenda.");

/** PATCH /api/fila/:id */
const Reagendamento = z.object({ publicaEm: PublicaEm }, { error: "Mande um objeto JSON." });

export interface OpcoesDasRotas extends OpcoesChat {
  /** O estúdio de src/v2: as artes que a fila agenda e que o calendário mostra. */
  estudio: EstudioDaFila;
}

export function rotas({ estudio, ...opcoes }: OpcoesDasRotas) {
  const lerArtes = (ids: readonly string[]) => resumosDasArtes(estudio.banco, ids);

  async function abrirImagemNoEditor(imagemId: number, criadaPor: string) {
    const imagem = await imagemGerada(imagemId);
    if (!imagem) return null;
    return arteDaImagem(estudio, {
      pedido: pedidoDaImagem(imagem),
      promptDaCena: [imagem.tema, imagem.angulo].filter(Boolean).join(". "),
      formato: imagem.formato === "stories" ? "story" : "feed",
      criadaPor,
      bytes: async () => {
        const bytes = await lerArquivo(imagem.path);
        if (!bytes) throw new Error(`A imagem ${imagem.path} sumiu do armazenamento.`);
        return bytes;
      },
    });
  }
  return {
    ...marca,
    "/health": () => Response.json({ ok: true, ts: new Date().toISOString() }),

    "/api/auth/*": (req: Request) => auth.handler(req),

    "/api/modelos": { GET: comSessao(async () => Response.json(await modelos())) },
    "/api/bots": {
      GET: comSessao(async () => Response.json(await listarBots())),
      POST: comSessao(async (req, u) => {
        const corpo = await lerCorpo(req, NovoBot);
        return "resposta" in corpo ? corpo.resposta : Response.json(await criarBot(corpo.dados, u.email), { status: 201 });
      }),
    },
    "/api/bots/:id": {
      DELETE: comSessao<"/api/bots/:id">(async (req) => {
        const r = await apagarBot(req.params.id);
        return r.ok ? new Response(null, { status: 204 }) : responder(r);
      }),
    },
    "/api/bots/:id/restaurar": { POST: comSessao<"/api/bots/:id/restaurar">(async (req) => responder(await restaurarBot(req.params.id))) },
    "/api/bots/:id/config": {
      GET: doBot<"/api/bots/:id/config">(async (_, __, botId) => Response.json(await detalheDoBot(botId))),
      PUT: comSessao<"/api/bots/:id/config">(async (req, u) => {
        const corpo = await lerCorpo(req, EdicaoBot);
        return "resposta" in corpo ? corpo.resposta : responder(await editarBot(req.params.id, corpo.dados, u.email));
      }),
    },
    "/api/bots/:id/prompt": {
      GET: doBot<"/api/bots/:id/prompt">(async (_, __, botId) => {
        const bot = await detalheDoBot(botId);
        return Response.json({ texto: instrucoesDe(bot, { delegada: false, estadoDoPost: ESTADO_DO_POST_DE_EXEMPLO, equipe: await botsParaDelegar(bot) }) });
      }),
    },
    "/api/bots/:id/memoria": {
      PUT: doBot<"/api/bots/:id/memoria">(async (req, u, botId) => {
        const corpo = await lerCorpo(req, NovaMemoria);
        return "resposta" in corpo ? corpo.resposta : Response.json(await gravarMemoria(botId, corpo.dados.texto, u.email));
      }),
    },
    "/api/bots/:id/versoes": { GET: doBot<"/api/bots/:id/versoes">(async (_, __, botId) => Response.json(await versoesDoBot(botId))) },
    "/api/bots/:id/versoes/:versao/restaurar": {
      POST: doBot<"/api/bots/:id/versoes/:versao/restaurar">(async (req, u, botId) => {
        const versao = await versaoDoBot(botId, Number(req.params.versao));
        if (!versao) return naoEncontrado();
        const problema = await problemaDoModelo(versao.modelo);
        return problema ? invalido(problema) : Response.json(await restaurarVersao(versao, u.email));
      }),
    },
    "/api/bots/:id/padrao": { POST: doBot<"/api/bots/:id/padrao">(async (_, u, botId) => Response.json(await restaurarPadrao(botId, u.email))) },
    "/api/bots/:id/tarefas": {
      GET: doBot<"/api/bots/:id/tarefas">(async (req, u, botId) => {
        const pagina = Pagina.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!pagina.success) return invalido(pagina.error.issues[0]?.message ?? "Página inválida.");
        return Response.json(await trabalhoDoBot(u.id, botId, pagina.data.offset, pagina.data.limite));
      }),
    },
    "/api/chat": { POST: comSessao(rotaDeChat(opcoes)) },
    "/api/conversas": {
      GET: comSessao(async (req, u) => Response.json(await conversasDoUsuario(u.id, new URL(req.url).searchParams.get("arquivadas") === "1"))),
    },
    "/api/conversas/equipe": {
      GET: comSessao(async (_req, u) =>
        u.admin ? Response.json(await conversasDaEquipe(u.id)) : Response.json({ erro: "Só admins veem as conversas da equipe." }, { status: 403 }),
      ),
    },
    "/api/conversas/:id": {
      GET: comSessao<"/api/conversas/:id">(async (req, u) => {
        const visivel = await conversaVisivel(u, req.params.id);
        return visivel ? Response.json({ ...visivel, mensagens: await mensagensDaConversa(visivel.conversa.id) }) : naoEncontrado();
      }),
      PATCH: comSessao<"/api/conversas/:id">(async (req, u) => {
        const corpo = await lerCorpo(req, EdicaoConversa);
        if ("resposta" in corpo) return corpo.resposta;
        const conversa = await mudarConversa(u.id, req.params.id, corpo.dados);
        return conversa ? Response.json(conversa) : naoEncontrado();
      }),
      DELETE: comSessao<"/api/conversas/:id">(async (req, u) => {
        const excluida = await apagarConversa(u.id, req.params.id);
        return excluida ? Response.json(excluida) : naoEncontrado();
      }),
    },
    "/api/conversas/:id/parar": {
      POST: comSessao<"/api/conversas/:id/parar">(async (req, u) =>
        (await pararTurno(u, req.params.id)) ? new Response(null, { status: 204 }) : naoEncontrado(),
      ),
    },
    "/api/conversas/:id/restaurar": {
      POST: comSessao<"/api/conversas/:id/restaurar">(async (req, u) => {
        const corpo = await lerCorpo(req, Excluida);
        if ("resposta" in corpo) return corpo.resposta;
        if (corpo.dados.conversa.id !== req.params.id) return invalido("O corpo é de outra conversa.");
        const conversa = await restaurarConversa(u.id, corpo.dados);
        return conversa ? Response.json(conversa) : naoEncontrado();
      }),
    },
    "/api/conversas/:id/mensagens/:mensagemId": {
      DELETE: comSessao<"/api/conversas/:id/mensagens/:mensagemId">(async (req, u) => {
        const r = await apagarMensagem(u, req.params.id, req.params.mensagemId);
        return r.ok ? Response.json({ removidas: r.removidas, depoisDe: r.depoisDe, antesDe: r.antesDe }) : recusar(r);
      }),
    },
    "/api/conversas/:id/mensagens/restaurar": {
      POST: comSessao<"/api/conversas/:id/mensagens/restaurar">(async (req, u) => {
        const corpo = await lerCorpo(req, Remocao);
        if ("resposta" in corpo) return corpo.resposta;
        const removidas = await safeValidateUIMessages({ messages: corpo.dados.removidas });
        if (!removidas.success) return invalido("As mensagens mandadas não são válidas.");
        const r = await restaurarMensagens(u, req.params.id, { ...corpo.dados, removidas: removidas.data });
        return r.ok ? Response.json({ mensagens: r.mensagens }) : recusar(r);
      }),
    },
    "/api/conversas/:id/tarefas": {
      GET: comSessao<"/api/conversas/:id/tarefas">(async (req, u) =>
        (await conversaVisivel(u, req.params.id)) ? Response.json(await tarefasDaConversa(req.params.id)) : naoEncontrado(),
      ),
    },
    "/api/tarefas/:id": {
      GET: comSessao<"/api/tarefas/:id">(async (req, u) => {
        const tarefa = await pegarTarefa(req.params.id);
        return tarefa && (await conversaVisivel(u, tarefa.conversaId)) ? Response.json(tarefa) : naoEncontrado();
      }),
    },
    "/api/atividade": { GET: comSessao(async (_, u) => Response.json(await tarefasAtivas(u.id))) },
    "/api/uso": { GET: comSessao(async () => Response.json(await resumoDoUso())) },
    "/api/saldo": {
      GET: comSessao(async () => Response.json(await saldo())),
      POST: comSessao(async (req, u) => {
        const corpo = await lerCorpo(req, NovoMovimento);
        return "resposta" in corpo ? corpo.resposta : Response.json(await informar(corpo.dados, u.email), { status: 201 });
      }),
    },
    "/api/saldo/:id": {
      DELETE: comSessao<"/api/saldo/:id">(async (req) => ((await removerMovimento(req.params.id, true)) ? new Response(null, { status: 204 }) : naoEncontrado())),
    },
    "/api/saldo/:id/restaurar": {
      POST: comSessao<"/api/saldo/:id/restaurar">(async (req) => ((await removerMovimento(req.params.id, false)) ? new Response(null, { status: 204 }) : naoEncontrado())),
    },
    "/api/chaves": { GET: comSessao(async () => Response.json(await estadosDasChaves())) },
    "/api/chaves/:provedor": {
      PUT: comSessao<"/api/chaves/:provedor">(async (req, u) => {
        const p = req.params.provedor;
        if (!ehProvedor(p)) return naoEncontrado();
        const corpo = await lerCorpo(req, z.object({ chave: texto("A chave", 400) }));
        if ("resposta" in corpo) return corpo.resposta;
        const r = await conectarChave(p, corpo.dados.chave, { nome: u.nome, email: u.email });
        return "motivo" in r ? invalido(r.motivo) : Response.json(r);
      }),
      DELETE: comSessao<"/api/chaves/:provedor">(async (req) => {
        const p = req.params.provedor;
        return ehProvedor(p) ? Response.json(await desconectarChave(p)) : naoEncontrado();
      }),
    },
    "/api/atividade/agora": {
      GET: comSessao(async (_, u) => {
        const hoje = inicioDoDia();
        const agora: Agora = {
          trabalhando: await tarefasEmCurso(u.id),
          esperando: await aprovacoesPendentes(u.id),
          concluidas: await tarefasFeitas(u.id, hoje, Number.MAX_SAFE_INTEGER),
        };
        return Response.json(agora);
      }),
    },
    "/api/atividade/agendado": { GET: comSessao(async () => Response.json(await agendamentos())) },
    "/api/atividade/historico": {
      GET: comSessao(async (_, u) => {
        const historico: Historico = { tarefas: await tarefasFeitas(u.id, 0, inicioDoDia()), publicacoes: await publicacoesRecentes() };
        return Response.json(historico);
      }),
    },
    "/api/pecas": { GET: comSessao(async (_, u) => Response.json(await pecasDoUsuario(u.id))) },
    "/api/calendario": {
      GET: comSessao(async (req, u) => {
        const janela = Janela.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!janela.success) return invalido(janela.error.issues[0]?.message ?? "Janela inválida.");
        return Response.json(await itensDoCalendario(u.id, janela.data.de, janela.data.ate, lerArtes));
      }),
    },
    "/api/pautas": {
      POST: comSessao(async (req, u) => {
        const corpo = await lerCorpo(req, NovaPauta);
        return "resposta" in corpo ? corpo.resposta : Response.json(await criarPauta(u.id, corpo.dados), { status: 201 });
      }),
    },
    "/api/pautas/:id": {
      PATCH: comSessao<"/api/pautas/:id">(async (req, u) => {
        const id = idDa(req.params.id);
        if (id === null) return naoEncontrado();
        const corpo = await lerCorpo(req, EdicaoPauta);
        if ("resposta" in corpo) return corpo.resposta;
        const pauta = await mudarPauta(u.id, id, corpo.dados);
        return pauta ? Response.json(pauta) : naoEncontrado();
      }),
      DELETE: comSessao<"/api/pautas/:id">(async (req) => {
        const id = idDa(req.params.id);
        return id !== null && (await apagarPauta(id)) ? new Response(null, { status: 204 }) : naoEncontrado();
      }),
    },
    "/api/pautas/:id/restaurar": {
      POST: comSessao<"/api/pautas/:id/restaurar">(async (req, u) => {
        const id = idDa(req.params.id);
        const pauta = id === null ? null : await restaurarPauta(u.id, id);
        return pauta ? Response.json(pauta) : naoEncontrado();
      }),
    },
    "/api/pautas/:id/conversa": {
      POST: comSessao<"/api/pautas/:id/conversa">(async (req, u) => {
        const id = idDa(req.params.id);
        const conversa = id === null ? null : await conversaDaPauta(u.id, id);
        return conversa ? Response.json(conversa) : naoEncontrado();
      }),
    },
    "/api/datas": {
      POST: comSessao(async (req, u) => {
        const corpo = await lerCorpo(req, NovaData);
        return "resposta" in corpo ? corpo.resposta : Response.json(await criarData(u.id, corpo.dados), { status: 201 });
      }),
    },
    "/api/datas/:id": {
      PATCH: comSessao<"/api/datas/:id">(async (req) => {
        const id = idDa(req.params.id);
        if (id === null) return naoEncontrado();
        const atual = await dataPorId(id);
        if (!atual) return naoEncontrado();
        const corpo = await lerCorpo(req, EdicaoData);
        if ("resposta" in corpo) return corpo.resposta;
        if (!diaExiste(atual.mmdd, corpo.dados.ano === undefined ? atual.ano : corpo.dados.ano)) return invalido(DIA_INEXISTENTE);
        const data = await mudarData(id, corpo.dados);
        return data ? Response.json(data) : naoEncontrado();
      }),
      DELETE: comSessao<"/api/datas/:id">(async (req) => {
        const id = idDa(req.params.id);
        return id !== null && (await apagarData(id)) ? new Response(null, { status: 204 }) : naoEncontrado();
      }),
    },
    "/api/datas/:id/restaurar": {
      POST: comSessao<"/api/datas/:id/restaurar">(async (req) => {
        const id = idDa(req.params.id);
        const data = id === null ? null : await restaurarData(id);
        return data ? Response.json(data) : naoEncontrado();
      }),
    },
    "/api/biblioteca": { GET: comSessao(async (_, u) => Response.json(await imagensDaBiblioteca(estudio.banco, u.id))) },
    "/api/imagens/:id/editar": {
      // A imagem abre no editor de camadas como fundo. A mesma imagem reabre a mesma arte, com as edições.
      POST: comSessao<"/api/imagens/:id/editar">(async (req, u) => {
        const id = idDa(req.params.id);
        const aberta = id === null ? null : await abrirImagemNoEditor(id, u.id);
        return aberta ? Response.json({ id: aberta.id }) : naoEncontrado();
      }),
    },
    "/api/posts/:id/variacoes/:variante/editar": {
      // As escolhas de arte antigas da conversa não trazem o id da imagem, só a variante do post.
      POST: comSessao<"/api/posts/:id/variacoes/:variante/editar">(async (req, u) => {
        const id = idDa(req.params.id);
        const variante = idDa(req.params.variante);
        const post = id === null ? null : await postPorId(id);
        if (!post || variante === null || post.etapa === "brief" || post.etapa === "formato" || post.etapa === "headline") return naoEncontrado();
        const arte = (post.etapa === "artes" ? post.artes : post.opcoes).find((a) => a.variant === variante);
        const imagemId = arte ? await idDaImagem(arte.path) : null;
        const aberta = imagemId === null ? null : await abrirImagemNoEditor(imagemId, u.id);
        return aberta ? Response.json({ id: aberta.id }) : naoEncontrado();
      }),
    },
    "/api/posts/:id/escolhida": {
      // A escolha de arte que a conversa desenhou é uma foto de antes da escolha; a tela pergunta aqui qual ficou.
      GET: comSessao<"/api/posts/:id/escolhida">(async (req) => {
        const id = idDa(req.params.id);
        const post = id === null ? null : await postPorId(id);
        if (!post) return naoEncontrado();
        const arte = "peca" in post ? post.peca.arte : null;
        const path = arte?.path ?? null;
        const anteriores = arte && "anteriores" in arte ? (arte.anteriores ?? []) : [];
        return Response.json({
          imagemId: path && (await idDaImagem(path)),
          url: path && (await urlDaMidia(path)),
          versoesAnteriores: anteriores.length,
          // A escolhida e as versões dela antes dos ajustes: a escolha que a conversa desenhou continua marcada depois de um ajuste.
          daEscolhida: await Promise.all([...anteriores.map((a) => a.path), ...(path ? [path] : [])].map(idDaImagem)),
        });
      }),
    },
    "/api/posts/:id/ajuste": {
      POST: comSessao<"/api/posts/:id/ajuste">(async (req) => {
        const id = idDa(req.params.id);
        const post = id === null ? null : await postPorId(id);
        if (!post) return naoEncontrado();
        const corpo = await lerCorpo(req, PedidoDeAjuste);
        return "resposta" in corpo ? corpo.resposta : doAjuste(await ajustarArteDoPost(post, corpo.dados));
      }),
    },
    "/api/posts/:id/voltar": {
      // O botão "Voltar como estava" do cartão do ajuste na conversa.
      POST: comSessao<"/api/posts/:id/voltar">(async (req) => {
        const id = idDa(req.params.id);
        const post = id === null ? null : await postPorId(id);
        return post ? doAjuste(await voltarArteDoPost(post)) : naoEncontrado();
      }),
    },
    "/api/prontos": { GET: comSessao(async () => Response.json(await prontos((await listarArtes(estudio.banco)).map(resumoDaArte), estudio.banco))) },
    "/api/fila": {
      POST: comSessao(async (req) => {
        const corpo = await lerCorpo(req, NovoAgendamento);
        if ("resposta" in corpo) return corpo.resposta;
        const r = await agendar(estudio, corpo.dados);
        return r.ok ? Response.json(await agendadoPorId(r.filaId, lerArtes), { status: 201 }) : recusarNaFila(r);
      }),
    },
    "/api/fila/:id": {
      PATCH: comSessao<"/api/fila/:id">(async (req) => {
        const id = idDa(req.params.id);
        if (id === null) return naoEncontrado();
        const corpo = await lerCorpo(req, Reagendamento);
        if ("resposta" in corpo) return corpo.resposta;
        const r = await reagendar(id, corpo.dados.publicaEm);
        return r.ok ? Response.json({ item: await agendadoPorId(id, lerArtes), anterior: r.anterior }) : recusarNaFila(r);
      }),
      DELETE: comSessao<"/api/fila/:id">(async (req) => {
        const id = idDa(req.params.id);
        if (id === null) return naoEncontrado();
        const r = await cancelar(id);
        return r.ok ? new Response(null, { status: 204 }) : recusarNaFila(r);
      }),
    },
    "/api/fila/:id/restaurar": {
      POST: comSessao<"/api/fila/:id/restaurar">(async (req) => {
        const id = idDa(req.params.id);
        if (id === null) return naoEncontrado();
        const r = await restaurar(id);
        return r.ok ? Response.json(await agendadoPorId(id, lerArtes)) : recusarNaFila(r);
      }),
    },
    "/api/*": naoEncontrado,

    // Login da Meta para publicar no Instagram. Atrás da sessão: quem chega aqui troca o token de publicação.
    "/auth/meta": comSessao((req) => {
      const state = crypto.randomUUID();
      return new Response(null, {
        status: 302,
        headers: {
          location: urlDeLogin(new URL(req.url).origin, state),
          "set-cookie": `meta_state=${state}; HttpOnly; SameSite=Lax; Path=/auth/meta; Max-Age=600`,
        },
      });
    }),
    "/auth/meta/callback": comSessao(async (req) => {
      const url = new URL(req.url);
      const esperado = /(?:^|;\s*)meta_state=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
      if (!esperado || esperado !== url.searchParams.get("state")) return invalido("Login da Meta com state inválido. Comece de novo em /auth/meta.");
      const codigo = url.searchParams.get("code");
      if (!codigo) return invalido(url.searchParams.get("error_description") ?? "A Meta não devolveu o código de login.");
      try {
        const salvas = await concluirLogin(codigo, url.origin);
        return Response.json({ ok: true, pagina: salvas.pagina, igUserId: salvas.igUserId });
      } catch (erro) {
        return Response.json({ erro: erro instanceof Error ? erro.message : String(erro) }, { status: 502 });
      }
    }),

    // Público de propósito: a Meta baixa a imagem por esta URL na hora de publicar, sem sessão.
    // O id é aleatório de 128 bits e expira depois da publicação. Um caminho do Blob vai direto para a URL pública dele.
    "/media/:id": async (req: BunRequest<"/media/:id">) => {
      const row = await primeira(q<{ path: string; expired: number }>`SELECT path, expired FROM media WHERE id = ${req.params.id}`);
      if (row && !row.expired && ehUrl(row.path)) return Response.redirect(row.path, 302);
      const arquivo = row && !row.expired ? Bun.file(row.path) : null;
      if (!arquivo || !(await arquivo.exists())) return naoEncontrado();
      return new Response(arquivo, { headers: { "content-type": "image/jpeg" } });
    },
  };
}
