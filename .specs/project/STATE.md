# STATE

## Decisões
- 2026-08-11 — **`publicacoes` é tabela, não coluna.** `publishImage` recebia o id da mídia da Meta e o descartava; sem ele nenhuma métrica é atribuível a uma peça, e a Graph API não permite descobrir depois qual mídia veio de qual brief. Virou tabela (não coluna em `posts`) porque um post gera até duas publicações — IMAGE do feed e STORIES. `postId` é obrigatório na assinatura de `publishImage` de propósito: o registro acontece na única função que conhece o id, para não existir caminho de publicação que esqueça de gravá-lo.
- 2026-08-11 — **Gate visual em `src/art/validate.ts`.** A mesma lição do validador de legenda aplicada ao pixel: o modelo de imagem recebe a paleta no prompt e isso não basta. Mede o que é objetivo (dimensão, peso, matiz, proporção 70/20/10, agitação nas zonas seguras do story) e deixa margem e hierarquia para o humano. Reporta, não regenera — a geração já foi paga; texto barato pode ser reescrito em loop, imagem não. Limiares ainda não calibrados contra arte real (ver PENDENCIAS.md).
- 2026-08-11 — **Banco de fotos (`src/fotos/`).** A F4 passou a recusar peça que exige foto real, e recusa sem alternativa vira paralisia — o caminho de menor resistência seria gerar por IA e mentir no brief. Foto mandada no Telegram é arquivada, catalogada pelo modelo de visão e vira arte por `usar_foto`. A catalogação é automática porque banco que depende de alguém preencher campo no upload fica sem tag em duas semanas. A unidade vem da legenda do usuário, nunca da imagem.
- 2026-08-11 — **`status_do_mes` propõe.** Diagnóstico sem proposta é relatório. O código calcula o buraco e junta o material (pilar deficitário, datas que passam no §12.4, fotos que já existem); o modelo redige a pauta. A base da cota é o mês fechado na cadência mínima, não o que já saiu — 40% de 2 posts arredonda para 1 e diria "PROVA no alvo" no dia 3.
- 2026-08-11 — **Marca reconciliada.** O `brand/` do repo (29/07) era anterior e independente do brandbook canônico (`~/code/work/brandbook`, 05/08) e o contradizia em todos os eixos: nenhum hex batia, a tipografia era Montserrat/Inter contra Poppins/Playfair, e o `voice.md` prescrevia justamente o tom que o §9 proíbe. Como o system prompt lia esses arquivos a cada turno, o sistema estava cabeado para produzir peça que reprova no checklist do capítulo 16. O brandbook foi trazido para dentro do repo e é agora a fonte de verdade única; `voice.md` e o BRANDBOOK.md resumido foram apagados; o Anexo A do PRD foi marcado como superado. Pendências abertas em `PENDENCIAS.md`.
- 2026-08-11 — O brandbook fica em `brand/` sob git. Antes vivia fora de qualquer controle de versão — 42 KB de norma e 3,5 MB de PDF sem histórico. `.dockerignore` mantém PDF, manual, cards, texturas e fontes fora da imagem.
- 2026-07-29 — Spec = `docs/prd.md`; `.specs/` só orquestra fases, sem duplicar requisitos.
- 2026-07-29 — `GEMINI_API_KEY` local disponível em `~/code/work/agente-projetista/.env` (usar só para o spike; produção usa `/etc/emvidros/em-marketing.env`).

## Bloqueios
- **F1 (gate):** `gemini-3.1-flash-image` retorna 429 com `free_tier limit: 0` na chave atual — o modelo de imagem NÃO tem free tier neste projeto Google; precisa habilitar billing (ou usar chave de projeto com billing) e rodar `bun scripts/spike-arte.ts`. Auth e formato do request já validados (erro é de quota, não de schema); SDK 2.13.0 funciona sob Bun.
- F2+: falta `TELEGRAM_BOT_TOKEN` — Telegram Web só loga por QR code no celular, então só o Henrique consegue criar o bot no @BotFather. `TELEGRAM_ALLOWED_CHAT_IDS` depende disso.
- F4: falta app Meta + Page token — developers.facebook.com exige senha/2FA. Validar Story 1080×1920 em sandbox.
- F5: falta A record `mkt.emvidros.com.br` (DNS na Wix) + arquivo Caddy no servidor; falta secret `WATCHTOWER_TOKEN` no repo GitHub (o valor existe no servidor em `/etc/emvidros/watchtower.env`).

## `.env` local (2026-07-29, chmod 600, fora do git)
Preenchido via Playwright: `GEMINI_API_KEY` (chave "EM Marketing" já existente no projeto `gen-lang-client-0540020304`, validada), `LINEAR_API_KEY` (criada, escopada só ao time EM Vidros, validada), `LINEAR_LABEL_ID`, `TELEGRAM_WEBHOOK_SECRET` (gerado). Vazios: os 4 do Telegram/Instagram acima.
Validado de ponta a ponta com a chave real: `definir_headline` e `escrever_legenda` (82 palavras, 7 hashtags, `#EMVidros` primeira).

## Lições
- 2026-08-11 — `sharp().stats()` mede a imagem de entrada e ignora o `extract()` encadeado antes dele. As duas zonas seguras do story reportavam sempre o mesmo desvio — o da peça inteira — e o teste "conteúdo no meio não acusa zona segura" foi o que pegou. O desvio agora é calculado no pixel bruto.
- 2026-08-11 — Arquivo de teste não escolhe o próprio banco: `src/db/index.ts` abre a conexão no import e o módulo é compartilhado por todo o processo de `bun test`, então só o primeiro DB_PATH valeria, e o `afterAll` de um arquivo apagando seu tmp derrubava a conexão dos outros (SQLITE_IOERR_VNODE). Um banco por execução, via preload em `bunfig.toml`.
- 2026-08-11 — Duas fontes de verdade de marca no mesmo projeto não convivem: uma delas silenciosamente vira a errada. O `brand/BRANDBOOK.md` de 51 linhas parecia um resumo do brandbook e era um documento concorrente escrito antes dele. Só apareceu porque alguém apontou onde estava o brandbook de verdade — nada no repo indicava que existia um.
- 2026-08-11 — Regra de marca que o modelo só "leu" no prompt não é cumprida. As mesmas invariantes que já eram checadas em código para o fluxo (formato, headline, stories sem legenda) passaram a valer para a norma de texto: léxico, emoji, hashtag, CTA, grafia e unidades agora são verificados em `src/brand/validate.ts` e devolvidos ao modelo para reescrita.

## Todos / Deferred
- Rotacionar token Telegram hardcoded em `~/code/personal/pai/claude-ricardo/Scheduled/*/SKILL.md` (achado do PRD §4.7).
- v1.1: carrossel, Reels, edição multi-turno via previous_interaction_id.
