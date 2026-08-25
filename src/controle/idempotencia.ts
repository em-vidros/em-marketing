/**
 * executarUmaVez(): reserva a chave antes do efeito e grava o resultado depois.
 * Chave com efeito confirmado devolve o resultado guardado sem rodar de novo.
 * Chave reservada sem resultado significa efeito de destino desconhecido (o
 * processo caiu ou o efeito falhou no meio) — aí é EfeitoIndeterminado e nenhum
 * reenvio automático, porque repetir um sendDocument que talvez chegou cria a
 * segunda entrega que o §4.6 proíbe. Destravar é decisão humana: apagar a chave.
 */

import type { Banco } from "./db";
import { emTransacao } from "./db";

export class EfeitoIndeterminado extends Error {
  constructor(chave: string, erro: string | null) {
    super(`efeito ${chave} tem destino desconhecido${erro ? ` (último erro: ${erro})` : ""}`);
  }
}

interface Linha {
  chave: string;
  resultado_json: string | null;
  erro: string | null;
}

export async function executarUmaVez<T>(
  db: Banco,
  chave: string,
  efeito: () => Promise<T>,
): Promise<{ novo: boolean; resultado: T }> {
  const previa = emTransacao(db, () => {
    const linha = db.query("SELECT * FROM idempotency_keys WHERE chave = ?").get(chave) as Linha | null;
    if (!linha) {
      db.query("INSERT INTO idempotency_keys (chave) VALUES (?)").run(chave);
      return null;
    }
    if (linha.resultado_json === null) throw new EfeitoIndeterminado(chave, linha.erro);
    return { resultado: JSON.parse(linha.resultado_json) as T };
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
