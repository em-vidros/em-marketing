# em-marketing

**Visão:** fábrica de conteúdo da EM Vidros num site com login. Pede-se um post em linguagem natural, os agentes geram 3 variações de arte (Nano Banana 2) e a legenda no tom da marca, a pessoa aprova e baixa pelo site, e o trabalho fica registrado no Linear. Publicar no Instagram é manual. Até 16/09/2026 a visão era um bot no Telegram; o canal mudou e o código ainda é o antigo.

**Fonte de verdade dos requisitos:** `docs/prd.md` (não duplicar aqui).

**Stack:** Bun 1.3 + Elysia 1.4.29 · `@google/genai@2.13.0` (`gemini-3.6-flash` cérebro, `gemini-3.1-flash-image` arte) · SQLite (`bun:sqlite`) · Linear API · Instagram Graph API (Facebook Login, Page token) · Docker + watchtower em srv-linx-01, subdomínio `mkt.emvidros.com.br`.

**Restrições rígidas:**
- Teal correto `#2C7A75` — nunca `#00A99D`
- Headline gerado ANTES da imagem (doc oficial Gemini)
- Feed 1080×1350 / Stories 1080×1920, JPEG sRGB < 8 MB (pipeline resize+crop de 3.3)
- Stories não têm legenda; `escrever_legenda` nunca roda com formato=stories
- Publicação sempre com confirmação humana + allowlist de chat IDs
- Container de mídia da Meta criado só na hora de publicar (expira em 24h)
