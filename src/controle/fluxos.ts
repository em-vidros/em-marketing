/**
 * transicionar() é a única função em qualquer lugar que escreve
 * workflow_runs.estado: valida a aresta contra a tabela de transição, faz o CAS
 * (estado + versao) e grava o evento na mesma transação. Zero linhas alteradas é
 * outro escritor na frente — erro, nunca retry cego.
 */

import { carregarContextoMarca } from "../adaptadores/marca";
import type {
  EstadoQualquer,
  FluxoId,
  Pedido,
  RevisaoPendente,
  TipoFluxo,
} from "../modelos/tipos";
import { TERMINAIS, arestaLegal } from "../modelos/tipos";
import type { Banco } from "./db";
import { emTransacao } from "./db";
import { gerarId, novoFluxoId } from "./ids";

export class ArestaIlegal extends Error {}
export class FluxoDesatualizado extends Error {}

export interface Fluxo {
  id: FluxoId;
  tipo: TipoFluxo;
  estado: EstadoQualquer;
  versao: number;
  rodada: number;
  chatId: number;
  solicitanteId: number;
  pedido: Pedido;
  brandVersionId: string;
  revisaoPendente: RevisaoPendente | null;
}

interface LinhaFluxo {
  id: string;
  tipo: string;
  estado: string;
  versao: number;
  rodada: number;
  chat_id: number;
  solicitante_id: number;
  pedido_json: string;
  brand_version_id: string;
  revisao_pendente: string | null;
}

function deLinha(l: LinhaFluxo): Fluxo {
  return {
    id: l.id as FluxoId,
    tipo: l.tipo as TipoFluxo,
    estado: l.estado as EstadoQualquer,
    versao: l.versao,
    rodada: l.rodada,
    chatId: l.chat_id,
    solicitanteId: l.solicitante_id,
    pedido: JSON.parse(l.pedido_json) as Pedido,
    brandVersionId: l.brand_version_id,
    revisaoPendente: l.revisao_pendente
      ? (JSON.parse(l.revisao_pendente) as RevisaoPendente)
      : null,
  };
}

export function lerFluxo(db: Banco, id: FluxoId): Fluxo | null {
  const linha = db.query("SELECT * FROM workflow_runs WHERE id = ?").get(id) as LinhaFluxo | null;
  return linha ? deLinha(linha) : null;
}

export function fluxosNaoTerminais(db: Banco): Fluxo[] {
  const marcadores = TERMINAIS.map(() => "?").join(",");
  const linhas = db
    .query(`SELECT * FROM workflow_runs WHERE estado NOT IN (${marcadores}) ORDER BY criado_em, id`)
    .all(...TERMINAIS) as LinhaFluxo[];
  return linhas.map(deLinha);
}

/**
 * Fluxo ativo do chat é o último não terminal. A conversa decide o que fazer com
 * ele a partir do estado, e por isso o estado sai daqui em vez de a regra morar
 * nesta consulta.
 */
export function fluxoAtivoDoChat(db: Banco, chatId: number): Fluxo | null {
  const marcadores = TERMINAIS.map(() => "?").join(",");
  const linha = db
    .query(
      `SELECT * FROM workflow_runs WHERE chat_id = ? AND estado NOT IN (${marcadores})
       ORDER BY criado_em DESC, rowid DESC LIMIT 1`,
    )
    .get(chatId, ...TERMINAIS) as LinhaFluxo | null;
  return linha ? deLinha(linha) : null;
}

export function registrarEvento(
  db: Banco,
  e: { fluxoId: FluxoId; tipo: string; ator: string; dados?: Record<string, unknown> },
): void {
  db.query("INSERT INTO events (workflow_id, tipo, ator, dados_json) VALUES (?, ?, ?, ?)").run(
    e.fluxoId,
    e.tipo,
    e.ator,
    e.dados ? JSON.stringify(e.dados) : null,
  );
}

/**
 * Snapshot imutável da marca (PRD §3.3, brand_version): endereçado pelo hash do
 * conteúdo, então pedir de novo com a marca inalterada reusa a mesma linha.
 *
 * O hash vem de carregarContextoMarca() e não de uma conta local. Duas contas
 * dariam dois ids para a mesma árvore, e aí a marca que o artefato diz ter usado
 * dependeria de quem perguntou.
 */
function snapshotMarca(db: Banco): string {
  const marca = carregarContextoMarca();
  const sha = marca.brandVersionId;
  const existente = db.query("SELECT id FROM brand_versions WHERE sha256 = ?").get(sha) as
    | { id: string }
    | null;
  if (existente) return existente.id;
  const id = gerarId();
  db.query(
    "INSERT INTO brand_versions (id, sha256, brandbook, voz, tokens, estilos) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, sha, marca.brandbook, marca.voz, JSON.stringify(marca.tokens), JSON.stringify(marca.estilos));
  return id;
}

export function criarFluxo(
  db: Banco,
  e: { tipo: TipoFluxo; chatId: number; solicitanteId: number; pedido: Pedido },
): FluxoId {
  if (!e.pedido.theme?.trim()) throw new Error("pedido sem tema");
  const formatoCabe = e.tipo === "blog" ? e.pedido.format === "blog" : e.pedido.format !== "blog";
  if (!formatoCabe) throw new Error(`formato ${e.pedido.format} não cabe em fluxo ${e.tipo}`);
  return emTransacao(db, () => {
    const marcaId = snapshotMarca(db);
    const id = novoFluxoId();
    db.query(
      `INSERT INTO workflow_runs (id, tipo, estado, chat_id, solicitante_id, pedido_json, brand_version_id)
       VALUES (?, ?, 'requested', ?, ?, ?, ?)`,
    ).run(id, e.tipo, e.chatId, e.solicitanteId, JSON.stringify(e.pedido), marcaId);
    registrarEvento(db, {
      fluxoId: id,
      tipo: "fluxo_criado",
      ator: `telegram:${e.solicitanteId}`,
      dados: { tipo: e.tipo, theme: e.pedido.theme, format: e.pedido.format },
    });
    return id;
  });
}

export function transicionar(
  db: Banco,
  t: {
    fluxoId: FluxoId;
    para: EstadoQualquer;
    ator: string;
    /** CAS explícito para quem leu o fluxo fora desta transação. */
    esperado?: { estado: EstadoQualquer; versao: number };
    incrementaRodada?: boolean;
    /** undefined não toca na coluna; null limpa. */
    revisaoPendente?: RevisaoPendente | null;
    dados?: Record<string, unknown>;
  },
): void {
  emTransacao(db, () => {
    const fluxo = lerFluxo(db, t.fluxoId);
    if (!fluxo) throw new FluxoDesatualizado(`fluxo ${t.fluxoId} não existe`);
    const de = t.esperado?.estado ?? fluxo.estado;
    const versao = t.esperado?.versao ?? fluxo.versao;
    if (!arestaLegal(fluxo.tipo, de, t.para)) {
      throw new ArestaIlegal(`${fluxo.tipo}: ${de} -> ${t.para}`);
    }
    const sets = ["estado = ?", "versao = versao + 1", "atualizado_em = datetime('now')"];
    const valores: (string | null)[] = [t.para];
    if (t.incrementaRodada) sets.push("rodada = rodada + 1");
    if (t.revisaoPendente !== undefined) {
      sets.push("revisao_pendente = ?");
      valores.push(t.revisaoPendente === null ? null : JSON.stringify(t.revisaoPendente));
    }
    const r = db
      .query(`UPDATE workflow_runs SET ${sets.join(", ")} WHERE id = ? AND estado = ? AND versao = ?`)
      .run(...valores, t.fluxoId, de, versao);
    if (r.changes === 0) {
      throw new FluxoDesatualizado(`${t.fluxoId}: esperava ${de} v${versao}`);
    }
    registrarEvento(db, {
      fluxoId: t.fluxoId,
      tipo: "transicao",
      ator: t.ator,
      dados: { de, para: t.para, ...t.dados },
    });
  });
}
