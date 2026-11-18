# em-marketing

Agente de marketing da EM Vidros: gera 3 variações de arte (OpenAI `gpt-image-2.6-sunburst`), escreve legenda no tom da marca e publica/agenda no Instagram @emvidros.

- **Requisitos:** `docs/prd.md` · **Setup manual:** `docs/setup.md` · **Estado do projeto:** `.specs/project/`
- **Rodar:** `bun install && bun start` (variáveis em `.env.example`)
- **Conversa sem front:** `bun scripts/conversa.ts <post|legenda|agenda|fotos|reels> "pedido" [conversa-id]`
- **Spike de arte (gate da Fase 1):** `bun run spike`
- **Produção:** https://emvidros-marketing.vercel.app, publicado com `vercel deploy --prod` (projeto `emvidros-marketing`, time `emvidros`). Banco no Neon (projeto `em-marketing`), arquivos no Vercel Blob. Entra só conta Google @emvidros.com.br; os admins vêm de `ADMIN_EMAILS`.
- **EM Hub:** o assistente do Hub lê agenda, peças, pautas e artes por `/api/mcp`, com o token Ed25519 do Hub (`HUB_CHAVE_PUBLICA`).
- **Testes num Postgres real:** `TESTE_DATABASE_URL=<url> bun test --timeout 30000`
