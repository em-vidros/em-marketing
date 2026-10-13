import { db } from "../db";
import { BOTS, type BotId } from "./bots";
import { ehModelId, type ModelId } from "./models";
import type { ToolName } from "./tools";

/**
 * A config editável de cada bot. O padrão vem do código (agent/bots.ts); cada gravação
 * vira uma linha em versoes_bot, e a mais nova vale. Nada é sobrescrito: voltar a uma
 * versão antiga, ou ao padrão, grava uma versão nova com o texto dela.
 */

export type CampoEditavel = "nome" | "descricao" | "modelo" | "prompt";

export interface VersaoBot {
  id: number;
  botId: BotId;
  nome: string;
  descricao: string;
  modelo: ModelId;
  /** Só o papel. O contexto de marca entra pelo código, sempre (`DetalheBot.fixo`). */
  prompt: string;
  criadaEm: number;
  autor: string;
}

export type Editavel = Pick<VersaoBot, CampoEditavel>;

/** GET /api/bots. A config que vale agora. `padrao[campo]` é true quando o campo está igual ao do código. */
export interface ConfigBot extends Editavel {
  id: BotId;
  sugestoes: readonly string[];
  /** A versão em vigor; null quando nunca houve gravação e vale o padrão do código. */
  versaoId: number | null;
  padrao: Record<CampoEditavel, boolean>;
}

/** GET /api/bots/:id/config. `fixo` é o que o código acrescenta depois do prompt, só para leitura. */
export interface DetalheBot extends ConfigBot {
  fixo: string;
  tools: readonly ToolName[];
}

const CAMPOS = ["nome", "descricao", "modelo", "prompt"] as const satisfies readonly CampoEditavel[];

const padraoDe = (botId: BotId): Editavel => {
  const { nome, descricao, modelo, papel } = BOTS[botId];
  return { nome, descricao, modelo, prompt: papel };
};

interface Linha {
  id: number;
  bot_id: BotId;
  nome: string;
  descricao: string;
  modelo: string;
  prompt: string;
  criada_em: number;
  autor: string;
}

/** Um modelo que saiu de MODELOS depois de gravado volta ao padrão do bot, em vez de quebrar o turno. */
const daLinha = (r: Linha): VersaoBot => ({
  id: r.id,
  botId: r.bot_id,
  nome: r.nome,
  descricao: r.descricao,
  modelo: ehModelId(r.modelo) ? r.modelo : BOTS[r.bot_id].modelo,
  prompt: r.prompt,
  criadaEm: r.criada_em,
  autor: r.autor,
});

const ultimaVersao = (botId: BotId): VersaoBot | null => {
  const r = db.query("SELECT * FROM versoes_bot WHERE bot_id = ? ORDER BY id DESC LIMIT 1").get(botId) as Linha | null;
  return r && daLinha(r);
};

export function configDoBot(botId: BotId): ConfigBot {
  const padrao = padraoDe(botId);
  const versao = ultimaVersao(botId);
  const atual: Editavel = versao ?? padrao;
  return {
    id: botId,
    nome: atual.nome,
    descricao: atual.descricao,
    modelo: atual.modelo,
    prompt: atual.prompt,
    sugestoes: BOTS[botId].sugestoes,
    versaoId: versao?.id ?? null,
    padrao: Object.fromEntries(CAMPOS.map((c) => [c, atual[c] === padrao[c]])) as ConfigBot["padrao"],
  };
}

export const detalheDoBot = (botId: BotId): DetalheBot => ({ ...configDoBot(botId), fixo: BOTS[botId].fixo(), tools: BOTS[botId].tools });

/** O system prompt do bot: o papel em vigor e, depois dele, a parte fixa do código. */
export const instrucoesDe = (config: ConfigBot): string => `${config.prompt}\n\n${BOTS[config.id].fixo()}`;

export function versoesDoBot(botId: BotId): VersaoBot[] {
  return (db.query("SELECT * FROM versoes_bot WHERE bot_id = ? ORDER BY id DESC").all(botId) as Linha[]).map(daLinha);
}

export function versaoDoBot(botId: BotId, versaoId: number): VersaoBot | null {
  const r = db.query("SELECT * FROM versoes_bot WHERE bot_id = ? AND id = ?").get(botId, versaoId) as Linha | null;
  return r && daLinha(r);
}

/**
 * Grava os campos mudados sobre a config em vigor. Se nada muda, não grava: repetir o mesmo
 * pedido não cria uma versão por clique. O modelo já chega validado pela rota.
 */
export function gravarVersao(botId: BotId, mudanca: Partial<Editavel>, autor: string): DetalheBot {
  const atual = configDoBot(botId);
  const nova: Editavel = { nome: atual.nome, descricao: atual.descricao, modelo: atual.modelo, prompt: atual.prompt, ...mudanca };
  if (CAMPOS.every((c) => nova[c] === atual[c])) return detalheDoBot(botId);
  db.query("INSERT INTO versoes_bot (bot_id, nome, descricao, modelo, prompt, criada_em, autor) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    botId,
    nova.nome,
    nova.descricao,
    nova.modelo,
    nova.prompt,
    Date.now(),
    autor,
  );
  return detalheDoBot(botId);
}

export const restaurarVersao = ({ botId, nome, descricao, modelo, prompt }: VersaoBot, autor: string): DetalheBot =>
  gravarVersao(botId, { nome, descricao, modelo, prompt }, autor);

export const restaurarPadrao = (botId: BotId, autor: string): DetalheBot => gravarVersao(botId, padraoDe(botId), autor);
