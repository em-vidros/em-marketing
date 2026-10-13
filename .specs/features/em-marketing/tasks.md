# Tasks (spec: docs/prd.md · design: PRD §3–4)

## F0 Brandbook
> Refeita em 11/08/2026. As tasks originais materializavam o Anexo A do PRD, que foi superado pelo brandbook canônico — ver `.specs/project/STATE.md` e `PENDENCIAS.md`.
- [x] T0.1 `brand/BRANDBOOK.md` — brandbook canônico (Direção 2026 v1.0), não o resumo do Anexo A
- [x] T0.2 `brand/tokens.json` — digesto legível por máquina do brandbook (paleta §4.1, tipografia §5, grade §6, textura §7, pilares §12, cadência §13)
- [x] T0.3 ~~`brand/voice.md`~~ — **apagado**. A voz é o §9–§11 do brandbook, fatiado por `src/brand/index.ts`
- [x] T0.4 `brand/calendario.md` — 8 datas, todas justificadas pela trava do §12.4
- [x] T0.5 Logos oficiais → `brand/assets/logo/` (5 SVG + 2 PNG, incluindo a branca oficial)
- [x] T0.6 ~~Montserrat + Inter~~ → **Poppins (400/500/600) + Playfair Display** em `brand/assets/fonts/` (§5.1)
- [x] T0.7 `styles/` reescrito: 5 estilos geráveis dentro do registro único + `foto-real` documentado e não-gerável (§8.2); `map.json` passa a ser por pilar
- [x] T0.8 Gate: `bun run check` verde (42 testes). O teste "nenhuma cor descontinuada sobrou como valor de cor" percorre a árvore de tokens e checa só o que **é** cor — `grep` daria falso positivo na lista `descontinuadas`, que cita os hexes legados de propósito. `grep -r 'code/personal' src styles brand` vazio.
- [x] T0.9 Validador do capítulo 16 em `src/brand/validate.ts` + 42 testes

## FA Alterações diretas (11/08/2026)
> Quatro correções na base existente, autorizadas antes de qualquer grupo novo de features. Ver `.specs/project/STATE.md`.
- [x] TA.1 Tabela `publicacoes` + `postId` obrigatório em `publishImage` — sem ela nenhuma métrica é atribuível a uma peça, e não há conserto retroativo
- [x] TA.2 `src/art/validate.ts` — gate visual (dimensão, peso, matiz fora da paleta, proporção 70/20/10, zonas seguras do story). Limiares pendentes de calibração: PENDENCIAS.md §9
- [x] TA.3 `status_do_mes` passa a propor pauta: buraco por pilar + datas do §12.4 na janela + fotos do banco
- [x] TA.4 `src/fotos/` — banco de fotos reais (upload por Telegram, catalogação por visão, busca, `usar_foto`), a saída que a política do §8.2 exigia
- [x] TA.5 `bunfig.toml` + `test/setup.ts`: um banco por execução de `bun test`
- [x] TA.6 Gate: `bun run check` verde (86 testes, era 42)

## F1 Spike (bloqueante)
- [ ] T1.1 `bun init` + deps (`@google/genai`, `sharp`, `elysia`)
- [ ] T1.2 `scripts/spike-arte.ts`: headline → 3 gerações ∥ → resize/crop → JPEG, para 4:5 e 9:16
- [ ] T1.3 Rodar com brief "Dia do Vidraceiro 18/05"; validar tabela 3.4 (dimensão, formato, tamanho via script; visual → humano)

## F2 Bot
- [ ] T2.1 `src/db/` schema SQLite (conversas, posts, fila)
- [ ] T2.2 `src/telegram/` client (sendMessage, sendChatAction, media group, inline keyboards, webhook parse)
- [ ] T2.3 `src/brain/` — system prompt (brandbook+voice+tokens), tools §3.2, invariantes
- [ ] T2.4 `src/art/` pipeline reutilizando o spike; `src/caption/`
- [ ] T2.5 `src/server.ts` Elysia: `/webhooks/telegram` (secret timingSafeEqual, parse none), `/media/:id`, `/health`; allowlist
- [ ] T2.6 Fluxo aprovação: botões v1/v2/v3/refazer/reescrever-legenda; caminho "Os dois" (derivar_story com previous_interaction_id)

## F3 Linear
- [ ] T3.1 `src/linear/` — criar/atualizar issue (team ec0c88f8…, label Instagram Post), upload anexos, comentário legenda/brief, mover status

## F4 Instagram
- [ ] T4.1 `src/instagram/` — container → polling FINISHED → publish; IMAGE e STORIES; content_publishing_limit
- [ ] T4.2 `src/scheduler/` — fila SQLite, tick 30s, timezone America/Sao_Paulo, aviso de falha no Telegram; `/agenda`, cancelar
- [ ] T4.3 Teste Story sandbox (manual, precisa credenciais)

## F5 Produção
- [ ] T5.1 Dockerfile + compose.yml (labels watchtower)
- [ ] T5.2 `.github/workflows/deploy.yml` (ghcr + webhook watchtower)
- [ ] T5.3 Cron do calendário editorial (US-7)
- [ ] T5.4 Docs de setup: DNS, Caddy, env, BotFather, Meta app
