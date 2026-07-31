# Tasks (spec: docs/prd.md · design: PRD §3–4)

> Tarefa de implementação fecha quando o artefato existe; tarefa de validação fecha quando o gate passa.

## F0 Brandbook
- [x] T0.1 `brand/BRANDBOOK.md` (Anexo A materializado)
- [x] T0.2 `brand/tokens.json` (paleta A.3, formatos, zonas seguras)
- [x] T0.3 `brand/voice.md` (A.6 + few-shots)
- [x] T0.4 `brand/calendario.md` (A.7 com datas/regras)
- [x] T0.5 Copiar logo oficial → `brand/assets/logo-cor.png`; produzir `logo-branco.png`
- [x] T0.6 Baixar Montserrat + Inter → `brand/assets/fonts/`
- [x] T0.7 Portar 6 estilos → `styles/` com correções (teal, logo, assinaturas visuais) e variantes 4:5/9:16
- [x] T0.8 Verificar gate: `grep -r '#00A99D\|code/personal'` vazio

## F1 Spike (bloqueante)
- [x] T1.1 `bun init` + deps (`@google/genai`, `sharp`, `elysia`)
- [x] T1.2 `scripts/spike-arte.ts`: headline → 3 gerações ∥ → resize/crop → JPEG, para 4:5 e 9:16
- [ ] T1.3 Rodar com brief "Dia do Vidraceiro 18/05"; validar tabela 3.4 (dimensão, formato, tamanho via script; visual → humano)

## F2 Bot
- [x] T2.1 `src/db/` schema SQLite (conversas, posts, fila)
- [x] T2.2 `src/telegram/` client (sendMessage, sendChatAction, media group, inline keyboards, webhook parse)
- [x] T2.3 `src/brain/` — system prompt (brandbook+voice+tokens), tools §3.2, invariantes
- [x] T2.4 `src/art/` pipeline reutilizando o spike; `src/caption/`
- [x] T2.5 `src/server.ts` Elysia: `/webhooks/telegram` (secret timingSafeEqual, parse none), `/media/:id`, `/health`; allowlist
- [x] T2.6 Fluxo aprovação: botões v1/v2/v3/refazer/reescrever-legenda; caminho "Os dois" (derivar_story com previous_interaction_id)

## F3 Linear
- [x] T3.1 `src/linear/` — criar/atualizar issue (team ec0c88f8…, label Instagram Post), upload anexos, comentário legenda/brief, mover status

## F4 Instagram
- [x] T4.1 `src/instagram/` — container → polling FINISHED → publish; IMAGE e STORIES; content_publishing_limit
- [x] T4.2 `src/scheduler/` — fila SQLite, tick 30s, timezone America/Sao_Paulo, aviso de falha no Telegram; `/agenda`, cancelar
- [ ] T4.3 Teste Story sandbox (manual, precisa credenciais)

## F5 Produção
- [x] T5.1 Dockerfile + compose.yml (labels watchtower)
- [x] T5.2 `.github/workflows/deploy.yml` (ghcr + webhook watchtower)
- [x] T5.3 Cron do calendário editorial (US-7)
- [x] T5.4 Docs de setup: DNS, Caddy, env, BotFather, Meta app
