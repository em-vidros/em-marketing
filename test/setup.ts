import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Preload de `bun test` (ver bunfig.toml).
 *
 * `src/db/index.ts` abre a conexão no import e o módulo é compartilhado por todos
 * os arquivos de teste do processo. Se cada arquivo escolhesse o próprio DB_PATH,
 * só o primeiro import valeria — e apagar o diretório de um deles no afterAll
 * derrubaria a conexão que os outros ainda usam (SQLITE_IOERR_VNODE).
 *
 * Um banco por execução, apagado na saída.
 */
const dir = mkdtempSync(join(tmpdir(), "em-marketing-test-"));
process.env.DB_PATH = join(dir, "test.db");

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

process.env.BETTER_AUTH_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.ALLOWED_EMAILS = "ana@emvidros.com.br, bia@emvidros.com.br";
