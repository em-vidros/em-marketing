import { z } from "zod";
import { q, transacao } from "../v2/banco";
import { ehBotFixo, ehMarketing, FORMAS, SETOR_PADRAO, type BotId } from "./bots";
import { detalheDoBot, gravarVersao, situacaoDoBot, type DetalheBot } from "./config";
import { ehModelId, MODELOS, problemaDoModelo, type ModelId } from "./models";

/**
 * Criar, editar, apagar e restaurar os bots da equipe. As rotas de /api/bots e as tools do Chefe
 * passam pelas mesmas funções e pelos mesmos schemas, então valem as mesmas regras nos dois caminhos.
 */

const texto = (campo: string, max: number) =>
  z
    .string({ error: `${campo} precisa ser texto.` })
    .trim()
    .min(1, `${campo} não pode ficar vazio.`)
    .max(max, `${campo} passa de ${max.toLocaleString("pt-BR")} caracteres.`);

const Modelo = z
  .string({ error: "O modelo precisa ser texto." })
  .describe(`Um destes: ${MODELOS.map((m) => m.id).join(", ")}.`)
  .transform(async (id, ctx): Promise<ModelId> => {
    const problema = await problemaDoModelo(id);
    if (problema === null && ehModelId(id)) return id;
    ctx.addIssue({ code: "custom", message: problema ?? `Modelo desconhecido: ${id}.` });
    return z.NEVER;
  });

const CAMPOS = {
  nome: texto("O nome", 40),
  descricao: texto("A descrição", 300).describe("Uma ou duas frases sobre o que o bot faz. Aparece na barra e entra no prompt dele."),
  setor: texto("O setor", 40).describe(`A área da empresa, como ${SETOR_PADRAO}, RH, Comercial ou Financeiro. Agrupa o bot na barra.`),
  modelo: Modelo,
  prompt: texto("O prompt", 20_000).describe("O papel do bot, escrito para ele, na segunda pessoa."),
  regras: z.string({ error: "As regras precisam ser texto." }).trim().max(20_000, "As regras passam de 20.000 caracteres.").describe("Como ele trabalha e usa as ferramentas."),
  marca: z.boolean({ error: "marca precisa ser true ou false." }).describe("Liga o brandbook de conteúdo no prompt. Só serve a bots que escrevem para a marca."),
};

/**
 * POST /api/bots e a tool criar_bot. Sem `marca`, o brandbook entra só no setor de Marketing:
 * um bot de RH ou do financeiro que lê os capítulos de post passa a responder como quem faz post.
 */
export const NovoBot = z
  .object(
    {
      nome: CAMPOS.nome,
      descricao: CAMPOS.descricao,
      setor: CAMPOS.setor,
      forma: z.enum(FORMAS, { error: `A forma precisa ser uma destas: ${FORMAS.join(", ")}.` }),
      cor: z
        .string({ error: "A cor precisa ser texto." })
        .regex(/^#[0-9a-fA-F]{6}$/, "A cor precisa ser hexadecimal, como #1AAE9F.")
        .describe("Hexadecimal, como #1AAE9F."),
      prompt: CAMPOS.prompt,
      modelo: CAMPOS.modelo,
      regras: CAMPOS.regras.default(""),
      marca: CAMPOS.marca.optional(),
    },
    { error: "Mande um objeto JSON." },
  )
  .transform(({ marca, ...novo }) => ({ ...novo, marca: marca ?? ehMarketing(novo.setor) }));

export type NovoBot = z.output<typeof NovoBot>;
/** O corpo que o front manda em POST /api/bots. */
export type PedidoDeNovoBot = z.input<typeof NovoBot>;

/** PUT /api/bots/:id/config e a tool editar_bot. Só os campos mandados mudam. */
export const EdicaoBot = z
  .object(
    {
      nome: CAMPOS.nome.optional(),
      descricao: CAMPOS.descricao.optional(),
      setor: CAMPOS.setor.optional(),
      modelo: CAMPOS.modelo.optional(),
      prompt: CAMPOS.prompt.optional(),
      regras: CAMPOS.regras.optional(),
      marca: CAMPOS.marca.optional(),
    },
    { error: "Mande um objeto JSON." },
  )
  .refine((o) => Object.values(o).some((v) => v !== undefined), "Mande ao menos um campo para mudar.");

export type EdicaoBot = z.output<typeof EdicaoBot>;

export interface Recusa {
  status: 400 | 404;
  erro: string;
}

export type Resultado = { ok: true; bot: DetalheBot } | ({ ok: false } & Recusa);

const NAO_ENCONTRADO = { ok: false, status: 404, erro: "Bot não encontrado." } as const;

/** Cria o bot e a primeira versão dele, que passa a ser o padrão. */
export async function criarBot(novo: NovoBot, autor: string): Promise<DetalheBot> {
  const id = `b-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const agora = Date.now();
  await transacao(async () => {
    await q`INSERT INTO bots (id, forma, cor, criado_por, criado_em) VALUES (${id}, ${novo.forma}, ${novo.cor}, ${autor}, ${agora})`;
    await q`INSERT INTO versoes_bot (bot_id, nome, descricao, modelo, prompt, setor, regras, marca, tools, criada_em, autor)
      VALUES (${id}, ${novo.nome}, ${novo.descricao}, ${novo.modelo}, ${novo.prompt}, ${novo.setor}, ${novo.regras}, ${novo.marca},
        ${null}, ${agora}, ${autor})`;
  });
  return detalheDoBot(id);
}

/** Fixo ou criado, desde que não esteja apagado. Grava uma versão nova, como a tela de configuração. */
export async function editarBot(botId: BotId, mudanca: EdicaoBot, autor: string): Promise<Resultado> {
  if ((await situacaoDoBot(botId)) !== "ativo") return NAO_ENCONTRADO;
  return { ok: true, bot: await gravarVersao(botId, mudanca, autor) };
}

/** Apagar e restaurar valem só para os criados, e restaurar acha o bot mesmo apagado. */
async function recusaDoCriado(botId: BotId): Promise<Resultado | null> {
  if ((await situacaoDoBot(botId)) === null) return NAO_ENCONTRADO;
  return ehBotFixo(botId) ? { ok: false, status: 400, erro: "Os bots que vêm com o sistema não podem ser apagados." } : null;
}

/** Tira o bot da barra; as conversas dele continuam legíveis. Repetir não muda a data da primeira vez. */
export async function apagarBot(botId: BotId): Promise<Resultado> {
  const recusa = await recusaDoCriado(botId);
  if (recusa) return recusa;
  await q`UPDATE bots SET apagado_em = ${Date.now()} WHERE id = ${botId} AND apagado_em IS NULL`;
  return { ok: true, bot: await detalheDoBot(botId) };
}

export async function restaurarBot(botId: BotId): Promise<Resultado> {
  const recusa = await recusaDoCriado(botId);
  if (recusa) return recusa;
  await q`UPDATE bots SET apagado_em = NULL WHERE id = ${botId}`;
  return { ok: true, bot: await detalheDoBot(botId) };
}
