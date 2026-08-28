/**
 * executarUmaVez(): reserva a chave antes do efeito e grava o resultado depois.
 * Chave com efeito confirmado devolve o resultado guardado sem rodar de novo.
 * Chave reservada sem resultado significa efeito de destino desconhecido (o
 * processo caiu ou o efeito falhou no meio) — aí é EfeitoIndeterminado e nenhum
 * reenvio automático, porque repetir um sendDocument que talvez chegou cria a
 * segunda entrega que o §4.6 proíbe. Destravar é decisão humana: apagar a chave.
 *
 * `repetirSeFalhou` inverte o julgamento para o efeito em que duplicar é
 * tolerável e nunca acontecer não é. É o caso do álbum de revisão: dois álbuns
 * incomodam, álbum nenhum deixa o Ricardo esperando por um trabalho que já
 * ficou pronto. A chave repete quando guardou erro, ou quando está reservada há
 * mais de JANELA_RESERVA_SEGUNDOS, tempo em que um álbum em voo já teria chegado.
 * O teto de tentativas fecha o laço para o efeito que só sabe falhar.
 */

import type { Banco } from "./db";
import { emTransacao } from "./db";

export class EfeitoIndeterminado extends Error {
  constructor(chave: string, erro: string | null) {
    super(`efeito ${chave} tem destino desconhecido${erro ? ` (último erro: ${erro})` : ""}`);
  }
}

/** Subclasse de propósito: para quem só decide entre repetir e desistir, é o mesmo desfecho. */
export class TetoDeTentativas extends EfeitoIndeterminado {
  constructor(chave: string, tentativas: number, erro: string | null) {
    super(chave, `${tentativas} tentativas sem sucesso${erro ? `; ${erro}` : ""}`);
  }
}

export const TETO_TENTATIVAS = 5;
export const JANELA_RESERVA_SEGUNDOS = 600;

export interface OpcoesUmaVez {
  readonly repetirSeFalhou?: boolean;
}

interface Linha {
  chave: string;
  resultado_json: string | null;
  erro: string | null;
  tentativas: number;
  /** Comparação de tempo no SQLite: o formato de datetime('now') não é ISO e Date.parse erra o fuso. */
  reserva_fresca: number;
}

export async function executarUmaVez<T>(
  db: Banco,
  chave: string,
  efeito: () => Promise<T>,
  opcoes?: OpcoesUmaVez,
): Promise<{ novo: boolean; resultado: T }> {
  const previa = emTransacao(db, () => {
    const linha = db
      .query(
        `SELECT chave, resultado_json, erro, tentativas,
           (reservado_em IS NOT NULL AND reservado_em > datetime('now', ?)) AS reserva_fresca
         FROM idempotency_keys WHERE chave = ?`,
      )
      .get(`-${JANELA_RESERVA_SEGUNDOS} seconds`, chave) as Linha | null;
    if (!linha) {
      db.query(
        "INSERT INTO idempotency_keys (chave, tentativas, reservado_em) VALUES (?, 1, datetime('now'))",
      ).run(chave);
      return null;
    }
    if (linha.resultado_json !== null) return { resultado: JSON.parse(linha.resultado_json) as T };
    if (!opcoes?.repetirSeFalhou) throw new EfeitoIndeterminado(chave, linha.erro);
    if (linha.tentativas >= TETO_TENTATIVAS) {
      throw new TetoDeTentativas(chave, linha.tentativas, linha.erro);
    }
    if (linha.erro === null && linha.reserva_fresca) throw new EfeitoIndeterminado(chave, linha.erro);
    db.query(
      `UPDATE idempotency_keys SET tentativas = tentativas + 1, erro = NULL,
         reservado_em = datetime('now') WHERE chave = ?`,
    ).run(chave);
    return null;
  });
  if (previa) return { novo: false, resultado: previa.resultado };
  try {
    const resultado = await efeito();
    db.query(
      "UPDATE idempotency_keys SET resultado_json = ?, concluido_em = datetime('now') WHERE chave = ?",
    ).run(JSON.stringify(resultado ?? null), chave);
    return { novo: true, resultado };
  } catch (erro) {
    db.query("UPDATE idempotency_keys SET erro = ? WHERE chave = ?").run(String(erro), chave);
    throw erro;
  }
}
