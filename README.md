# em-marketing

Agente de marketing da EM Vidros: gera 3 variações de arte (OpenAI `gpt-image-2.6-sunburst`), escreve legenda no tom da marca e publica/agenda no Instagram @emvidros.

- **Requisitos:** `docs/prd.md` · **Setup manual:** `docs/setup.md` · **Estado do projeto:** `.specs/project/`
- **Rodar:** `bun install && bun start` (variáveis em `.env.example`)
- **Conversa sem front:** `bun scripts/conversa.ts <post|legenda|agenda|fotos|reels> "pedido" [conversa-id]`
- **Spike de arte (gate da Fase 1):** `bun run spike`
- **Deploy:** push na `main` → GH Actions → ghcr → watchtower (srv-linx-01, `mkt.emvidros.com.br`)
