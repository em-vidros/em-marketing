# Operações

Faz a agência rodar: publica no horário e mantém o deploy de pé. O
marketing entrega a peça; operações garante que ela foi ao ar.

- Publicação: Instagram Graph API com scheduler próprio (a Meta não agenda;
  o container de mídia expira em 24h)
- Infra: Bun + Elysia em Docker, CI/CD ghcr → watchtower, `/health` no
  subdomínio `mkt.emvidros.com.br`

Agentes:

- [publicador](agentes/publicador.md) — leva a peça aprovada ao ar
