import { purgarConversasApagadas } from "../agent/conversas";
import { startScheduler } from "../domain/scheduler";
import site from "../web/index.html";
import { rotasDoApp } from "./app";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
  // Gerar uma cena leva de 25 a 40 s sem mandar nenhum byte; o padrão de 10 s derrubava o pedido no meio.
  idleTimeout: 120,
  // O site é uma SPA: toda rota que não é da API devolve o index.html.
  routes: { ...(await rotasDoApp()), "/*": site },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  fetch: () => new Response("Não encontrado.", { status: 404 }),
});

startScheduler();
const purgadas = await purgarConversasApagadas();
if (purgadas > 0) console.log(`${purgadas} conversa(s) da lixeira antiga removida(s) de vez.`);

console.log(`em-marketing ouvindo em :${server.port}`);
