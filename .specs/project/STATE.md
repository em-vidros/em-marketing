# STATE

## Decisões
- 2026-07-29 — Spec = `docs/prd.md`; `.specs/` só orquestra fases, sem duplicar requisitos.
- 2026-07-29 — `GEMINI_API_KEY` local disponível em `~/code/work/agente-projetista/.env` (usar só para o spike; produção usa `/etc/emvidros/em-marketing.env`).
- 2026-07-31 — Publicação manual é o padrão (`PUBLISH_MODE`, commit `0042153`): o Instagram Graph sai do caminho crítico da v1 e F4 deixa de bloquear a entrega.
- 2026-07-31 — `[x]` no ROADMAP significa **gate validado**, nunca "código escrito". O status do código vai como anotação inline.
- 2026-08-24 — Portão de qualidade automático no pipeline de arte (`src/art/review.ts` + `generateWithQa`): cada imagem gerada passa por juiz multimodal `gemini-3.6-flash` contra os gates do §3.4 (paleta teal, logo fiel, grafia do headline, zonas seguras em stories, aderência ao brief), com veredito JSON. Reprovou → refinamento dirigido via `previous_interaction_id` (corrige só as violações, preserva o conceito). Teto por arte: `ART_MAX_ATTEMPTS`, default 3. Loop determinístico dentro do pipeline, não tool exposta ao cérebro — o cérebro só recebe o relatório. Gerador segue Nano Banana 2; julgador em outro tier para reduzir viés de autoavaliação. Custo pior caso: 9 gerações (~US$ 0,90) por pedido; esperado bem abaixo (juiz validado com JPEG sintético: reprova fundo teal liso sem logo/headline, como deve).

## Bloqueios
- **F1 (gate) — único bloqueio real.** `gemini-3.1-flash-image` retorna 429 com `free_tier limit: 0` na chave atual (reconfirmado em 2026-07-31); o modelo de imagem NÃO tem free tier neste projeto Google. Precisa habilitar billing (ou usar chave de projeto com billing) e rodar `bun scripts/spike-arte.ts`. Auth e formato do request já validados (erro é de quota, não de schema); SDK 2.13.0 funciona sob Bun.
  **Superfície travada:** `generateArt()` (`src/art/generate.ts:49`) é a única consumidora de `IMAGE_MODEL` (`:13`, chamada em `:59`). Cascata: `generate3Arts()`/`deriveStory()` → tools `gerar_3_artes` (`src/brain/index.ts:165`) e `derivar_story` (`:193`), mais `scripts/spike-arte.ts:44`. A jusante nada está quebrado, só sem insumo: callbacks `pick:`/`redo:` (`src/server.ts:33,36`), `attachJpeg` (`src/brain/index.ts:208`), `publishStep` (`src/publish/index.ts:23` lança "arte final não encontrada") e o scheduler. Todo o caminho de texto (`gemini-3.6-flash`) roda normalmente.
- **F2 (gate):** bot criado — `@em_marketing_bot`, token no `.env`, `getMe` ok em 2026-07-31. Faltam duas coisas self-serve: `TELEGRAM_ALLOWED_CHAT_IDS` não existe no `.env`, então a allowlist nasce vazia e `src/server.ts:22-23` descarta 100% dos updates em silêncio; e `setWebhook` nunca rodou (`getWebhookInfo` devolve `url: ""`).
- F4: falta app Meta + Page token — developers.facebook.com exige senha/2FA. Com `PUBLISH_MODE=manual`, isso bloqueia apenas o modo `auto`, não a v1. Validar Story 1080×1920 em sandbox.
- **F5 — provisionado em 2026-08-05, falta só o DNS.** Feito: `/etc/emvidros/em-marketing.env` (root:root 600, 11 chaves), `/opt/emvidros/em-marketing/` com o compose, container `em-marketing` no ar em `127.0.0.1:3010→3000` com as labels do watchtower, secret `WATCHTOWER_TOKEN` gravado, e o run `31024888167` **verde de ponta a ponta** (build → ghcr → watchtower 200).
  Resta: A record `mkt.emvidros.com.br` → 177.54.129.7 (DNS na Wix, só o dono da conta faz) e `/etc/caddy/sites/mkt.emvidros.com.br.caddy` com `reverse_proxy 127.0.0.1:3010`. Sem HTTPS público não dá para rodar o `setWebhook`, então F2 fica atrás disso.
  **Armadilha do watchtower:** se o container roda num image ID que sumiu do daemon (o build do CI retagueia o `:latest` e o anterior vira dangling), ele aborta com `Unable to update container: no available image info` — chamada devolve 200 e nada acontece. Cura: `docker compose up -d --force-recreate` para realinhar container e `:latest`. Depois disso o scan roda limpo.

## `.env` local (2026-07-31, chmod 600, fora do git)
9 chaves presentes; só `IG_PAGE_TOKEN` e `IG_USER_ID` continuam vazias. Preenchidos: `GEMINI_API_KEY` (chave "EM Marketing" no projeto `gen-lang-client-0540020304`, validada), `LINEAR_API_KEY` (escopada só ao time EM Vidros, validada), `LINEAR_LABEL_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `PUBLIC_BASE_URL`, `PORT`.
Ausentes do arquivo: `DB_PATH` e `PUBLISH_MODE` (defaults seguros — `data/em-marketing.db` e `manual`) e `TELEGRAM_ALLOWED_CHAT_IDS` (fail-closed, ver F2).
O `.env.example` que `e0205e3` diz ter criado não está no working tree: `.gitignore` tem `.env*`, então nunca foi versionado.
Validado de ponta a ponta com a chave real: `definir_headline` e `escrever_legenda` (82 palavras, 7 hashtags, `#EMVidros` primeira).

## Validado sem billing (2026-08-05)
Tudo que não passa por `IMAGE_MODEL` foi exercitado de verdade; quando a chave com billing chegar, só a chamada ao modelo de imagem segue não testada.
- **Normalização §3.3** — PNG sintético no tamanho real do NB2 2K → `1856×2304 → 1080×1350` (ratio 0.8000) e `1536×2752 → 1080×1920` (ratio 0.5625), JPEG q90 sRGB, muito abaixo de 8 MB. A parte determinística do pipeline de arte está provada.
- **Prompts** — os 6 estilos × 2 formatos renderizam sem placeholder solto; os tipos de `styles/map.json` batem com o enum de `montar_brief`.
- **Texto (`gemini-3.6-flash`)** — `definir_headline` (feed e stories) e `escrever_legenda`: 77 palavras, 7 hashtags, `#EMVidros` primeira. Passa os gates automáticos de §3.4.
- **Linear** — chave, time `EM Vidros` (EMV) e `LINEAR_LABEL_ID` resolvem (query read-only, sem criar issue).
- **Servidor** — sobe limpo; `/health` ok, `/media/:id` inexistente → 404, webhook devolve 401 sem header, com secret errado e com secret errado do mesmo tamanho (caminho do `timingSafeEqual`); update de chat fora da allowlist é descartado; as 6 tabelas SQLite nascem no boot.
- **Timezone** — `saoPauloInstant` faz as 4 formas (naive, com espaço, com offset, em Z) convergirem no mesmo instante e rejeita texto inválido.

## Lições
- 2026-07-31 — Isolar a chamada do modelo numa fronteira única (`generateArt`) fez o bloqueio de billing custar uma função em vez do sistema inteiro: F2, F3 e F5 seguiram entregáveis.
- 2026-08-05 — Dá para validar quase todo o pipeline de arte sem o modelo: injetar um PNG do tamanho exato que o NB2 devolve exercita resize/crop/JPEG/sRGB de ponta a ponta. O que sobra sem prova é só a qualidade da imagem, que é justamente o que precisa de olho humano.

## Todos / Deferred
- Rotacionar token Telegram hardcoded em `~/code/personal/pai/claude-ricardo/Scheduled/*/SKILL.md` (achado do PRD §4.7).
- v1.1: carrossel, Reels, edição multi-turno via previous_interaction_id.
