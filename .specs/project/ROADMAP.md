# Roadmap (espelha PRD §5.1)

> Status 2026-08-05: código de F0–F5 implementado e commitado. `[x]` aqui significa **gate validado**, não código escrito — por isso só F0 está fechada. Tudo que não depende do modelo de imagem já foi exercitado de verdade (STATE.md § Validado sem billing). Ver STATE.md § Bloqueios e docs/setup.md.

- [x] **F0 Brandbook** — `brand/` completo, logo branco, fontes, `styles/` portado (variantes 4:5 e 9:16). Gate: `tokens.json` bate com A.3; zero `#00A99D` / `code/personal`.
- [ ] **F1 Spike de arte** ⚠️ bloqueante — código ✅ · gate ⛔ billing do modelo de imagem. Script gera 3 variações reais em ambos formatos JPEG com logo como referência. Gate: tabela 3.4, 3/3 nos dois formatos.
- [ ] **F2 Bot** — código ✅ · gate ⏳ falta `TELEGRAM_ALLOWED_CHAT_IDS` + `setWebhook` (e as artes, que dependem de F1). Elysia + webhook + cérebro function calling + pergunta de formato + aprovação 3 botões. Gate: US-1..US-4 ponta a ponta, incl. "Os dois".
- [ ] **F3 Linear** — código ✅ · gate ⏳ issue e comentário já rodam; o anexo depende de arte (F1). Gate: US-5.
- [ ] **F4 Instagram** — código ✅ · gate ⏳ falta app Meta + Page token; com `PUBLISH_MODE=manual` o gate vale só para o modo `auto`. `/media/:id`, publicar IMAGE e STORIES, scheduler. Gate: US-6 + teste Story em sandbox (ponto aberto 4.3).
- [ ] **F5 Produção** — código ✅ · CI/CD ✅ verde ponta a ponta · container no ar em `127.0.0.1:3010` ✅ · gate ⏳ falta só DNS + Caddy para `/health` responder pelo subdomínio. Dockerfile, GH Actions → ghcr → watchtower, Caddy + DNS, cron do calendário. Gate: US-7; `/health` pelo subdomínio.
