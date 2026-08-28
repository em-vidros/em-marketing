/**
 * Só HTTP e boot. O servidor não decide nada de conteúdo: recebe o update do
 * Telegram, confere segredo e allowlist, responde 200 e entrega a conversa fora
 * da requisição. O Telegram reenvia o update quando a resposta demora, e
 * gerar arte dentro do handler garantiria a demora (PRD §4.11).
 *
 * No boot ele sobe o plano de controle, um laço por papel e o tique que
 * reconcilia e apresenta as revisões abertas. Nada aqui guarda estado: o processo
 * pode morrer entre dois passos e o reconciliador recompõe o trabalho pelo banco.
 */

import { timingSafeEqual } from "node:crypto";
import { Elysia, status } from "elysia";
import { carregarAdaptadores, perfilAtual } from "./adaptadores/index";
import { criarControle } from "./controle/api";
import type { Papel } from "./modelos/tipos";
import { chatDoUpdate, criarConversa } from "./telegram/conversa";
import { apresentarRevisoes } from "./workers/apresentador";
import type { AoFalhar } from "./workers/laco";
import { iniciarWorkers } from "./workers/laco";

const PAPEIS: readonly Papel[] = [
  "diretor_criativo",
  "redator",
  "designer",
  "diretor_de_arte",
  "operacoes",
];

const TIQUE_MS = 30_000;

function texto(nome: string, padrao: string): string {
  return process.env[nome]?.trim() || padrao;
}

const perfil = perfilAtual();
const adaptadores = carregarAdaptadores();

const aprovadorId = Number(texto("APROVADOR_TELEGRAM_ID", "0")) || 0;
if (aprovadorId === 0) {
  console.warn(
    "APROVADOR_TELEGRAM_ID vazio: nenhum botão de aprovação vai passar. Preencha com o Telegram ID do Ricardo.",
  );
}

const controle = criarControle({
  caminhoDb: texto("DB_PATH", "data/em-marketing.db"),
  adaptadores,
  aprovadorId,
  artefatosDir: texto("ARTIFACTS_DIR", "data/artefatos"),
});

/** US-9: quem falhou, se ainda vai tentar, e nada de terceiro aviso na mesma tarefa. */
const aoFalhar: AoFalhar = (_fluxoId, chatId, tipo, mensagem, vaiTentarDeNovo) => {
  const desfecho = vaiTentarDeNovo ? "Vou tentar de novo." : "Parou; precisa de alguém olhar.";
  void adaptadores.telegram
    .enviarMensagem(chatId, `A etapa ${tipo} falhou: ${mensagem}. ${desfecho}`)
    .catch((erro) => console.error(`aviso de falha não chegou ao chat ${chatId}: ${erro}`));
};

const trabalhando = iniciarWorkers({
  controle: controle.paraWorkers,
  adaptadores,
  papeis: PAPEIS,
  aoFalhar,
});

const tique = setInterval(() => {
  try {
    controle.reconciliar();
  } catch (erro) {
    console.error(`reconciliador: ${erro}`);
  }
  void apresentarRevisoes({ controle: controle.paraWorkers, adaptadores }).catch((erro) =>
    console.error(`apresentador: ${erro}`),
  );
}, TIQUE_MS);

const conversa = criarConversa({ entrada: controle.paraTelegram, telegram: adaptadores.telegram, aprovadorId });

const PERMITIDOS = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n !== 0),
);

/** Comparação de tamanho antes do timingSafeEqual, que lança quando os bytes diferem em número. */
function segredoConfere(cabecalho: string | undefined): boolean {
  const esperado = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!cabecalho || !esperado) return false;
  const a = Buffer.from(cabecalho, "utf8");
  const b = Buffer.from(esperado, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const app = new Elysia()
  .get("/health", () => ({ ok: true, ts: new Date().toISOString() }))
  .post(
    "/webhooks/telegram",
    async ({ request, headers }) => {
      if (!segredoConfere(headers["x-telegram-bot-api-secret-token"])) return status(401, "unauthorized");
      let update: unknown;
      try {
        update = JSON.parse(await request.text());
      } catch {
        return status(400, "bad request");
      }
      const chatId = chatDoUpdate(update);
      // Silêncio para chat de fora: responder já contaria como resposta do bot.
      if (chatId === null || !PERMITIDOS.has(chatId)) return { ok: true };
      queueMicrotask(() => {
        void conversa.tratar(update);
      });
      return { ok: true };
    },
    { parse: "none" as never },
  )
  .listen(Number(process.env.PORT ?? 3000));

console.log(
  `em-marketing ouvindo em :${app.server?.port} | adaptadores=${perfil} | ` +
    `aprovador=${aprovadorId || "nenhum"} | chats permitidos=${PERMITIDOS.size}`,
);

let parando = false;

/** Tarefa em voo perde a lease e volta pela fila no boot seguinte; é o desenho da Fase 1. */
async function parar(sinal: string): Promise<void> {
  if (parando) return;
  parando = true;
  console.log(`${sinal}: parando`);
  clearInterval(tique);
  trabalhando.parar();
  await app.stop();
  controle.fechar();
  process.exit(0);
}

process.on("SIGTERM", () => void parar("SIGTERM"));
process.on("SIGINT", () => void parar("SIGINT"));
