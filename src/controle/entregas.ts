/**
 * Entregas com chave única fluxo:versao:canal. O mestre sai por sendDocument e o
 * recibo é o ida e volta de hash (US-5): getFile, download e comparação com
 * artifact_versions.sha256, gravado em hash_conferido. Linha 'enviando' achada
 * numa execução posterior é queda entre o envio e o recibo — vira indeterminada
 * com aviso ao Ricardo e zero reenvio automático.
 */

import { createHash } from "node:crypto";
import type { Adaptadores } from "../adaptadores/tipos";
import type { FluxoId, Formato, VersaoId } from "../modelos/tipos";
import type { Banco } from "./db";
import { emTransacao } from "./db";
import { lerFluxo, registrarEvento, transicionar } from "./fluxos";
import { lerArtefato } from "./artefatos";
import { novaEntregaId } from "./ids";

const CANAL = "telegram_doc";

interface LinhaEntrega {
  id: string;
  chave: string;
  estado: string;
}

/**
 * Documento é o arquivo que o Ricardo publica: o mestre no Instagram, o artigo
 * no blog. A legenda tem canal próprio, numa mensagem copiável, porque um .txt
 * anexo não se cola no aplicativo do Instagram (PRD §4.7).
 */
const PAPEIS_DE_DOCUMENTO = ["master", "artigo"] as const;

function versoesAprovadas(db: Banco, fluxoId: FluxoId): VersaoId[] {
  const aceite = db
    .query(
      `SELECT artifact_version_ids, opcao FROM approvals
       WHERE workflow_id = ? AND decision = 'accepted' ORDER BY rowid DESC LIMIT 1`,
    )
    .get(fluxoId) as { artifact_version_ids: string; opcao: string | null } | null;
  if (!aceite) throw new Error(`fluxo ${fluxoId} não tem aceite registrado`);
  const cobertas = aceite.opcao
    ? [aceite.opcao as VersaoId]
    : (JSON.parse(aceite.artifact_version_ids) as VersaoId[]);
  if (cobertas.length === 0) throw new Error(`aceite do fluxo ${fluxoId} não cobre nenhuma versão`);
  const marcadores = cobertas.map(() => "?").join(",");
  const papeis = PAPEIS_DE_DOCUMENTO.map(() => "?").join(",");
  const versoes = (
    db
      .query(
        `SELECT id FROM artifact_versions
         WHERE id IN (${marcadores}) AND papel IN (${papeis}) ORDER BY rowid`,
      )
      .all(...cobertas, ...PAPEIS_DE_DOCUMENTO) as { id: string }[]
  ).map((l) => l.id as VersaoId);
  if (versoes.length === 0) throw new Error(`aceite do fluxo ${fluxoId} não cobre nenhum arquivo entregável`);
  return versoes;
}

/** Nome do arquivo com trabalho, formato e versão aprovada (US-5). */
export function nomeDoDocumento(
  tema: string,
  a: { formato: Formato | null; versao: number; mediaTipo: string },
): string {
  const slug =
    tema
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "sem-tema";
  const ext = EXTENSAO_DO_MEDIA[a.mediaTipo] ?? "bin";
  return `em-vidros-${slug}-${a.formato ?? "copy"}-v${a.versao}.${ext}`;
}

const EXTENSAO_DO_MEDIA: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
};

export async function executarEntregas(
  db: Banco,
  adaptadores: Adaptadores,
  fluxoId: FluxoId,
): Promise<void> {
  const fluxo = lerFluxo(db, fluxoId);
  if (!fluxo) throw new Error(`fluxo ${fluxoId} não existe`);
  if (fluxo.estado === "delivered" || fluxo.estado === "archived") return;
  if (fluxo.estado !== "approved_for_manual_delivery" && fluxo.estado !== "copy_approved") {
    throw new Error(`fluxo ${fluxoId} em ${fluxo.estado} não entrega`);
  }
  const versoes = versoesAprovadas(db, fluxoId);

  for (const versaoId of versoes) {
    const chave = `${fluxoId}:${versaoId}:${CANAL}`;
    const acao = emTransacao(db, (): "enviar" | "pular" | "avisar" => {
      const existente = db.query("SELECT id, chave, estado FROM deliveries WHERE chave = ?").get(chave) as LinhaEntrega | null;
      if (!existente) {
        db.query(
          `INSERT INTO deliveries (id, workflow_id, artifact_version_id, chave, canal) VALUES (?, ?, ?, ?, ?)`,
        ).run(novaEntregaId(), fluxoId, versaoId, chave, CANAL);
        return "enviar";
      }
      if (existente.estado !== "enviando") return "pular";
      db.query("UPDATE deliveries SET estado = 'indeterminada', atualizado_em = datetime('now') WHERE chave = ?").run(chave);
      registrarEvento(db, { fluxoId, tipo: "entrega_indeterminada", ator: "sistema", dados: { chave } });
      return "avisar";
    });
    if (acao === "pular") continue;
    if (acao === "avisar") {
      await adaptadores.telegram.enviarMensagem(
        fluxo.chatId,
        `Entrega ${chave} caiu entre o envio e o recibo. Confira no chat se o documento chegou; não vou reenviar sozinho.`,
      );
      continue;
    }

    const artefato = lerArtefato(db, versaoId);
    const nome = nomeDoDocumento(fluxo.pedido.theme, artefato);
    const envio = await adaptadores.telegram.enviarDocumento(fluxo.chatId, artefato.bytes, nome);
    db.query("UPDATE deliveries SET file_id = ?, atualizado_em = datetime('now') WHERE chave = ?").run(envio.file_id, chave);

    const { file_path } = await adaptadores.telegram.obterArquivo(envio.file_id);
    const baixado = await adaptadores.telegram.baixarArquivo(file_path);
    const hash = createHash("sha256").update(baixado).digest("hex");
    if (hash === artefato.sha256) {
      emTransacao(db, () => {
        db.query(
          "UPDATE deliveries SET estado = 'confirmada', hash_conferido = ?, atualizado_em = datetime('now') WHERE chave = ?",
        ).run(hash, chave);
        registrarEvento(db, { fluxoId, tipo: "entrega_confirmada", ator: "sistema", dados: { chave, sha256: hash } });
      });
    } else {
      emTransacao(db, () => {
        db.query(
          "UPDATE deliveries SET estado = 'falhou', erro = ?, atualizado_em = datetime('now') WHERE chave = ?",
        ).run(`hash ${hash} != ${artefato.sha256}`, chave);
        registrarEvento(db, { fluxoId, tipo: "entrega_corrompida", ator: "sistema", dados: { chave, esperado: artefato.sha256, recebido: hash } });
      });
      await adaptadores.telegram.enviarMensagem(
        fluxo.chatId,
        `O Telegram devolveu bytes diferentes do mestre em ${chave}. Entrega marcada como falha.`,
      );
    }
  }

  const marcadores = versoes.map(() => "?").join(",");
  const { pendentes } = db
    .query(
      `SELECT COUNT(*) AS pendentes FROM deliveries
       WHERE workflow_id = ? AND artifact_version_id IN (${marcadores}) AND estado != 'confirmada'`,
    )
    .get(fluxoId, ...versoes) as { pendentes: number };
  if (pendentes === 0) {
    emTransacao(db, () => {
      transicionar(db, { fluxoId, para: "delivered", ator: "sistema", dados: { versoes } });
      db.query(
        `UPDATE tasks SET estado = 'concluida', atualizado_em = datetime('now')
         WHERE workflow_id = ? AND tipo = 'entrega' AND estado IN ('pendente','reivindicada')`,
      ).run(fluxoId);
    });
  }
}
