import { primeira } from "../db";
import { q } from "../v2/banco";
import { BOTS, ehBotFixo, ehMarketing, LIVRES, MARCA, SETOR_PADRAO, type BotFixo, type BotId, type Forma } from "./bots";
import { contextoDeData, diaDe } from "./hoje";
import { ehModelId, type ModelId } from "./models";
import type { ToolName } from "./tools";

/**
 * A config editável de cada bot, fixo ou criado pela equipe. Cada gravação vira uma linha em
 * versoes_bot, e a mais nova vale. Nada é sobrescrito: voltar a uma versão antiga, ou ao padrão,
 * grava uma versão nova com o texto dela. O padrão de um fixo é o código (agent/bots.ts);
 * o de um criado é a primeira versão, gravada junto com ele.
 */

export interface Editavel {
  nome: string;
  descricao: string;
  /** O grupo do bot na barra lateral. Texto livre. */
  setor: string;
  modelo: ModelId;
  /** O papel do bot. */
  prompt: string;
  /** Como usar as tools. Entra depois do prompt. */
  regras: string;
  /** Liga o contexto de marca (brandbook e tokens) depois das regras. */
  marca: boolean;
}

export type CampoEditavel = keyof Editavel;

export interface VersaoBot extends Editavel {
  id: number;
  botId: BotId;
  criadaEm: number;
  autor: string;
}

/** Só os bots criados têm. A aparência dos fixos está no front (src/web/bots.ts). */
export interface Criado {
  forma: Forma;
  cor: string;
  por: string;
  em: number;
}

/** GET /api/bots. A config que vale agora. `padrao[campo]` é true quando o campo está igual ao padrão. */
export interface ConfigBot extends Editavel {
  id: BotId;
  /** Não se edita. O fixo usa as do código; o criado tem todas as livres e escolhe pelo papel e pelo setor. */
  tools: readonly ToolName[];
  criado: Criado | null;
  apagadoEm: number | null;
  sugestoes: readonly string[];
  /** A versão em vigor; null quando nunca houve gravação e vale o padrão do código. */
  versaoId: number | null;
  padrao: Record<CampoEditavel, boolean>;
}

export interface Memoria {
  texto: string;
  atualizadaEm: number | null;
  /** E-mail de quem gravou; null quando foi o próprio bot, com lembrar. */
  autor: string | null;
}

/** GET /api/bots/:id/config */
export interface DetalheBot extends ConfigBot {
  /** O texto de marca que entra quando `marca` está ligado. Gerado de brand/, só para leitura. */
  contexto: string;
  /** As regras do padrão, para voltar só elas. */
  regrasPadrao: string;
  memoria: Memoria;
}

export const LIMITE_DA_MEMORIA = 20_000;

const CAMPOS = ["nome", "descricao", "setor", "modelo", "prompt", "regras", "marca"] as const satisfies readonly CampoEditavel[];

/** Os campos que NULL no banco quer dizer "igual ao padrão". */
const OPCIONAIS = ["setor", "regras", "marca"] as const satisfies readonly CampoEditavel[];

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** O fundo da primeira versão de um bot criado. Ela grava todos os campos; daqui só sai o modelo, quando o gravado saiu de MODELOS. */
const FUNDO_DO_CRIADO: Editavel = { nome: "", descricao: "", setor: SETOR_PADRAO, modelo: "openai:gpt-6-luna", prompt: "", regras: "", marca: true };

const padraoDoFixo = (id: BotFixo): Editavel => {
  const { nome, descricao, modelo, papel, regras } = BOTS[id];
  return { nome, descricao, setor: SETOR_PADRAO, modelo, prompt: papel, regras, marca: true };
};

/**
 * As consultas de versoes_bot listam as colunas em vez de SELECT *: uma instância que preparou o
 * SELECT * antes de um ALTER TABLE de outra instância passa a falhar com "cached plan must not change result type".
 */
interface LinhaVersao {
  id: number;
  bot_id: BotId;
  nome: string;
  descricao: string;
  modelo: string;
  prompt: string;
  setor: string | null;
  regras: string | null;
  tools: string | null;
  marca: boolean | null;
  criada_em: number;
  autor: string;
}

interface LinhaBot {
  id: BotId;
  forma: Forma;
  cor: string;
  criado_por: string;
  criado_em: number;
  apagado_em: number | null;
}

/** Um modelo que saiu de MODELOS depois de gravado volta ao padrão do bot, em vez de quebrar o turno. */
const daLinha = (r: LinhaVersao, padrao: Editavel): VersaoBot => ({
  id: r.id,
  botId: r.bot_id,
  nome: r.nome,
  descricao: r.descricao,
  setor: r.setor ?? padrao.setor,
  modelo: ehModelId(r.modelo) ? r.modelo : padrao.modelo,
  prompt: r.prompt,
  regras: r.regras ?? padrao.regras,
  marca: r.marca ?? padrao.marca,
  criadaEm: r.criada_em,
  autor: r.autor,
});

/** O que não é versionado: de onde vem o padrão, a aparência e o texto de marca. */
interface Base {
  id: BotId;
  criado: Criado | null;
  apagadoEm: number | null;
  padrao: Editavel;
  contexto: () => string;
  sugestoes: readonly string[];
}

async function baseDo(botId: BotId): Promise<Base | null> {
  if (ehBotFixo(botId)) {
    const { contexto, sugestoes } = BOTS[botId];
    return { id: botId, criado: null, apagadoEm: null, padrao: padraoDoFixo(botId), contexto, sugestoes };
  }
  const bot = await primeira(q<LinhaBot>`SELECT id, forma, cor, criado_por, criado_em, apagado_em FROM bots WHERE id = ${botId}`);
  if (!bot) return null;
  // criarBot grava o bot e a primeira versão, com todos os campos, na mesma transação.
  const primeiraVersao = (await primeira(q<LinhaVersao>`SELECT id, bot_id, nome, descricao, modelo, prompt, setor, regras, tools, marca, criada_em, autor FROM versoes_bot WHERE bot_id = ${botId} ORDER BY id LIMIT 1`))!;
  return {
    id: botId,
    criado: { forma: bot.forma, cor: bot.cor, por: bot.criado_por, em: bot.criado_em },
    apagadoEm: bot.apagado_em,
    padrao: daLinha(primeiraVersao, FUNDO_DO_CRIADO),
    contexto: MARCA,
    sugestoes: [],
  };
}

async function lerBot(botId: BotId): Promise<{ base: Base; config: ConfigBot }> {
  const base = await baseDo(botId);
  if (!base) throw new Error(`Bot desconhecido: ${botId}.`);
  const r = await primeira(q<LinhaVersao>`SELECT id, bot_id, nome, descricao, modelo, prompt, setor, regras, tools, marca, criada_em, autor FROM versoes_bot WHERE bot_id = ${botId} ORDER BY id DESC LIMIT 1`);
  const versao = r && daLinha(r, base.padrao);
  const atual: Editavel = versao ?? base.padrao;
  const editavel = Object.fromEntries(CAMPOS.map((c) => [c, atual[c]])) as unknown as Editavel;
  return {
    base,
    config: {
      id: botId,
      ...editavel,
      tools: ehBotFixo(botId) ? BOTS[botId].tools : LIVRES,
      criado: base.criado,
      apagadoEm: base.apagadoEm,
      sugestoes: base.sugestoes,
      versaoId: versao?.id ?? null,
      padrao: Object.fromEntries(CAMPOS.map((c) => [c, igual(editavel[c], base.padrao[c])])) as ConfigBot["padrao"],
    },
  };
}

/** "ativo", "apagado", ou null quando o id não é de nenhum bot. */
export async function situacaoDoBot(botId: BotId): Promise<"ativo" | "apagado" | null> {
  if (ehBotFixo(botId)) return "ativo";
  const r = await primeira(q<{ apagado_em: number | null }>`SELECT apagado_em FROM bots WHERE id = ${botId}`);
  return r ? (r.apagado_em === null ? "ativo" : "apagado") : null;
}

/** A config em vigor. Lança erro para um id desconhecido: quem chama já passou por situacaoDoBot. */
export const configDoBot = async (botId: BotId): Promise<ConfigBot> => (await lerBot(botId)).config;

export async function memoriaDo(botId: BotId): Promise<Memoria> {
  const r = await primeira(q<{ texto: string; atualizada_em: number; autor: string | null }>`SELECT texto, atualizada_em, autor FROM memorias_bot WHERE bot_id = ${botId}`);
  return r ? { texto: r.texto, atualizadaEm: r.atualizada_em, autor: r.autor } : { texto: "", atualizadaEm: null, autor: null };
}

export async function detalheDoBot(botId: BotId): Promise<DetalheBot> {
  const { base, config } = await lerBot(botId);
  return { ...config, contexto: base.contexto().trim(), regrasPadrao: base.padrao.regras, memoria: await memoriaDo(botId) };
}

/** GET /api/bots: os fixos, depois os criados que não foram apagados, na ordem em que nasceram. */
export async function listarBots(): Promise<ConfigBot[]> {
  const criados = await q<{ id: string }>`SELECT id FROM bots WHERE apagado_em IS NULL ORDER BY criado_em, id`;
  return Promise.all([...Object.keys(BOTS), ...criados.map((b) => b.id)].map(configDoBot));
}

const DELEGADA =
  "Você está numa tarefa delegada pelo Chefe, não falando com o usuário. Não faça perguntas: decida com o que tem e siga o fluxo até onde o pedido manda. Termine com um resumo curto do que fez e do que ficou pendente; só ele volta para o Chefe.";

/** O bot criado tem todas as ferramentas livres; esta linha é o que o faz usar só as do papel dele. */
const papelDoCriado = (bot: DetalheBot) =>
  [
    `Você é ${bot.nome}, do setor ${bot.setor} da EM Vidros. ${bot.descricao}`,
    "Você tem várias ferramentas: use só as que servem a esse papel e a esse setor, e ignore as outras.",
    ehMarketing(bot.setor) ? "" : "As de post, arte, legenda, fotos e agenda são do marketing: não use.",
    "Quando a resposta depende de lei, norma, preço ou outro fato que muda, pesquise com pesquisar_web, leia a fonte com ler_pagina e diga de onde tirou.",
    "Se o pedido for de outra área, diga qual bot da equipe cuida disso.",
  ]
    .filter(Boolean)
    .join(" ");

/** Os bots criados que este bot pode chamar com delegar_bot. Vazio para quem não tem a tool. */
export async function botsParaDelegar(bot: ConfigBot): Promise<ConfigBot[]> {
  return bot.tools.includes("delegar_bot") ? (await listarBots()).filter((b) => b.criado) : [];
}

const listaDaEquipe = (bots: readonly ConfigBot[]) =>
  bots.length === 0 ? "" : `--- BOTS DA EQUIPE (para delegar_bot) ---\n${bots.map((b) => `- ${b.id}: ${b.nome}, setor ${b.setor}. ${b.descricao}`).join("\n")}`;

/**
 * O system prompt inteiro de um turno, na ordem em que o modelo lê: prompt, papel do criado, regras, marca,
 * data, aviso de tarefa delegada, memória, bots da equipe e estado do post. GET /api/bots/:id/prompt mostra o mesmo texto.
 */
export function instrucoesDe(
  bot: DetalheBot,
  turno: { delegada: boolean; estadoDoPost: string; equipe?: readonly ConfigBot[]; agora?: number },
): string {
  const memoria = bot.memoria.texto.trim();
  return [
    bot.prompt,
    bot.criado ? papelDoCriado(bot) : "",
    bot.regras.trim(),
    bot.marca ? bot.contexto : "",
    turno.delegada ? DELEGADA : "",
    // Daqui para baixo muda a cada turno (a hora, a memória, o post): o que vem antes é o prefixo que a OpenAI reaproveita do cache.
    contextoDeData(turno.agora),
    memoria && `--- MEMÓRIA ---\n${memoria}`,
    listaDaEquipe(turno.equipe ?? []),
    `--- ESTADO DO POST DESTA CONVERSA ---\n${turno.estadoDoPost}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function versoesDoBot(botId: BotId): Promise<VersaoBot[]> {
  const { base } = await lerBot(botId);
  return (await q<LinhaVersao>`SELECT id, bot_id, nome, descricao, modelo, prompt, setor, regras, tools, marca, criada_em, autor FROM versoes_bot WHERE bot_id = ${botId} ORDER BY id DESC`).map((r) => daLinha(r, base.padrao));
}

export async function versaoDoBot(botId: BotId, versaoId: number): Promise<VersaoBot | null> {
  const { base } = await lerBot(botId);
  const r = await primeira(q<LinhaVersao>`SELECT id, bot_id, nome, descricao, modelo, prompt, setor, regras, tools, marca, criada_em, autor FROM versoes_bot WHERE bot_id = ${botId} AND id = ${versaoId}`);
  return r && daLinha(r, base.padrao);
}

/**
 * Grava os campos mudados sobre a config em vigor. Se nada muda, não grava: repetir o mesmo
 * pedido não cria uma versão por clique. O modelo e as tools já chegam validados pela rota.
 */
export async function gravarVersao(botId: BotId, mudanca: Partial<Editavel>, autor: string): Promise<DetalheBot> {
  const { base, config: atual } = await lerBot(botId);
  const nova: Editavel = { ...atual, ...mudanca };
  if (CAMPOS.every((c) => igual(nova[c], atual[c]))) return detalheDoBot(botId);
  const [setor, regras, marca] = OPCIONAIS.map((c) => (igual(nova[c], base.padrao[c]) ? null : nova[c]));
  await q`INSERT INTO versoes_bot (bot_id, nome, descricao, modelo, prompt, setor, regras, marca, tools, criada_em, autor)
    VALUES (${botId}, ${nova.nome}, ${nova.descricao}, ${nova.modelo}, ${nova.prompt}, ${setor}, ${regras}, ${marca},
      ${null}, ${Date.now()}, ${autor})`;
  return detalheDoBot(botId);
}

export const restaurarVersao = ({ botId, ...versao }: VersaoBot, autor: string): Promise<DetalheBot> =>
  gravarVersao(botId, Object.fromEntries(CAMPOS.map((c) => [c, versao[c]])), autor);

export const restaurarPadrao = async (botId: BotId, autor: string): Promise<DetalheBot> => gravarVersao(botId, (await lerBot(botId)).base.padrao, autor);

export async function gravarMemoria(botId: BotId, texto: string, autor: string): Promise<Memoria> {
  await q`INSERT INTO memorias_bot (bot_id, texto, atualizada_em, autor) VALUES (${botId}, ${texto}, ${Date.now()}, ${autor})
    ON CONFLICT (bot_id) DO UPDATE SET texto = excluded.texto, atualizada_em = excluded.atualizada_em, autor = excluded.autor`;
  return memoriaDo(botId);
}

/**
 * A tool lembrar: acrescenta "AAAA-MM-DD: nota" ao fim da memória, num só comando, para duas
 * conversas lembrando ao mesmo tempo não apagarem a nota uma da outra. false quando passaria do limite.
 */
export async function lembrar(botId: BotId, nota: string, agora = Date.now()): Promise<boolean> {
  const linha = `${diaDe(agora)}: ${nota.trim().replace(/\s*\n\s*/g, " ")}`;
  const gravada = await q`INSERT INTO memorias_bot (bot_id, texto, atualizada_em, autor) VALUES (${botId}, ${linha}, ${agora}, NULL)
    ON CONFLICT (bot_id) DO UPDATE SET
      texto = CASE WHEN memorias_bot.texto = '' THEN excluded.texto ELSE memorias_bot.texto || chr(10) || excluded.texto END,
      atualizada_em = excluded.atualizada_em, autor = NULL
    WHERE length(memorias_bot.texto) + length(excluded.texto) < ${LIMITE_DA_MEMORIA}
    RETURNING bot_id`;
  return gravada.length > 0;
}
