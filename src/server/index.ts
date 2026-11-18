import { purgarConversasApagadas } from "../agent/conversas";
import { startScheduler } from "../domain/scheduler";
import { criarApi } from "../v2/api";
import { leiturasParaInspirar } from "../v2/referencias";
import site from "../web/index.html";
import { usuarioDa } from "./auth";
import { iniciar } from "./iniciar";
import { rotas } from "./rotas";

const { estudio, segredoAprovacao } = await iniciar();
const api = criarApi(estudio, usuarioDa);
const apiNova = (req: Request) => api.fetch(req);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
  // Gerar uma cena leva de 25 a 40 s sem mandar nenhum byte; o padrão de 10 s derrubava o pedido no meio.
  idleTimeout: 120,
  // O site é uma SPA: toda rota que não é da API devolve o index.html.
  routes: {
    ...rotas({ segredoAprovacao, inspiracoes: () => leiturasParaInspirar(estudio.banco), estudio }),
    ...Object.fromEntries(["/api/referencias", "/api/referencias/*", "/api/artes", "/api/artes/*", "/api/arquivos/*"].map((rota) => [rota, apiNova])),
    "/*": site,
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  fetch: () => new Response("Não encontrado.", { status: 404 }),
});

startScheduler();
const purgadas = await purgarConversasApagadas();
if (purgadas > 0) console.log(`${purgadas} conversa(s) apagada(s) há mais de 30 dias removida(s) de vez.`);

console.log(`em-marketing ouvindo em :${server.port}`);
