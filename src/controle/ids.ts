/**
 * Ids de 12 chars em base32 Crockford (60 bits). Não é capricho: callback_data do
 * Telegram tem teto de 64 bytes e dois UUIDs não cabem (DESIGN.md, Aprovação).
 */

import type { EntregaId, FluxoId, TarefaId, VersaoId } from "../modelos/tipos";

const ALFABETO = "0123456789abcdefghjkmnpqrstvwxyz";

export const ID_RE = /^[0-9abcdefghjkmnpqrstvwxyz]{12}$/;

export function gerarId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let id = "";
  for (const b of bytes) id += ALFABETO[b & 31]!;
  return id;
}

export const novoFluxoId = (): FluxoId => gerarId() as FluxoId;
export const novaTarefaId = (): TarefaId => gerarId() as TarefaId;
export const novaVersaoId = (): VersaoId => gerarId() as VersaoId;
export const novaEntregaId = (): EntregaId => gerarId() as EntregaId;
