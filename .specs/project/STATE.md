# STATE

## Decisões
- 2026-07-29 — Spec = `docs/prd.md`; `.specs/` só orquestra fases, sem duplicar requisitos.
- 2026-07-29 — `GEMINI_API_KEY` local disponível em `~/code/work/agente-projetista/.env` (usar só para o spike; produção usa `/etc/emvidros/em-marketing.env`).

## Bloqueios
- F2+: falta `TELEGRAM_BOT_TOKEN` (criar bot no BotFather).
- F4: falta app Meta + Page token; validar Story 1080×1920 em sandbox.
- F5: falta A record `mkt.emvidros.com.br` (DNS na Wix) + arquivo Caddy no servidor.

## Lições
- (vazio)

## Todos / Deferred
- Rotacionar token Telegram hardcoded em `~/code/personal/pai/claude-ricardo/Scheduled/*/SKILL.md` (achado do PRD §4.7).
- v1.1: carrossel, Reels, edição multi-turno via previous_interaction_id.
