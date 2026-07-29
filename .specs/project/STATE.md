# STATE

## Decisões
- 2026-07-29 — Spec = `docs/prd.md`; `.specs/` só orquestra fases, sem duplicar requisitos.
- 2026-07-29 — `GEMINI_API_KEY` local disponível em `~/code/work/agente-projetista/.env` (usar só para o spike; produção usa `/etc/emvidros/em-marketing.env`).

## Bloqueios
- **F1 (gate):** `gemini-3.1-flash-image` retorna 429 com `free_tier limit: 0` na chave atual — o modelo de imagem NÃO tem free tier neste projeto Google; precisa habilitar billing (ou usar chave de projeto com billing) e rodar `bun scripts/spike-arte.ts`. Auth e formato do request já validados (erro é de quota, não de schema); SDK 2.13.0 funciona sob Bun.
- F2+: falta `TELEGRAM_BOT_TOKEN` — Telegram Web só loga por QR code no celular, então só o Henrique consegue criar o bot no @BotFather. `TELEGRAM_ALLOWED_CHAT_IDS` depende disso.
- F4: falta app Meta + Page token — developers.facebook.com exige senha/2FA. Validar Story 1080×1920 em sandbox.
- F5: falta A record `mkt.emvidros.com.br` (DNS na Wix) + arquivo Caddy no servidor; falta secret `WATCHTOWER_TOKEN` no repo GitHub (o valor existe no servidor em `/etc/emvidros/watchtower.env`).

## `.env` local (2026-07-29, chmod 600, fora do git)
Preenchido via Playwright: `GEMINI_API_KEY` (chave "EM Marketing" já existente no projeto `gen-lang-client-0540020304`, validada), `LINEAR_API_KEY` (criada, escopada só ao time EM Vidros, validada), `LINEAR_LABEL_ID`, `TELEGRAM_WEBHOOK_SECRET` (gerado). Vazios: os 4 do Telegram/Instagram acima.
Validado de ponta a ponta com a chave real: `definir_headline` e `escrever_legenda` (82 palavras, 7 hashtags, `#EMVidros` primeira).

## Lições
- (vazio)

## Todos / Deferred
- Rotacionar token Telegram hardcoded em `~/code/personal/pai/claude-ricardo/Scheduled/*/SKILL.md` (achado do PRD §4.7).
- v1.1: carrossel, Reels, edição multi-turno via previous_interaction_id.
