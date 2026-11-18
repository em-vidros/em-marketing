import { purgarConversasApagadas } from "../agent/conversas";
import { startScheduler } from "../domain/scheduler";
import { criarApi } from "../v2/api";
import { arquivosNoDisco } from "../v2/arquivos";
import { abrirBanco } from "../v2/banco";
import { leiturasParaInspirar } from "../v2/referencias";
import { iaDaOpenAI } from "../v2/ia";
import site from "../web/index.html";
import { usuarioDa } from "./auth";
import { rotas } from "./rotas";

const segredo = process.env.BETTER_AUTH_SECRET;
if (!segredo) throw new Error("BETTER_AUTH_SECRET não definido.");

// Chave própria para assinar aprovações, derivada do segredo do better-auth.
const segredoAprovacao = new Bun.CryptoHasher("sha256", segredo).update("aprovacao-de-tools").digest("hex");

if (!process.env.OPENAI_API_KEY) console.warn("OPENAI_API_KEY não definido: referências e artes vão falhar ao chamar o modelo.");

const estudio = {
  banco: await abrirBanco({ url: process.env.DATABASE_URL, dir: "data/pglite" }),
  ia: iaDaOpenAI(process.env.OPENAI_API_KEY ?? ""),
  arquivos: arquivosNoDisco("data/arquivos"),
};
const api = criarApi(estudio, usuarioDa);
const apiNova = (req: Request) => api.fetch(req);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
  // Gerar uma cena leva de 25 a 40 s sem mandar nenhum byte; o padrão de 10 s derrubava o pedido no meio.
  idleTimeout: 120,
  // O site é uma SPA: toda rota que não é da API devolve o index.html.
  routes: {
    ...rotas({ segredoAprovacao, inspiracoes: () => leiturasParaInspirar(estudio.banco), estudio: { ...estudio, pasta: "data/fila" } }),
    ...Object.fromEntries(["/api/referencias", "/api/referencias/*", "/api/artes", "/api/artes/*", "/api/arquivos/*"].map((rota) => [rota, apiNova])),
    "/*": site,
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  fetch: () => new Response("Não encontrado.", { status: 404 }),
});

startScheduler();
const purgadas = purgarConversasApagadas();
if (purgadas > 0) console.log(`${purgadas} conversa(s) apagada(s) há mais de 30 dias removida(s) de vez.`);

console.log(`em-marketing ouvindo em :${server.port}`);
