# em-marketing

**Visão:** fábrica de conteúdo da EM Vidros num site com login. Pede-se um post em linguagem natural, os agentes geram 3 variações de arte (Nano Banana 2) e a legenda no tom da marca, a pessoa aprova e baixa pelo site, e o trabalho fica registrado no Linear. Publicar no Instagram é manual. Até 16/09/2026 a visão era um bot no Telegram; o canal mudou e o código ainda é o antigo.

**Fonte de verdade dos requisitos:** `docs/prd.md` (não duplicar aqui).
**Fonte de verdade da marca:** `brand/BRANDBOOK.md` — normativo, vence o PRD em qualquer divergência. O Anexo A do PRD foi superado em 11/08/2026.

**Stack:** Bun 1.3 + Elysia 1.4.29 · `@google/genai@2.13.0` (`gemini-3.6-flash` cérebro, `gemini-3.1-flash-image` arte) · SQLite (`bun:sqlite`) · Linear API · Instagram Graph API (Facebook Login, Page token) · Docker + watchtower em srv-linx-01, subdomínio `mkt.emvidros.com.br`.

**Restrições rígidas:**
- Paleta: só `#2F646A` (primária), `#63B5AF` (accent), `#414141` (texto) e as neutras do §4.1. `#00A99D`, `#32A999` e `#2C7A75` estão descontinuados
- Tipografia: Poppins no sistema, Playfair Display só em headline de MARCA e GENTE (§5.2)
- Todo post declara um pilar (§12.1) e datas comemorativas passam na trava do §12.4
- IA não representa produto, obra, fábrica nem pessoas da EM Vidros (§8.2) — isso é foto real
- Legenda e headline são validados em código contra o checklist do capítulo 16
- Headline gerado ANTES da imagem (doc oficial Gemini)
- Feed 1080×1350 / Stories 1080×1920, JPEG sRGB < 8 MB (pipeline resize+crop de 3.3)
- Stories não têm legenda; `escrever_legenda` nunca roda com formato=stories
- Publicação sempre com confirmação humana + allowlist de chat IDs
- Container de mídia da Meta criado só na hora de publicar (expira em 24h)
