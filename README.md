# em-marketing

Agência multiagente de marketing da EM Vidros no Telegram: o Ricardo manda um tema, escolhe Feed, Stories ou os dois, revisa três prévias com botões, aprova e baixa o mestre. O registro fica no Linear; publicar no Instagram continua manual.

- **Requisitos:** `docs/prd-agencia-multiagente.md` · **Desenho:** `.specs/features/agencia-multiagente/` · **Estado do projeto:** `.specs/project/`
- **Agência:** times e agentes em `agencia/` (marketing, operações, vendas)
- **Rodar:** `bun install && bun start` (variáveis em `.env.example`)
- **Provar sem rede e sem chave:** `bun run verificar`
- **Deploy:** push na `main` → GH Actions → ghcr → watchtower (srv-linx-01, `mkt.emvidros.com.br`)
