# Setup — passos manuais (fora do código)

## 1. OpenAI (bloqueia a Fase 1)
- Criar uma chave em platform.openai.com com acesso a `gpt-6-luna` e `gpt-image-2.6-sunburst` e definir teto de gasto mensal.
- Validar: `OPENAI_API_KEY=... bun scripts/spike-arte.ts` → 6 JPEGs em `out/spike/`; conferir critérios da §3.4 do PRD.

## 2. Meta / Instagram (Facebook Login — Standard Access basta)
1. developers.facebook.com → criar app tipo Business.
2. Facebook Login → obter user token com `pages_show_list, instagram_basic, instagram_content_publish, pages_read_engagement, business_management`.
3. Trocar por long-lived, pegar o **Page token** da página facebook.com/emvidros (não expira) → `IG_PAGE_TOKEN`.
4. `GET /me/accounts` → page id → `GET /{page-id}?fields=instagram_business_account` → `IG_USER_ID`.
5. **Fase 4:** testar Story 1080×1920 em conta sandbox antes de fechar (ponto aberto §4.3 do PRD).

## 3. Servidor (srv-linx-01, `ssh emvidros`)
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

## 4. Verificação final
- `curl https://mkt.emvidros.com.br/health` → `{"ok":true}`.
