# em-marketing

Agente de marketing da EM Vidros no Telegram: gera 3 variações de arte (Gemini Nano Banana 2), escreve legenda no tom da marca, registra no Linear e publica/agenda no Instagram @emvidros.

- **Requisitos:** `docs/prd.md` · **Setup manual:** `docs/setup.md` · **Estado do projeto:** `.specs/project/`
- **Rodar:** `bun install && bun start` (variáveis em `.env.example`)
- **Spike de arte (gate da Fase 1):** `bun run spike`
- **Deploy:** push na `main` → GH Actions → ghcr → watchtower (srv-linx-01, `mkt.emvidros.com.br`)
