import { startScheduler } from "../domain/scheduler";
import { rotas } from "./rotas";

const segredo = process.env.BETTER_AUTH_SECRET;
if (!segredo) throw new Error("BETTER_AUTH_SECRET não definido.");

// Chave própria para assinar aprovações, derivada do segredo do better-auth.
const segredoAprovacao = new Bun.CryptoHasher("sha256", segredo).update("aprovacao-de-tools").digest("hex");

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: rotas({ segredoAprovacao }),
  fetch: () => new Response("Não encontrado.", { status: 404 }),
});

startScheduler();

console.log(`em-marketing ouvindo em :${server.port}`);
