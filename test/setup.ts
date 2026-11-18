import { criarTabelas } from "../src/db";
import { abrirBanco } from "../src/v2/banco";

/**
 * Preload de `bun test` (ver bunfig.toml).
 *
 * Um Postgres na memória (PGlite) por execução, aberto antes de qualquer teste: `abrirBanco` troca a
 * conexão do processo, então nenhum arquivo de teste abre outra. Os arquivos compartilham o banco:
 * um teste que conta linhas precisa filtrar pelas que ele mesmo criou.
 */
process.env.BETTER_AUTH_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.ALLOWED_EMAILS = "ana@emvidros.com.br, bia@emvidros.com.br";
process.env.LOGIN_POR_SENHA = "1";

// Com TESTE_DATABASE_URL, a suíte roda num Postgres de verdade pelo Bun SQL, a mesma ponta da Vercel.
await abrirBanco(process.env.TESTE_DATABASE_URL ? { url: process.env.TESTE_DATABASE_URL, dir: null } : { dir: null });
await criarTabelas();
