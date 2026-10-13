// Roda um turno de um bot sem front e imprime o texto e as partes de tool.
//
// Uso: bun scripts/conversa.ts <bot> "<pedido>" [conversa-id]
// Repetir o mesmo conversa-id continua o post em andamento daquela conversa.
import { executar } from "../src/agent";
import { BOTS, ehBotId } from "../src/agent/bots";

const [botArg = "", pedido, conversaId = `cli-${crypto.randomUUID().slice(0, 8)}`] = process.argv.slice(2);
if (!ehBotId(botArg) || !pedido) {
  console.error(`Uso: bun scripts/conversa.ts <${Object.keys(BOTS).join("|")}> "<pedido>" [conversa-id]`);
  process.exit(1);
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
console.log(`bot ${botArg} · conversa ${conversaId}\n`);

const result = executar(botArg, conversaId, [{ role: "user", content: pedido }]);
let falhou = false;

for await (const part of result.fullStream) {
  switch (part.type) {
    case "text-delta":
      process.stdout.write(part.text);
      break;
    case "tool-call":
      console.log(`\n[tool-call] ${part.toolName} ${json(part.input)}`);
      break;
    case "tool-result":
      console.log(`[tool-result] ${part.toolName} ${json(part.output)}`);
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

process.exit(falhou ? 1 : 0);
