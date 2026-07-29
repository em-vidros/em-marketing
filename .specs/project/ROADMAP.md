# Roadmap (espelha PRD §5.1)

> Status 2026-07-29: código de F0–F5 implementado e commitado. Gates que dependem de credenciais/infra externas pendentes — ver STATE.md § Bloqueios e docs/setup.md.

- [x] **F0 Brandbook** — `brand/` completo, logo branco, fontes, `styles/` portado (variantes 4:5 e 9:16). Gate: `tokens.json` bate com A.3; zero `#00A99D` / `code/personal`.
- [ ] **F1 Spike de arte** ⚠️ bloqueante — script gera 3 variações reais em ambos formatos JPEG com logo como referência. Gate: tabela 3.4, 3/3 nos dois formatos.
- [ ] **F2 Bot** — Elysia + webhook + cérebro function calling + pergunta de formato + aprovação 3 botões. Gate: US-1..US-4 ponta a ponta, incl. "Os dois".
- [ ] **F3 Linear** — issue, anexos, comentário, status. Gate: US-5.
- [ ] **F4 Instagram** — app Meta + Page token, `/media/:id`, publicar IMAGE e STORIES, scheduler. Gate: US-6 + teste Story em sandbox (ponto aberto 4.3).
- [ ] **F5 Produção** — Dockerfile, GH Actions → ghcr → watchtower, Caddy + DNS, cron do calendário. Gate: US-7; `/health` pelo subdomínio.
