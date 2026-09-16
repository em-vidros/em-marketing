# STATE

## Decisões
- 2026-07-29 — Spec = `docs/prd.md`; `.specs/` só orquestra fases, sem duplicar requisitos.
- 2026-07-29 — `GEMINI_API_KEY` local disponível em `~/code/work/agente-projetista/.env` (usar só para o spike; produção usa `/etc/emvidros/em-marketing.env`).
- 2026-07-31 — Publicação manual é o padrão (`PUBLISH_MODE`, commit `0042153`): o Instagram Graph sai do caminho crítico da v1 e F4 deixa de bloquear a entrega.
- 2026-07-31 — `[x]` no ROADMAP significa **gate validado**, nunca "código escrito". O status do código vai como anotação inline.
- 2026-08-24 — Portão de qualidade automático no pipeline de arte (`src/art/review.ts` + `generateWithQa`): cada imagem gerada passa por juiz multimodal `gemini-3.6-flash` contra os gates do §3.4 (paleta teal, logo fiel, grafia do headline, zonas seguras em stories, aderência ao brief), com veredito JSON. Reprovou → refinamento dirigido via `previous_interaction_id` (corrige só as violações, preserva o conceito). Teto por arte: `ART_MAX_ATTEMPTS`, default 3. Loop determinístico dentro do pipeline, não tool exposta ao cérebro — o cérebro só recebe o relatório. Gerador segue Nano Banana 2; julgador em outro tier para reduzir viés de autoavaliação. Custo pior caso: 9 gerações (~US$ 0,90) por pedido; esperado bem abaixo (juiz validado com JPEG sintético: reprova fundo teal liso sem logo/headline, como deve).

- 2026-08-25 — **Agência multiagente (`docs/prd-agencia-multiagente.md`) passa a ser a fonte de verdade** da separação por agente e dos fluxos de aprovação; `docs/prd.md` continua como registro da v1 do bot. Fase 1 ("Fundação do MVP") entregue e provada sem nenhuma chave de API: plano de controle como único dono do estado, as duas máquinas do §4.3 e §4.4 como tabela de transição com `transicionar()` de chokepoint único, fila com lease e época, artefatos imutáveis endereçados por conteúdo, e aprovação presa ao Telegram do Ricardo com recusa de rodada vencida. Plano e design em `.specs/features/agencia-multiagente/`.

- 2026-09-15. O em-marketing passa a ser a fábrica de conteúdo da agência interna da EM Vidros, e ganha um site que mostra cada pedido andando pelas etapas num canvas infinito (PRD US-10 e §4.13). O site roda no próprio servidor, é publicado só em `127.0.0.1` e abre só pela Tailscale, que já está ativa no servidor (`emvidros-srv.tail585ce3.ts.net`) e no MacBook do Henrique. Falta ligar os certificados HTTPS da tailnet (`CertDomains: null`). A Vercel foi descartada porque o estado mora no SQLite do plano de controle neste servidor, e um front hospedado fora exigiria expor a API de leitura na internet. O banco continua o SQLite do plano de controle, e o site não tem banco próprio. Entra como Fase 3, antes do blog, porque se prova sem chave de modelo. Só documentado, nada implementado.

- 2026-09-16. O site passa a ser o único canal e o Telegram sai inteiro, de pedido a entrega (PRD, revisão de 16/09). Quem usa entra com e-mail e senha pelo better-auth, que é o padrão da casa para app em Bun, e o papel da conta (`solicitante`, `aprovador`, `admin`) decide o que aparece. Endereço público pelo Tailscale Funnel no primeiro momento, porque o ACME do wildcard `*.emvidros.com.br` falha nos dois desafios desde agosto e trava `mkt.emvidros.com.br`. Recusei hospedar a tela na Vercel: tela e API em domínios diferentes fazem o cookie de sessão virar cookie de terceiro, que o Safari bloqueia, e o Ricardo usa iPhone. Aviso externo (WhatsApp ou e-mail) fica fora desta fase por escolha do Henrique. Só documentado, nada implementado.
- 2026-09-16. Bun sempre na última versão, no host e nas imagens, decisão do Henrique. Host subiu de 1.4.0 para 1.4.2 e `bun run verificar` passou nas 13 suítes em 54,6 s. Os pins que sobram no parque: `em-marketing/Dockerfile:4` em `oven/bun:1.3-slim`, `agente-projetista/Dockerfile:6,12` em `1.3.1-slim` nos dois clones, e o template `scripts/templates/ts-monorepo/Dockerfile` em `1-alpine`.

## Bloqueios
- **F1 (gate) — único bloqueio real.** `gemini-3.1-flash-image` retorna 429 com `free_tier limit: 0` na chave atual (reconfirmado em 2026-07-31); o modelo de imagem NÃO tem free tier neste projeto Google. Precisa habilitar billing (ou usar chave de projeto com billing) e rodar `bun scripts/spike-arte.ts`. Auth e formato do request já validados (erro é de quota, não de schema); SDK 2.13.0 funciona sob Bun.
  **Superfície travada:** `generateArt()` (`src/art/generate.ts:49`) é a única consumidora de `IMAGE_MODEL` (`:13`, chamada em `:59`). Cascata: `generate3Arts()`/`deriveStory()` → tools `gerar_3_artes` (`src/brain/index.ts:165`) e `derivar_story` (`:193`), mais `scripts/spike-arte.ts:44`. A jusante nada está quebrado, só sem insumo: callbacks `pick:`/`redo:` (`src/server.ts:33,36`), `attachJpeg` (`src/brain/index.ts:208`), `publishStep` (`src/publish/index.ts:23` lança "arte final não encontrada") e o scheduler. Todo o caminho de texto (`gemini-3.6-flash`) roda normalmente.
- **F2 (gate):** bot criado — `@em_marketing_bot`, token no `.env`, `getMe` ok em 2026-07-31. Faltam duas coisas self-serve: `TELEGRAM_ALLOWED_CHAT_IDS` não existe no `.env`, então a allowlist nasce vazia e `src/server.ts:22-23` descarta 100% dos updates em silêncio; e `setWebhook` nunca rodou (`getWebhookInfo` devolve `url: ""`).
- F4: falta app Meta + Page token — developers.facebook.com exige senha/2FA. Com `PUBLISH_MODE=manual`, isso bloqueia apenas o modo `auto`, não a v1. Validar Story 1080×1920 em sandbox.
- **F5 — provisionado em 2026-08-05, falta só o DNS.** Feito: `/etc/emvidros/em-marketing.env` (root:root 600, 11 chaves), `/opt/emvidros/em-marketing/` com o compose, container `em-marketing` no ar em `127.0.0.1:3010→3000` com as labels do watchtower, secret `WATCHTOWER_TOKEN` gravado, e o run `31024888167` **verde de ponta a ponta** (build → ghcr → watchtower 200).
  Resta: A record `mkt.emvidros.com.br` → 170.247.31.241 (o IP de entrada; 177.54.129.7 é o de saída e foi o registro errado até 2026-08-28) (DNS na Wix, só o dono da conta faz) e `/etc/caddy/sites/mkt.emvidros.com.br.caddy` com `reverse_proxy 127.0.0.1:3010`. Sem HTTPS público não dá para rodar o `setWebhook`, então F2 fica atrás disso.
  **Armadilha do watchtower:** se o container roda num image ID que sumiu do daemon (o build do CI retagueia o `:latest` e o anterior vira dangling), ele aborta com `Unable to update container: no available image info` — chamada devolve 200 e nada acontece. Cura: `docker compose up -d --force-recreate` para realinhar container e `:latest`. Depois disso o scan roda limpo.

## `.env` local (2026-07-31, chmod 600, fora do git)
9 chaves presentes; só `IG_PAGE_TOKEN` e `IG_USER_ID` continuam vazias. Preenchidos: `GEMINI_API_KEY` (chave "EM Marketing" no projeto `gen-lang-client-0540020304`, validada), `LINEAR_API_KEY` (escopada só ao time EM Vidros, validada), `LINEAR_LABEL_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `PUBLIC_BASE_URL`, `PORT`.
Ausentes do arquivo: `DB_PATH` e `PUBLISH_MODE` (defaults seguros — `data/em-marketing.db` e `manual`) e `TELEGRAM_ALLOWED_CHAT_IDS` (fail-closed, ver F2).
`.env.example` existe desde 2026-08-25, versionado com `git add -f` porque o `.gitignore` tem `.env*`. Lista também as variáveis novas: `APROVADOR_TELEGRAM_ID`, `ADAPTADORES`, `DEEPSEEK_API_KEY`, `ARTIFACTS_DIR`.
Validado de ponta a ponta com a chave real: `definir_headline` e `escrever_legenda` (82 palavras, 7 hashtags, `#EMVidros` primeira).

## Validado sem billing (2026-08-05)
Tudo que não passa por `IMAGE_MODEL` foi exercitado de verdade; quando a chave com billing chegar, só a chamada ao modelo de imagem segue não testada.
- **Normalização §3.3** — PNG sintético no tamanho real do NB2 2K → `1856×2304 → 1080×1350` (ratio 0.8000) e `1536×2752 → 1080×1920` (ratio 0.5625), JPEG q90 sRGB, muito abaixo de 8 MB. A parte determinística do pipeline de arte está provada.
- **Prompts** — os 6 estilos × 2 formatos renderizam sem placeholder solto; os tipos de `styles/map.json` batem com o enum de `montar_brief`.
- **Texto (`gemini-3.6-flash`)** — `definir_headline` (feed e stories) e `escrever_legenda`: 77 palavras, 7 hashtags, `#EMVidros` primeira. Passa os gates automáticos de §3.4.
- **Linear** — chave, time `EM Vidros` (EMV) e `LINEAR_LABEL_ID` resolvem (query read-only, sem criar issue).
- **Servidor** — sobe limpo; `/health` ok, `/media/:id` inexistente → 404, webhook devolve 401 sem header, com secret errado e com secret errado do mesmo tamanho (caminho do `timingSafeEqual`); update de chat fora da allowlist é descartado; as 6 tabelas SQLite nascem no boot.
- **Timezone** — `saoPauloInstant` faz as 4 formas (naive, com espaço, com offset, em Z) convergirem no mesmo instante e rejeita texto inválido.


## Fase 1 da agência — provada em 2026-08-25, sem chave de API
`bun run verificar` roda 10 suítes em ~18 s, sem rede e sem `.env`. O CI segura o build atrás disso.
- **Predicado 1 (reinício).** Os 31 estados dos dois alfabetos, um a um: processo filho leva o fluxo até o estado e morre de **SIGKILL** sem fechar o banco, para a recuperação do WAL ser real. Na volta confere estado preservado, tarefa exigida por `TAREFA_DO_ESTADO` viva e sem duplicata, e reconciliar de novo sem efeito. Conferido contra sabotagem: tirar `garantirTarefa` de um estado deixa o arnês vermelho.
- **Predicado 2 (aprovação vencida).** Botão de rodada anterior é recusado, intruso cai em `nao_autorizado` sem escrever linha, duplo toque vira uma decisão só, e o reconciliador não tem aresta que entre ou saia de `awaiting_*`.
- **Predicado 3 (entrega única).** Rodar a mesma entrega duas vezes manda um documento só, com o SHA-256 do ida e volta conferido contra o mestre. Morrer entre o envio e o recibo deixa a entrega `indeterminada` com aviso, nunca reenvio calado.
- **Fronteira.** `bun:sqlite` só em `src/controle/db.ts`, SDK de modelo só em `src/adaptadores/`, e `UPDATE` proibido em `events`, `approvals` e `artifact_versions`. Conferido contra violação plantada.

## Fase 2 da agência — código fechado em 2026-08-28, gate aberto
Desenho em `.specs/features/agencia-multiagente/DESIGN-fase2.md`, revisado por um crítico antes de implementar (7 furos fechados, entre eles recusar todas indo para o estado errado e o laço de QA sem fim com o designer falso). `bun run verificar` roda 13 suítes em ~60 s; as três novas são `adaptadores` (parse e prompts sem rede), `workers` (o caminho inteiro com fakes, sete casos) e `ponta-a-ponta` (o loop do Ricardo dirigido por updates sintéticos do Telegram, 14 passadas).
- O bot v1 saiu da árvore (`src/brain`, `art`, `caption`, `publish`, `db`, `instagram`, `scheduler`, `linear`, `telegram/api.ts`, `scripts/spike-arte.ts`, `styles/map.json`). A migração 003 apaga as cinco tabelas dele no boot, logando a contagem.
- `src/server.ts` é só HTTP; a conversa mora em `src/telegram/conversa.ts` como tabela etapa × evento; os workers em `src/workers/`; os adaptadores reais em `src/adaptadores/{deepseek,gemini,telegram,linear}.ts`.
- Perfis: `fake` (arnês), `ensaio` (modelos falsos, Telegram real; é o que produção deve usar), `real` (exige `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `LINEAR_API_KEY`, `LINEAR_LABEL_ID`).
- `/etc/emvidros/em-marketing.env` ainda não tem `ADAPTADORES`, então o container sobe em `fake`. Falta `ADAPTADORES=ensaio` e `ARTIFACTS_DIR=data/artefatos` (trecho em `/tmp/em-mkt-fase2/env-fase2.txt`; o classificador barra escrita em `/etc`). As variáveis de Telegram desse arquivo perdem o sentido na Fase 3.

## Bloqueios da Fase 2 (gate)
- **Certificado do domínio.** Em 2026-09-16 o DNS já está certo (170.247.31.241) e o vhost e a entrada em `/etc/caddy/allowed-hosts` existem, mas o ACME falha nos dois desafios para o wildcard inteiro: tls-alpn-01 devolve `unrecognized name` e http-01 devolve 404 no `.well-known` (journal do Caddy, 2026-09-16 11:31). `comissoes`, `chatwoot` e `status` estão no mesmo estado, então o problema é da borda 80/443, que o Caddyfile diz chegar por um proxy acima, e não deste projeto. Por isso a Fase 3 nasce no Tailscale Funnel.
- ~~**Telegram ID do Ricardo** e allowlist de chat.~~ Sem efeito desde 2026-09-16: o canal virou o site com login, e o que trava a aprovação passa a ser a conta dele.
- **Chave da DeepSeek** e **billing do Gemini** para o modelo de imagem. Até lá, `ensaio` roda o loop com arte falsa.
- **Benchmark de dez temas** (§3.5) e o pedido real do Ricardo pelo celular: são a comprovação da fase e dependem de tudo acima.

## Lições
- 2026-07-31 — Isolar a chamada do modelo numa fronteira única (`generateArt`) fez o bloqueio de billing custar uma função em vez do sistema inteiro: F2, F3 e F5 seguiram entregáveis.
- 2026-08-05 — Dá para validar quase todo o pipeline de arte sem o modelo: injetar um PNG do tamanho exato que o NB2 devolve exercita resize/crop/JPEG/sRGB de ponta a ponta. O que sobra sem prova é só a qualidade da imagem, que é justamente o que precisa de olho humano.

- 2026-08-25 — Delegar duas correntes na mesma árvore de trabalho custa caro: um agente rodou `git add` da árvore inteira apesar da diretiva de caminho explícito e levou junto cinco arquivos do outro, e as duas correntes escreveram duas contas diferentes de `brandVersionId` para a mesma árvore. Da próxima vez, um worktree por corrente.
- 2026-08-28 — Crítico antes do código paga: um passe de leitura sobre o `DESIGN-fase2.md` achou sete furos que só apareceriam com o Ricardo no celular (recusar todas criava a tarefa do designer, não do diretor criativo; o laço de QA nunca fechava porque o dedupe por conteúdo devolvia a mesma versão). Custou 6 minutos.
- 2026-08-28 — Worktree de agente nasce em `origin/main`, não na `main` local: três agentes começaram 2 e 16 commits atrás. Antes de delegar, empurrar a `main` ou dar `merge --ff-only main` dentro do worktree.
- 2026-08-25 — Rodar o arnês dentro da imagem, e não só no shell da máquina, é o que achou o fontconfig: sem ele o `resvg` cai num fallback e a mesma entrada devolve bytes diferentes. Portão que só roda num ambiente não prova o outro.

## Todos / Deferred
- Rotacionar token Telegram hardcoded em `~/code/personal/pai/claude-ricardo/Scheduled/*/SKILL.md` (achado do PRD §4.7).
- v1.1: carrossel, Reels, edição multi-turno via previous_interaction_id.
