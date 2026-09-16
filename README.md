# em-marketing

Agência multiagente de marketing da EM Vidros no Telegram: o Ricardo manda um tema, escolhe Feed, Stories ou os dois, revisa três prévias com botões, aprova e baixa o mestre. O registro fica no Linear; publicar no Instagram continua manual.

> Em 16/09/2026 o canal mudou no plano: um site com login substitui o Telegram, de
> pedido a entrega. O código ainda é o do Telegram. Fase 3 em
> `.specs/features/fabrica/DESIGN.md`.

- **Requisitos:** `docs/prd-agencia-multiagente.md` · **Desenho:** `.specs/features/agencia-multiagente/` · **Estado do projeto:** `.specs/project/`
- **Agência:** times e agentes em `agencia/` (marketing, operações, vendas)
- **Rodar:** `bun install && bun start` (variáveis em `.env.example`)
- **Provar sem rede e sem chave:** `bun run verificar`
- **Deploy:** push na `main` → GH Actions → ghcr → watchtower (srv-linx-01, `mkt.emvidros.com.br`)
