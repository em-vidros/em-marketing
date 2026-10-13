# Refatoração: site + agente

Aberta em 2026-10-13. Substitui o canal Telegram por um site com bots especializados, no modelo do Grok. O brandbook continua normativo e as regras rígidas do `PROJECT.md` continuam valendo, exceto as que citam Telegram.

## Decisões do Henrique (2026-10-13)

- O site tem agentes especializados, cada um com papel fixo, escolhidos na barra lateral como os bots do Grok.
- Todo o código do Telegram sai. O site é o único canal.
- Cada bot declara o próprio modelo. O AI SDK resolve `provedor:modelo` por um registry.
- Login com better-auth, com allowlist de e-mails.

## Stack

- Bun 1.4 com `Bun.serve` e rotas nativas. HTML import empacota o front, sem Vite. O Elysia sai, porque `Bun.serve` e o handler do better-auth cobrem as rotas que existem.
- AI SDK 7 (`ai`, `@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/react`) e `zod` para os schemas das tools.
- better-auth 1.7 sobre o mesmo `bun:sqlite`.
- React 19, Tailwind 4, `motion`. Componentes de chat vêm do Beautiful UI; o resto vem do unlumen (shadcn) e do uiarc.
- Arte continua em `sharp` + Gemini imagem. O validador de marca não muda.

## Forma dos dados

O agente hoje guarda estado por `chat_id` do Telegram e as tools mandam mensagem direto para o chat. Na nova forma as tools devolvem dados tipados e o front decide como desenhar cada resultado.

```ts
type ModelId = `${"google" | "anthropic"}:${string}`;

type BotId = "post" | "legenda" | "agenda" | "fotos" | "reels";

interface Bot {
  id: BotId;
  nome: string;
  descricao: string;
  modelo: ModelId;
  instrucoes: () => string;            // system prompt, monta brandbook + tokens
  tools: readonly ToolName[];          // subconjunto do catálogo
  sugestoes: readonly string[];        // atalhos do composer
}

// Uma conversa pertence a um usuário e a um bot. As mensagens são UIMessage do AI SDK.
interface Conversa { id: string; userId: string; botId: BotId; titulo: string; postId: number | null }

// O post percorre estados fixos. A tool só roda se o estado permite.
type EtapaPost =
  | { etapa: "brief"; brief: Brief }
  | { etapa: "formato"; brief: Brief; formato: Formato }
  | { etapa: "headline"; ...; headline: string }
  | { etapa: "artes"; ...; artes: Arte[] }
  | { etapa: "escolhida"; ...; arte: Arte }
  | { etapa: "legenda"; ...; legenda: string }
  | { etapa: "registrado"; ...; linearId: string };
```

`publicar_agora` e `agendar_publicacao` usam `needsApproval` do AI SDK. A confirmação humana sai do prompt e vira um cartão de aprovação no chat.

Os bots iniciais:

| Bot | Faz | Tools |
|---|---|---|
| Post | Fluxo inteiro do pedido ao agendamento | todas |
| Legenda | Escreve e revisa legenda contra o capítulo 16 | escrever_legenda, validar_texto |
| Agenda | Fila, calendário editorial, cota de pilares | listar_agenda, status_do_mes, cancelar_agendamento, proximas_datas |
| Fotos | Banco de fotos reais, upload e catálogo | buscar_fotos, catalogar_foto |
| Reels | Pauta e roteiro de vídeo vertical (pendência 7) | montar_brief, roteiro_reel |

## Estrutura

```
src/
  domain/      art, caption, brand, fotos, scheduler, instagram, linear (sem Telegram)
  agent/       models.ts (registry), bots.ts, tools/*.ts, post.ts (máquina de estados)
  server/      index.ts (Bun.serve), auth.ts, chat.ts
  web/         index.html, app.tsx, components/
  db/
```

## Fases

Cada fase termina com `bun run check` verde e um commit.

1. **Subtrair.** Apagar Telegram (`src/telegram`, campos `chat_id`/`file_id`, webhook, `chat-local`). Mover os módulos de domínio para `src/domain`. Os testes de domínio continuam passando.
2. **Agente no AI SDK.** Registry de modelos, catálogo de tools com zod, bots, máquina de estados do post por conversa. Um script roda uma conversa sem front e imprime as partes de tool.
3. **Servidor.** `Bun.serve`, better-auth com allowlist, `/api/chat` em streaming, persistência das UIMessages, `/media/:id` atrás de sessão.
4. **Design.** Canvas com as telas: login, início com os bots, conversa, cartões de tool (brief, 3 artes, legenda, aprovação), agenda. apple-design ligado, porque o pedido é sentimento nativo de macOS.
5. **Front.** Implementar o canvas aprovado. Motion pelo `animate` com as molas do apple-design.
6. **Fechamento.** Scheduler e Instagram ligados ao novo estado, Dockerfile e compose atualizados, deploy em `mkt.emvidros.com.br`.
