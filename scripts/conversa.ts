// Roda um turno de um bot sem front e imprime o texto, as partes de tool e o
// progresso de cada tarefa que o Chefe delegar.
//
// Uso: bun scripts/conversa.ts <bot> "<pedido>" [conversa-id]
// Repetir o mesmo conversa-id continua o post em andamento daquela conversa.
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { executar } from "../src/agent";
import { BOTS, ehBotId } from "../src/agent/bots";
import { tarefasDaConversa } from "../src/agent/tarefas";
import type { SaidaDelegacao } from "../src/agent/tools";

const [botArg = "", pedido, conversaId = `cli-${crypto.randomUUID().slice(0, 8)}`] = process.argv.slice(2);
if (!ehBotId(botArg) || !pedido) {
  console.error(`Uso: bun scripts/conversa.ts <${Object.keys(BOTS).join("|")}> "<pedido>" [conversa-id]`);
  process.exit(1);
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
console.log(`bot ${botArg} · conversa ${conversaId}\n`);

/** Cada prévia traz a mensagem inteira do especialista; imprime só as partes que terminaram desde a última. */
const impressas = new Set<string>();
function progresso(saida: SaidaDelegacao) {
  const tag = `  [tarefa ${saida.tarefaId.slice(0, 8)}]`;
  if (saida.status !== "trabalhando" || !saida.mensagem) return;
  saida.mensagem.parts.forEach((part: UIMessage["parts"][number], i) => {
    const chave = `${saida.tarefaId}:${i}`;
    if (impressas.has(chave)) return;
    if (part.type === "text" && part.state === "done") {
      impressas.add(chave);
      console.log(`${tag} ${part.text}`);
    } else if (isToolUIPart(part) && (part.state === "output-available" || part.state === "output-error")) {
      if (part.state === "output-available" && part.preliminary) return;
      impressas.add(chave);
      const fim = part.state === "output-available" ? json(part.output) : part.errorText;
      console.log(`${tag} ${getToolName(part)} ${json(part.input)} -> ${fim}`);
    }
  });
}

const result = executar(botArg, conversaId, [{ role: "user", content: pedido }]);
let falhou = false;

for await (const part of result.stream) {
  switch (part.type) {
    case "text-delta":
      process.stdout.write(part.text);
      break;
    case "tool-call":
      console.log(`\n[tool-call] ${part.toolName} ${json(part.input)}`);
      break;
    case "tool-result":
      if (part.preliminary) progresso(part.output as SaidaDelegacao);
      else console.log(`[tool-result] ${part.toolName} ${json(part.output)}`);
      break;
    case "tool-error":
      console.log(`[tool-error] ${part.toolName} ${String(part.error)}`);
      break;
    case "tool-approval-request":
      console.log(`[aprovação pendente] ${part.toolCall.toolName} ${json(part.toolCall.input)}`);
      break;
    case "error":
      falhou = true;
      console.error(`\n[erro] ${part.error instanceof Error ? part.error.message : json(part.error)}`);
      break;
    case "finish":
      console.log(`\n\n[fim] ${part.finishReason} · ${json(part.totalUsage)}`);
      break;
  }
}

for (const t of tarefasDaConversa(conversaId)) {
  console.log(`[tarefa ${t.id.slice(0, 8)}] ${t.botId} · ${t.status} · ${t.resumo ?? t.erro ?? ""}`);
}

process.exit(falhou ? 1 : 0);
