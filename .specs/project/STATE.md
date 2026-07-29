# STATE

## Decisões
- 2026-07-29 — Spec = `docs/prd.md`; `.specs/` só orquestra fases, sem duplicar requisitos.
- 2026-07-29 — `GEMINI_API_KEY` local disponível em `~/code/work/agente-projetista/.env` (usar só para o spike; produção usa `/etc/emvidros/em-marketing.env`).

## Bloqueios
- **F1 (gate):** `gemini-3.1-flash-image` retorna 429 com `free_tier limit: 0` na chave atual — o modelo de imagem NÃO tem free tier neste projeto Google; precisa habilitar billing (ou usar chave de projeto com billing) e rodar `bun scripts/spike-arte.ts`. Auth e formato do request já validados (erro é de quota, não de schema); SDK 2.13.0 funciona sob Bun.
- F2+: falta `TELEGRAM_BOT_TOKEN` (criar bot no BotFather).
- F4: falta app Meta + Page token; validar Story 1080×1920 em sandbox.
- F5: falta A record `mkt.emvidros.com.br` (DNS na Wix) + arquivo Caddy no servidor.

## Lições
- (vazio)

## Todos / Deferred
- Rotacionar token Telegram hardcoded em `~/code/personal/pai/claude-ricardo/Scheduled/*/SKILL.md` (achado do PRD §4.7).
- v1.1: carrossel, Reels, edição multi-turno via previous_interaction_id.
