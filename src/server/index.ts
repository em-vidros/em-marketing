import { purgarConversasApagadas } from "../agent/conversas";
import { startScheduler } from "../domain/scheduler";
import site from "../web/index.html";
import { rotas } from "./rotas";

const segredo = process.env.BETTER_AUTH_SECRET;
if (!segredo) throw new Error("BETTER_AUTH_SECRET não definido.");

// Chave própria para assinar aprovações, derivada do segredo do better-auth.
const segredoAprovacao = new Bun.CryptoHasher("sha256", segredo).update("aprovacao-de-tools").digest("hex");

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
  // O site é uma SPA: toda rota que não é da API devolve o index.html.
  routes: { ...rotas({ segredoAprovacao }), "/*": site },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  fetch: () => new Response("Não encontrado.", { status: 404 }),
});

startScheduler();
const purgadas = purgarConversasApagadas();
if (purgadas > 0) console.log(`${purgadas} conversa(s) apagada(s) há mais de 30 dias removida(s) de vez.`);

console.log(`em-marketing ouvindo em :${server.port}`);
