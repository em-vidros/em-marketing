import { mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EstudioDaFila } from "../src/agent/fila";
import { arquivosNoDisco } from "../src/v2/arquivos";
import { abrirBanco } from "../src/v2/banco";

/** O estúdio que as rotas pedem: Postgres na memória e arquivos dentro da pasta do banco de teste, que o setup apaga. */
export async function estudioDeTeste(): Promise<EstudioDaFila> {
  const dir = mkdtempSync(join(dirname(process.env.DB_PATH!), "estudio-"));
  return { banco: await abrirBanco({ dir: null }), arquivos: arquivosNoDisco(join(dir, "arquivos")), pasta: join(dir, "fila") };
}
