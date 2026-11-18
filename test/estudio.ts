import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EstudioDaFila } from "../src/agent/fila";
import { arquivosNoDisco } from "../src/v2/arquivos";
import { banco } from "../src/v2/banco";

/** O estúdio que as rotas pedem: o Postgres do preload e arquivos numa pasta temporária, apagada na saída. */
export function estudioDeTeste(): EstudioDaFila {
  const dir = mkdtempSync(join(tmpdir(), "em-marketing-estudio-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return { banco: banco(), arquivos: arquivosNoDisco(join(dir, "arquivos")) };
}
