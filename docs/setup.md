# Setup — passos manuais (fora do código)

## 1. Google AI (bloqueia a Fase 1)
- A chave atual retorna 429 `free_tier limit: 0` para `gemini-3.1-flash-image` — **habilitar billing** no projeto do AI Studio (ou usar chave de projeto com billing) e definir teto de gasto mensal.
- Validar: `GEMINI_API_KEY=... bun scripts/spike-arte.ts` → 6 JPEGs em `out/spike/`; conferir critérios da §3.4 do PRD.

## 2. Telegram
1. @BotFather → `/newbot` → guardar `TELEGRAM_BOT_TOKEN`.
2. Gerar `TELEGRAM_WEBHOOK_SECRET` (ex.: `openssl rand -hex 32`).
3. Depois do deploy: `curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://mkt.emvidros.com.br/webhooks/telegram&secret_token=$SECRET"`.
4. Descobrir os chat IDs do time (mandar msg ao bot e ler `getUpdates`) → `TELEGRAM_ALLOWED_CHAT_IDS`.

## 3. Meta / Instagram (Facebook Login — Standard Access basta)
1. developers.facebook.com → criar app tipo Business.
2. Facebook Login → obter user token com `pages_show_list, instagram_basic, instagram_content_publish, pages_read_engagement, business_management`.
3. Trocar por long-lived, pegar o **Page token** da página facebook.com/emvidros (não expira) → `IG_PAGE_TOKEN`.
4. `GET /me/accounts` → page id → `GET /{page-id}?fields=instagram_business_account` → `IG_USER_ID`.
5. **Fase 4:** testar Story 1080×1920 em conta sandbox antes de fechar (ponto aberto §4.3 do PRD).

## 4. Linear
- Criar API key pessoal → `LINEAR_API_KEY`.
- Pegar o id completo da label "Instagram Post" → `LINEAR_LABEL_ID` (o PRD só registra o prefixo `5a33b4dc-…`).

## 5. Servidor (srv-linx-01, `ssh emvidros`)
1. DNS (Wix): A record `mkt.emvidros.com.br` → `177.54.129.7`.
2. `/etc/caddy/sites/mkt.emvidros.com.br.caddy`:
   ```
   mkt.emvidros.com.br {
       reverse_proxy 127.0.0.1:3010
   }
   ```
   e `systemctl reload caddy`.
3. `/etc/emvidros/em-marketing.env` com as variáveis de `.env.example`, `chmod 600`.
4. `/opt/emvidros/em-marketing/` com o `compose.yml` (espelhar agente-projetista) → `docker compose up -d`.
5. GitHub: repo `em-vidros/em-marketing`, secret `WATCHTOWER_TOKEN`; push na `main` builda e o watchtower recria o container.

## 6. Verificação final
- `curl https://mkt.emvidros.com.br/health` → `{"ok":true}`.
- Mandar "cria um post pro dia do vidraceiro" no bot e percorrer o fluxo completo.
