# PRD — Agente de Marketing EM Vidros no Telegram

**Produto:** `em-marketing`
**Data:** 29/07/2026 · **Status:** Draft para aprovação · **Autor:** Henrique
**Escopo deste documento:** requisitos. Nenhuma implementação.

---

## 1. Executive Summary

**Problema.** A produção de posts do Instagram da EM Vidros (@emvidros — 7.850 seguidores, 644 posts) depende hoje de uma skill do Claude Code que **está quebrada e parada desde 26/jun/2026**, e que só pode ser operada por quem usa terminal — o que exclui todo o time de marketing.

**Solução.** Um agente de marketing no Telegram, com cérebro Gemini, que conhece a identidade da EM Vidros a fundo (brandbook versionado), pergunta o formato desejado (Feed, Stories ou os dois), gera **3 variações de arte por pedido** para o time escolher, escreve a legenda no tom de voz da marca (quando é Feed — em Stories a mensagem já está na arte), registra tudo no Linear e publica no Instagram.

**Critérios de sucesso** (medidos 30 dias após o go-live):

| KPI | Meta |
|---|---|
| Tempo do pedido à arte aprovada | ≤ 5 min (hoje: uma sessão de terminal com um dev) |
| Posts produzidos sem intervenção de dev | 100% |
| Artes entregues na dimensão exata do formato escolhido | 100% |
| Taxa de aprovação na primeira rodada (o time escolhe uma das 3 sem pedir refação) | ≥ 70% |
| Erros de grafia em português na arte escolhida | 0 |
| Custo de geração por post | ≤ US$ 0,50 |
| Publicações agendadas que sobem no horário (±2 min) | ≥ 99% |

### 1.1 Por que a solução atual falhou

Diagnóstico da skill `post-emvidros`, que este produto substitui:

| Defeito | Impacto |
|---|---|
| Depende da tool `generate_image`, que **não existe** neste ambiente (é sintaxe do Amp) | Bloqueante — a geração simplesmente falha |
| Caminho do logo aponta para `code/personal/work/…`, que não existe (já foi reescrito errado 2×) | Bloqueante |
| Guia de tom de voz e geração de legenda **se perdeu** na migração | A skill gera imagem sem legenda |
| Teal errado: usa `#00A99D`; o real do logo é `#2C7A75` | Toda arte sai fora da marca |
| Exige Claude Code aberto no terminal | Time de marketing não consegue operar |
| `rm posts/EMV-*_v*-*.png` — glob destrutivo sem guarda, e sem cwd declarado | Risco de apagar arquivo errado |

---

## 2. User Experience & Functionality

### 2.1 Personas

| Persona | Quem é | Precisa |
|---|---|---|
| **Social media da EM Vidros** (primária) | Opera o Instagram no dia a dia, do celular. Não usa terminal. | Pedir um post em linguagem natural, ver opções, escolher, publicar |
| **Diretoria / Marketing** (aprovador) | Aprova peças antes de irem ao ar | Ver as 3 opções e a legenda antes da publicação |
| **Henrique** (mantenedor) | Dev responsável | Que rode sozinho, sem babá; logs e falhas visíveis |

### 2.2 User Stories e Critérios de Aceite

**US-1 — Pedir um post**
> Como social media, quero pedir um post em português coloquial pelo Telegram, para não depender de ninguém.

- Aceita mensagem livre ("cria um post pro dia do vidraceiro, 18 de maio")
- O agente devolve um **brief estruturado** (tipo, tema, ângulo) e pede confirmação antes de gastar geração
- O brief é editável por mensagem ("muda o ângulo pra segurança")
- Resposta do bot ao primeiro contato em ≤ 3 s (`sendChatAction` imediato)

**US-2 — Escolher o formato antes de gerar**
> Como social media, quero dizer se o post é para Feed, Stories ou os dois, para receber a arte já na dimensão certa.

- **Antes de qualquer geração de imagem**, o bot pergunta o formato com botões inline: `[Feed] [Stories] [Os dois]`
- O bot **não gera nada** até essa escolha — evita desperdiçar geração no formato errado
- A escolha determina o aspect ratio e a dimensão final:

| Escolha | Aspect ratio | Dimensão final |
|---|---|---|
| **Feed** | 4:5 | **1080×1350** JPEG |
| **Stories** | 9:16 | **1080×1920** JPEG |
| **Os dois** | ambos | 1080×1350 **e** 1080×1920 |

- Se o usuário já disser o formato na mensagem inicial ("faz um story do dia do vidraceiro"), o bot **pula a pergunta** e apenas confirma no brief
- A composição é adaptada ao formato, não apenas recortada: em 9:16 o texto sobe, o herói ganha respiro vertical e a zona inferior fica livre para stickers e o "arraste para cima"

**Comportamento de "Os dois"** — decisão de produto: o bot gera as **3 variações em Feed primeiro**, o time escolhe uma, e só então a versão Stories é gerada a partir do **mesmo conceito**. Isso garante que as duas peças sejam visualmente consistentes (é o que um designer faria) e mantém o custo em ~US$ 0,40 em vez de US$ 0,60 de 6 gerações independentes e desconexas.

**US-3 — Receber 3 opções**
> Como social media, quero 3 artes diferentes para escolher a melhor, em vez de aceitar o que a IA decidiu.

- Entrega **exatamente 3** variações, em um único media group
- As 3 usam **territórios visuais ou composições distintos** — não são 3 amostras do mesmo prompt
- Todas na **dimensão exata do formato escolhido em US-2**, JPEG, sRGB, < 8 MB
- Todas contêm o logo oficial **fiel, não redesenhado**
- Botões inline: `[v1] [v2] [v3]` + `[Refazer artes]`. O botão `[Reescrever legenda]` **só aparece quando o formato inclui Feed**
- As 3 chegam em ≤ 90 s do "Gerar"

**US-4 — Legenda no tom da marca (só Feed)**
> Como social media, quero a legenda pronta no tom da EM Vidros, sem precisar reescrever.

- 50–100 palavras, sem contar hashtags
- Estrutura: abertura → corpo → CTA → linha em branco → 5–10 hashtags
- `#EMVidros` é sempre a primeira hashtag
- Regras de abertura/corpo/CTA respeitam o tipo de post (tabela em A.6)
- Emojis com moderação; 🩵 é a assinatura da marca
- Sem erro de português

> **Stories não têm legenda.** A mensagem já está na própria arte, e a API do Instagram nem aceita `caption` em `media_type=STORIES`. Quando o formato escolhido é **Stories**, o bot **pula inteiramente a etapa de legenda** — não gera texto de apoio, não pede aprovação de copy, não manda nada além da imagem. No fluxo **"Os dois"**, a legenda é escrita uma vez e vale só para a peça de Feed.
>
> A regra de gerar o texto antes da imagem (seção 3.3) continua valendo em ambos os casos — mas o que é gerado primeiro no caso de Stories é o **headline que vai dentro da arte**, não uma legenda de publicação.

**US-5 — Escolher e arquivar**
> Como aprovador, quero registrar a escolha para ter histórico.

- Ao clicar `v2`, o bot confirma e descarta as outras
- Se o formato for "Os dois", gera a versão Stories do conceito escolhido e a apresenta para confirmação
- Cria/atualiza issue no Linear (time `EM Vidros`, label `Instagram Post`)
- Anexa **todos** os JPEGs finais (Feed e/ou Stories). A legenda aprovada vai no comentário **quando houver** — em post só de Stories, o comentário registra apenas o brief e o headline usado na arte
- Move o status da issue

**US-6 — Publicar ou agendar**
> Como social media, quero publicar na hora ou marcar para uma data.

- Opções: `[Publicar agora] [Agendar] [Só arquivar]`
- Quando há Feed **e** Stories, o bot pergunta se publica os dois juntos ou em horários diferentes
- Agendamento aceita data/hora em linguagem natural ("sábado 9h"), timezone `America/Sao_Paulo`
- Confirma o horário interpretado antes de gravar
- `/agenda` lista o que está na fila; cada item pode ser cancelado
- Publicação agendada sobe no horário ±2 min
- Se falhar, o bot **avisa no Telegram** com o motivo — nunca falha em silêncio

**US-7 — Calendário editorial automático**
> Como marketing, quero ser lembrado das datas que a marca sempre posta.

- 3 dias antes de cada data recorrente (A.7), o bot manda um brief pronto
- Aceitar leva ao fluxo normal a partir de US-2 (escolha de formato); ignorar não faz nada

### 2.3 Non-Goals (v1)

Explicitamente **fora** do escopo, para proteger o prazo:

- **Vídeo e Reels** — só imagem estática (Feed 4:5 e Stories 9:16)
- Carrossel (a Graph API suporta até 10 itens; fica para v1.1)
- Stickers interativos de Stories (enquete, link, contagem regressiva) — a arte é uma imagem estática
- Responder comentários ou DMs do Instagram
- Métricas, analytics ou relatório de performance
- Publicar em contas que não sejam a @emvidros (isso exigiria App Review e Business Verification)
- Edição fina da arte pelo Telegram (crop, mover elemento) — a escolha é entre as 3, ou refaz
- Aprovação multi-nível com papéis e permissões
- Interface web

---

## 3. AI System Requirements

### 3.1 Modelos

| Papel | Modelo | Justificativa |
|---|---|---|
| Cérebro (conversa + tool calling) | **`gemini-3.6-flash`** | Stable, tem free tier, é o modelo dos exemplos oficiais de function calling |
| Geração de arte | **`gemini-3.1-flash-image`** (Nano Banana 2) | Escolha do usuário. Doc oficial: "reliable text rendering", até 10 imagens de referência |
| *Opcional, peça específica* | `gemini-3-pro-image` (Nano Banana Pro) | Doc oficial: "accurate brand consistency". US$ 0,134/img vs 0,101 |

⚠️ **Correções de premissa validadas na doc oficial:**
- **Nano Banana 2 ≠ Nano Banana Pro.** NB2 = `gemini-3.1-flash-image`; Pro = `gemini-3-pro-image`.
- `gemini-3-pro-image-preview` **não é** o ID atual. `gemini-3.1-pro-image` **não existe**.
- O `generateContent` foi substituído pela **Interactions API** (`ai.interactions.create`), agora GA. SDK: `@google/genai@2.13.0`.
- Imagen está descontinuado (desligamento em 17/08/2026).

### 3.2 Tools expostas ao cérebro

| Tool | Faz |
|---|---|
| `montar_brief` | Converte pedido livre em brief estruturado (tipo, tema, ângulo, data) |
| `perguntar_formato` | Apresenta os botões Feed / Stories / Os dois e trava o `formato` no brief |
| `definir_headline` | Gera o texto que vai **dentro da arte** (headline + apoio), sempre — é pré-requisito da geração de imagem |
| `escrever_legenda` | Gera a legenda de publicação a partir do brief + `voice.md`. **Só é chamada quando o formato inclui Feed** |
| `gerar_3_artes` | Dispara 3 chamadas paralelas ao Nano Banana 2, no aspect ratio do formato escolhido |
| `derivar_story` | Gera a versão 9:16 do conceito já escolhido (fluxo "Os dois") |
| `salvar_linear` | Cria/atualiza issue, anexa os JPEGs, comenta a legenda |
| `agendar_publicacao` | Grava na fila com `publish_at` e `media_type` |
| `publicar_agora` | Executa o fluxo da Graph API |
| `listar_agenda` / `cancelar_agendamento` | Gestão da fila |

> **Invariantes** que o cérebro deve tratar como pré-condições rígidas:
> 1. `gerar_3_artes` só pode ser chamada depois que `formato` estiver definido no brief
> 2. `gerar_3_artes` só pode ser chamada depois de `definir_headline`
> 3. `escrever_legenda` **não** é chamada quando `formato == "stories"`

### 3.3 Pipeline de arte — requisitos técnicos

**Regra de ordem, vinda da doc oficial do Google:**
> "When generating text for an image, Gemini works best if you first generate the text and then ask for an image with the text."

→ **O headline é gerado primeiro** e vai literal no prompt de imagem. Isso não é preferência, é a instrução oficial. Vale para os dois formatos — é o texto que aparece *dentro* da arte, e não se confunde com a legenda de publicação, que só existe em Feed (US-4).

**Nano Banana 2 não entrega dimensões arbitrárias.** Os tamanhos são fixos por aspect ratio, e o "4:5" do Google (928×1152) nem é 4:5 exato (0,8056 vs 0,8). O mesmo vale para 9:16 (768/1376 = 0,558 vs 0,5625). Pipeline obrigatório em ambos os formatos:

```
FEED
Nano Banana 2 · aspect_ratio "4:5" · image_size "2K"    →  1856×2304 PNG
   ↓ resize cover + crop
1080×1350  (4:5 exato, ≤ 1440px de largura)
   ↓ JPEG quality 90, sRGB
arquivo final

STORIES
Nano Banana 2 · aspect_ratio "9:16" · image_size "2K"   →  1536×2752 PNG
   ↓ resize cover + crop
1080×1920  (9:16 exato)
   ↓ JPEG quality 90, sRGB
arquivo final
```

- `image_size` exige **"K" maiúsculo** — `1k` é rejeitado pela API
- Toda imagem sai com watermark **SynthID**
- O logo entra como **reference image** (`{type:"image", mime_type, data: base64}`) — NB2 aceita até 10 objetos de alta fidelidade
- **pt-BR está na lista oficial de idiomas de melhor desempenho** para renderização de texto
- No fluxo "Os dois", a versão Stories usa **`previous_interaction_id`** do conceito escolhido, para manter consistência visual sem reenviar as imagens de referência

**Zonas seguras por formato.** Não basta trocar o ratio — a composição precisa mudar:

| | Feed 1080×1350 | Stories 1080×1920 |
|---|---|---|
| Topo reservado | — | 250 px (avatar e nome do perfil) |
| Base reservada | — | 250 px (campo de resposta) |
| Logo | canto inferior direito, discreto | topo ou centro-inferior, dentro da zona segura |
| Densidade de texto | headline + subtítulo + linha de apoio | headline curta, no máximo uma linha de apoio |

### 3.4 Estratégia de avaliação

**Gate de qualidade — a Fase 1 do roadmap é bloqueante.** Antes de qualquer linha de servidor, um spike gera 3 variações de um post real ("Dia do Vidraceiro, 18/05") **em cada formato** e é avaliado contra:

| Critério | Como medir | Aprovação |
|---|---|---|
| Dimensão exata | `sips -g pixelWidth -g pixelHeight` | 1080×1350 (Feed) e 1080×1920 (Stories) em 3/3 |
| Formato | `file` | JPEG em 3/3 |
| Tamanho | `ls -l` | < 8 MB em 3/3 |
| Fidelidade do logo | inspeção visual | logo oficial, não redesenhado, em 3/3 |
| Texto em português | inspeção visual | 0 erros de grafia em 3/3 |
| Diversidade | inspeção visual | as 3 visivelmente diferentes |
| Zonas seguras (Stories) | inspeção visual | nada crítico nos 250 px de topo/base |
| Aderência à paleta | amostragem de pixel | teal dominante ∈ família `#2C7A75`/`#3FA9A0` |
| Runtime | rodar o script | `@google/genai` funciona sob Bun |

**Benchmark contínuo.** Um conjunto de **10 briefs de referência** derivados de posts reais do feed (1 por tipo de conteúdo). Rodados a cada mudança de prompt ou de modelo. Critério de não-regressão: **≥ 8/10 com pelo menos uma das 3 variações aprovável sem refação**.

**Avaliação de legenda** (só se aplica a Feed). As legendas reais capturadas do feed (A.6) servem de gabarito. Checagem automática: contagem de palavras 50–100, `#EMVidros` presente e primeira, 5–10 hashtags, tem CTA. Checagem humana: tom. Em post só de Stories, a checagem equivalente é sobre o **headline dentro da arte**: sem erro de grafia, legível no tamanho de tela do celular, dentro das zonas seguras.

---

## 4. Technical Specifications

### 4.1 Arquitetura

```
   Time de marketing (Telegram, no celular)
              │  webhook HTTPS
              ▼
   ┌───────────────────────────────────────────────────┐
   │  em-marketing        Bun 1.3 + Elysia 1.4         │
   │                                                    │
   │  POST /webhooks/telegram   mensagens + callbacks   │
   │  GET  /media/:id           URL pública p/ a Meta   │
   │  GET  /health                                      │
   │                                                    │
   │  ┌────────── cérebro: gemini-3.6-flash ─────────┐  │
   │  │ system = BRANDBOOK.md + voice.md + tokens    │  │
   │  │ function calling (tools da seção 3.2)        │  │
   │  └───────────────────────────────────────────────┘  │
   │                                                    │
   │  SQLite (bun:sqlite) — conversas, posts, fila      │
   │  Scheduler próprio — dispara publicação            │
   └───────────────────────────────────────────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
  Nano Banana 2      Linear API      Instagram Graph API
  3 artes ∥          (backlog)       (publicação)
```

**Por que Bun + Elysia:** requisito do usuário — rápido para usuário e servidor. Latência de webhook em milissegundos e o processo cabe num container pequeno junto dos outros no servidor. O trabalho pesado (3 chamadas ao Nano Banana) é I/O paralelo, não CPU.

**Restrições do Elysia validadas:**
- `elysia@1.4.29` é o estável — a 2.0 está em `2.0.0-exp.60`, **não usar**
- Escopo dos plugins migrou: `@elysiajs/*` → **`@elysia/*`**
- `error()` foi removido → usar **`status()`**
- Para servir bytes de imagem, retornar **`new Response(bytes, {headers})`** — o Elysia não infere `Content-Type` de `Buffer`/`Uint8Array`
- No webhook, `parse: 'none'` + `await request.text()` para validar o secret token sobre os bytes exatos

### 4.2 Estrutura do repositório

```
em-marketing/
├── brand/                    ← o ativo central (Anexo A)
│   ├── BRANDBOOK.md · tokens.json · voice.md · calendario.md
│   └── assets/logo-cor.png · logo-branco.png · fonts/
├── styles/                   ← 6 estilos, portados e corrigidos
├── src/
│   ├── server.ts             ← Elysia: rotas e webhooks
│   ├── brain/ · art/ · caption/
│   ├── telegram/ · linear/ · instagram/ · scheduler/ · db/
├── docs/                     ← este PRD, briefs gerados
├── Dockerfile · compose.yml
└── .github/workflows/deploy.yml
```

Os 6 estilos da skill antiga são **bons prompts** e devem ser portados, com três correções: (1) teal errado → paleta A.3; (2) caminho do logo; (3) faltam as assinaturas visuais reais que a pesquisa revelou — objeto 3D de vidro translúcido teal como herói, textura de pontinhos, chevrons `>>>`, pills teal, assinatura `imagine em vidro`. Cada estilo precisa de **duas variantes de composição**, uma para 4:5 e uma para 9:16, seguindo as zonas seguras de 3.3.

**Mapa tipo de post → trio de variações** (o cérebro escolhe, o usuário sobrescreve):

| Tipo | v1 | v2 | v3 |
|---|---|---|---|
| Data comemorativa regional | festivo-comemorativo | minimal-editorial | tipografico-bold |
| Dia da profissão | minimal-editorial | festivo-comemorativo | institucional-foto |
| Produto / técnico | produto-3d | minimal-editorial | tipografico-bold |
| Educacional | tipografico-bold | minimal-editorial | produto-3d |
| Promoção / sorteio | festivo-comemorativo | produto-3d | tipografico-bold |
| Institucional / bastidor | institucional-foto | minimal-editorial | premium-escuro |

### 4.3 Integração — Instagram Graph API

Três descobertas da doc oficial da Meta que definem o desenho:

**a) Provavelmente NÃO precisa de App Review nem Business Verification.** Citação literal:
> "If your app only serves your Instagram professional account or an account you manage, **Standard Access is all your app needs**."

Publicando na conta própria, com app próprio, Standard Access basta **e funciona em produção**. A burocracia esperada em grande parte não se aplica.

**b) NÃO existe agendamento nativo. Categórico.** Não há `scheduled_publish_time` nem equivalente — a publicação é **sempre imediata**. A única menção a agendamento em toda a doc é a Meta dizendo que o scheduler é responsabilidade do seu app. (Páginas do Facebook *têm* o parâmetro; o Instagram não.) Diversos blogs afirmam o contrário — é falso.
→ **Requisito derivado:** o scheduler é nosso. E o container de mídia **expira em 24h**, logo deve ser criado **na hora da publicação**, nunca na hora do agendamento.

**c) JPEG apenas.** "JPEG is the only image format supported" — **PNG não é aceito**. Máx 8 MB, largura 320–1440 px, sRGB.

**Publicação por formato:**

| Formato | Chamada |
|---|---|
| Feed | `POST /{ig-user-id}/media` com `image_url` + `caption` (`media_type` default `IMAGE`) |
| Stories | `POST /{ig-user-id}/media` com `image_url` + **`media_type=STORIES`** (sem `caption` — Stories não têm legenda) |

Fluxo comum: criar container → polling de `status_code` até `FINISHED` (1×/min, máx 5 min) → `POST /{ig-user-id}/media_publish`. A imagem precisa estar em **URL pública** — a Meta faz cURL nela. Rate limit documentado de forma inconsistente (100/24h numa seção, 50/24h noutra) → consultar `GET /{ig-user-id}/content_publishing_limit` em runtime.

> ⚠️ **A validar na Fase 4:** a doc lista o limite de aspect ratio de imagem como **4:5 a 1.91:1**, mas **não documenta separadamente as specs de imagem para `media_type=STORIES`**. Um Story de 1080×1920 tem ratio 0,5625, fora desse intervalo. Na prática as ferramentas de mercado publicam Stories nessa dimensão pela API sem problema, mas isso **não está confirmado em documentação**. Validar com um post de teste em conta sandbox **antes** de fechar a Fase 4. Fallback caso a Meta rejeite: publicar o Story em 1080×1350 sobre canvas, ou entregar o arquivo para publicação manual.

**Caminho de login — recomendado: Facebook Login.**

| | Instagram Login | **Facebook Login** ✅ |
|---|---|---|
| Página do FB | não exige | exige — a @emvidros **já tem** (facebook.com/emvidros) |
| Token | expira em 60 dias, precisa de cron de refresh | **Page token não expira** |

Para um agente rodando desassistido, trocar um passo de setup por eliminar a classe de falha "token expirou em silêncio" compensa.

### 4.4 Integração — Linear
Time `EM Vidros` (`ec0c88f8-96c2-40b2-853c-98f62b4d98fa`) e labels `Instagram Post` (`5a33b4dc-…`) e `Marketing` **já existem** — não precisam ser criados.

### 4.5 Integração — Canva: descartada
O conector está autenticado, mas `list-brand-kits` retorna **vazio**: Brand Kit e Brand Template são recursos do Canva Pro/Teams. Pelo critério do usuário ("se for de graça"), fica fora. Toda a arte vem do Nano Banana 2.

### 4.6 Deploy

Não precisa de infra nova. O servidor `srv-linx-01` (IP público **177.54.129.7**, acesso via `ssh emvidros`) já roda uma stack Docker madura com CI/CD estabelecido:

```
git push → GitHub Actions (gh-runner self-hosted no próprio servidor)
        → build → push ghcr.io/em-vidros/em-marketing:latest
        → webhook POST /v1/update no watchtower-prod
        → container recriado automaticamente
```

Labels exigidas: `com.centurylinklabs.watchtower.enable=true`, `com.centurylinklabs.watchtower.scope=emvidros-prod`, `ambiente=prod`. Referência a espelhar: `/opt/emvidros/agente-projetista/`.

**HTTPS público já resolvido.** Existe um Caddy de host com subdomínios reais e Let's Encrypt funcionando (`/etc/caddy/sites/*.emvidros.com.br.caddy` — hoje `chatwoot.`, `comissoes.`, `portainer.`, `monitoramentos.`, `status.`, `hub.`). Basta:
1. Criar o A record **`mkt.emvidros.com.br` → 177.54.129.7** (DNS na Wix — `ns14/ns15.wixdns.net`)
2. Adicionar `/etc/caddy/sites/mkt.emvidros.com.br.caddy` com `reverse_proxy 127.0.0.1:<porta>`

Isso entrega de uma vez o certificado válido que **o webhook do Telegram** e **o `image_url` do Instagram** exigem.

### 4.7 Segurança e privacidade

- Segredos em `/etc/emvidros/em-marketing.env`, `chmod 600`, montado como `env_file` — mesmo padrão do watchtower e do agente-projetista. **Nunca** hardcoded em arquivo versionado.
- Segredos necessários: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY` (já existe no ecossistema), `LINEAR_API_KEY`, `IG_PAGE_TOKEN`, `IG_USER_ID`
- **Allowlist de chat IDs** — o bot só responde a IDs autorizados. Sem isso, qualquer pessoa que descubra o bot publica no Instagram da empresa.
- Validação do `X-Telegram-Bot-Api-Secret-Token` em todo webhook, comparado com `timingSafeEqual`
- Publicação no Instagram **sempre exige confirmação humana explícita** — nunca automática, mesmo com agendamento (o agendamento executa uma escolha já aprovada)
- `/media/:id` serve por ID opaco, sem enumeração, e expira após a publicação
- Nenhum dado pessoal de cliente trafega no sistema

> ⚠️ **Achado fora do escopo:** as skills em `~/code/personal/pai/claude-ricardo/Scheduled/*/SKILL.md` têm um **bot token do Telegram e chat ID hardcoded em texto plano** (`8710021388:AAG…`). Recomendo rotacionar o token e movê-lo para env com `chmod 600`.

---

## 5. Risks & Roadmap

### 5.1 Roadmap

| Fase | Entrega | Gate de saída |
|---|---|---|
| **0. Brandbook** | `brand/` completo (Anexo A materializado), logo branco produzido, fontes versionadas, `styles/` portado e corrigido com variantes 4:5 e 9:16 | `tokens.json` bate com A.3; nenhum arquivo contém `#00A99D` nem `code/personal` |
| **1. Spike de arte** ⚠️ **bloqueante** | Script que gera 3 variações reais em 1080×1350 **e** 1080×1920 JPEG, com o logo como referência | Tabela de critérios da seção 3.4, 3/3 em ambos os formatos |
| **2. Bot** | Elysia + webhook + cérebro com function calling + **pergunta de formato** + fluxo de aprovação com os 3 botões | US-1 a US-4 passam ponta a ponta, incluindo o caminho "Os dois" |
| **3. Linear** | Issue, anexos (Feed e Stories), comentário, status | US-5 passa |
| **4. Instagram** | App Meta + Page token, `/media/:id` público, publicar-agora para `IMAGE` e `STORIES`, scheduler próprio | US-6 passa; **teste de Story em conta sandbox** valida o ponto aberto de 4.3 |
| **5. Produção** | Dockerfile, GH Actions → ghcr → watchtower, subdomínio + Caddy, cron do calendário | US-7 passa; `GET /health` responde pelo subdomínio |

**v1.1 (depois):** carrossel (até 10 itens), Reels, edição multi-turno da arte escolhida via `previous_interaction_id`.
**v2.0:** métricas de performance por post, sugestão de tema a partir do que engajou.

### 5.2 Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| **`@google/genai` não declara suporte a Bun** (`engines` diz só Node ≥20) | **Alta** | Testar na Fase 1, antes de tudo. Fallback: chamar a REST API direto com `fetch` — sob Bun fica até mais leve |
| **Texto em português sai errado na arte** — falha crônica de todo gerador de imagem | **Alta** | pt-BR está na lista oficial de melhor desempenho; gerar o copy primeiro e passar literal; manter texto curto na arte (especialmente em Stories); o loop de aprovação humana com 3 opções existe justamente para absorver isso |
| **Specs de imagem para Stories não documentadas** — 1080×1920 fica fora do intervalo 4:5–1.91:1 que a doc declara para imagens | **Média** | Teste em sandbox na Fase 4, antes de fechar. Fallback documentado em 4.3 |
| Container de mídia expira em 24h | Média | Criar o container **no momento da publicação** |
| Publicação errada no ar (irreversível na prática) | Média | Confirmação humana obrigatória + allowlist de chat IDs + teste em sandbox antes |
| Rate limit da Meta documentado de forma inconsistente | Baixa | Consultar `content_publishing_limit` em runtime |
| Não existe logo em SVG nem versão branca | Média | Produzir na Fase 0 |
| Elysia 2.0 é experimental | Baixa | Fixar `elysia@1.4.29` |
| Custo de geração escapar | Baixa | 3 variações ≈ **US$ 0,30/post**; com Story derivado, ≈ US$ 0,40. Teto de gasto mensal no Google AI Studio |

---

# Anexo A — Brandbook da EM Vidros

Pesquisa feita no feed do @emvidros (≈30 posts), no site emvidros.com.br, no logo oficial em alta resolução e no workflow legado. **Este anexo é o entregável que vira `brand/BRANDBOOK.md`** — é o contexto que alimenta todo prompt do agente.

## A.1 A empresa
- **Razão social:** EM Vidros Indústria e Comércio Ltda — CNPJ 50.839.549/0001-42 (Imperatriz)
- **O que faz:** indústria + comércio de vidro plano. Fabrica **temperado** (INMETRO, 6/8/10 mm), **laminado** e **multilaminado**; vende espelhos, acessórios, ferragens e linha de perfis de alumínio
- **Alcance:** 6 filiais no MA, PA e PI. Fábricas em **Raposa-MA** e **Imperatriz-MA**. Filiais citadas em posts: Angelim, Guajajaras, Imperatriz, Ananindeua
- **Público nº 1: vidraceiros e serralheiros** (+10 mil parceiros) — é para eles o "Mês do Vidraceiro", o Dia do Serralheiro, os sorteios. Depois: arquitetos/projetistas e consumidor final
- **Slogan:** **"Imagine EM Vidro"** — aparece em minúsculas discretas (`imagine em vidro`) no canto das peças editoriais
- **Contato:** 0800 150 0103 · (98) 3131-4000 · contato@emvidros.com.br
- **Marco atual:** 11 anos em 2026 — "11 anos em constante transformação"

## A.2 Logo
Único arquivo existente: `code/work/emvidros-ig-posts/EM Vidros - Oficial.png` (2273×1889, alpha).

- **Símbolo:** monograma "EM" em barras — 3 barras horizontais empilhadas (E) fundidas a 3 barras inclinadas (M). Lê como **chapas de vidro empilhadas num cavalete**, que é literalmente o produto. Mark bom e ownable
- **Gradiente:** teal claro no topo-esquerda → teal profundo na base-direita (`#5FA9A2` → `#2C7A75`)
- **Wordmark:** "VIDROS" em sans geométrica bold, tracking largo, `#3D3D3D`
- **Lockups em uso:** vertical (símbolo sobre "VIDROS"), horizontal, e símbolo isolado pequeno no topo das peças editoriais
- **Gap:** só existe o PNG colorido. **Não há SVG nem versão branca/invertida** — e o estilo `premium-escuro` da skill antiga pedia uma branca que nunca existiu, então o gerador a inventava

## A.3 Paleta
A skill antiga usava `#00A99D`. **Está errado** — mais saturado e mais verde que o teal real. Valores amostrados do logo oficial e das artes:

| Papel | Nome | Hex |
|---|---|---|
| Primária | Teal EM | `#2C7A75` |
| Primária clara (gradiente do logo) | Teal Claro | `#5FA9A2` |
| Acento (botões, pills) | Teal Vivo | `#3FA9A0` |
| Profundo (títulos festivos, sombra) | Petróleo | `#1B5E63` |
| Texto | Carvão | `#3D3D3D` |
| Neutros | Branco / Cinza / Areia | `#FFFFFF` · `#F5F5F5` · `#F0EFEA` |
| Fundo escuro | Quase-preto | `#0A0A0A` |
| Suporte festivo | Prata / Azul-céu | `#C9CED1` · `#DCEAF2` |

> **Regra:** o teal é sempre a cor de marca. Nenhuma peça usa outra cor dominante. Cores de suporte (coral, amarelo, rosa) só em datas comemorativas específicas (Páscoa, Dia das Mães) e nunca competem com o teal.

## A.4 Tipografia
Nenhum arquivo de fonte existe hoje — as fontes são só "dicas" no prompt e o gerador improvisa. O brandbook fixa a família e o repo passa a versionar os `.ttf`:
- **Títulos:** Montserrat Bold/ExtraBold (o que mais se aproxima do wordmark "VIDROS")
- **Corpo:** Inter ou Montserrat Regular/Medium
- **Script decorativo:** só em peças festivas ("Parabéns, Imperatriz!", "Feliz Páscoa")
- **Serifada:** só em peças editoriais/emotivas (Dia das Mães, Sexta-Feira Santa)

## A.5 Os três territórios visuais
O feed opera em três registros distintos. Saber **qual usar quando** é a decisão de design mais importante do agente.

**A. Minimal / Editorial** ← *o preferido do usuário, e o mais próximo do Vivix*
Fundo off-white/areia, muito respiro, tipografia grande e limpa, teal em 1–2 detalhes, logo pequeno no rodapé. Assinatura recorrente: **objeto 3D de vidro translúcido teal** como herói (coração de vidro no Dia das Mães, ferramentas de vidro no Dia do Vidraceiro, cubos e esferas). Textura de pontinhos e chevrons `>>>`. Referência Vivix: foto de ambiente real, crédito de projeto/fotógrafo em corpo minúsculo, wordmark discreto no canto.
→ Educacional, produto, institucional sóbrio, datas emotivas.

**B. Festivo / Comemorativo** ← *o terceiro estilo que o usuário mandou (174 anos de Imperatriz)*
Fundo azul-claro texturizado, balões 3D cromados teal e prata, confete, numeral gigante com outline branco e sombra, script inclinado, cards de foto com pin de localização, silhueta de skyline no rodapé. Denso e caloroso, mas **sempre teal**.
→ Aniversário de cidade, aniversário da empresa, feriados regionais, sorteios e promoções.

**C. Institucional / Foto**
Foto real da fábrica, da equipe ou de um porta-voz, com faixa de texto branco caixa-alta pesado por cima ("SUA CASA PRECISA DE SEGURANÇA"). Autêntico, sem stock.
→ Bastidores, equipe, comunicados, prova social.

## A.6 Tom de voz
Recuperado do workflow legado (`.agents/workflows/post-emvidros.md`, passo 4) e **validado contra legendas reais** capturadas do feed.

- **Tom:** persuasivo sem ser agressivo. Elegante, próximo, levemente formal mas leve e acessível
- **Voz:** um especialista de confiança falando com o cliente — nunca uma marca impessoal
- **Estrutura:** abertura impactante (1–2 linhas) → corpo com contexto/benefício (2–4 linhas) → CTA suave (1–2 linhas) → linha em branco → 5–10 hashtags
- **Tamanho:** 50–100 palavras sem hashtags. Emojis com moderação, para pontuar blocos
- **Marca registrada:** o coração teal 🩵. **Sempre** `#EMVidros` como primeira hashtag

| Tipo | Abertura | Corpo | CTA |
|---|---|---|---|
| Institucional | Celebração e orgulho da trajetória | História, valores, conquistas | Agradecer clientes e parceiros |
| Produto | Destaque técnico ou o problema que resolve | Especificações + benefícios tangíveis | Convite a orçamento |
| Educacional | Pergunta provocativa ou dado curioso | Explicação clara e didática | Incentivar salvar/compartilhar |
| Engajamento | Elemento humano ou bastidor | Narrativa leve e autêntica | Incentivar comentário |
| Promocional | Urgência ou valor claro | Detalhes da oferta | CTA direto |
| Data comemorativa | Reconhecimento da data | Mensagem de conexão/empatia | Desejo caloroso, sem CTA comercial |

**Few-shots reais** (vão no `voice.md`):

> *Aniversário de Imperatriz, 17/07/2026:* "Hoje o nosso abraço especial vai para Imperatriz, a nossa querida 'Princesa do Tocantins', que celebra com orgulho seus 174 anos! 🎉 / Uma terra acolhedora, de gente forte e de belezas únicas! Da imponência da Catedral de Fátima ao pôr do sol inesquecível na Beira Rio e na Praia do Cacau. Nós, da EM Vidros, temos a honra de fazer parte do crescimento e da história de cada lar e projeto desta cidade tão especial. / Parabéns, Imperatriz! Que o futuro seja sempre brilhante, repleto de progresso e conquistas. 🩵✨ / #EMVidros #Imperatriz174Anos #ImperatrizMA"

> *Promoção, 19/05/2026:* "O Mês do Vidraceiro está na reta final, e o seu iPhone 16 pode estar a uma compra de distância! 📱✨ / Ainda dá tempo de participar da nossa comemoração exclusiva: a cada R$ 500 em compras na EM Vidros, você garante uma chance de levar para casa um iPhone 16 novinho e + brindes especiais. É o nosso jeito de celebrar a nossa parceria e o seu talento! / A promoção é válida apenas até o dia 30/05. […] Fale com nossos especialistas pelo link da bio! 👇"

## A.7 Calendário editorial recorrente
Seeds do scheduler (US-7): 18/05 Dia do Vidraceiro · "Mês do Vidraceiro" (maio, com sorteio) · 23/04 Dia do Serralheiro · 16/07 Aniversário de Imperatriz · aniversários das cidades das filiais (Ananindeua etc.) · Dia das Mães · Páscoa / Sexta-feira Santa · Tiradentes · Dia do Trabalho · Janeiro Branco · 08/03 Dia das Mulheres · aniversário da EM Vidros.

---

# Anexo B — Fontes

**Identidade:** feed @emvidros (≈30 posts, jan–jul/2026) · emvidros.com.br · logo oficial 2273×1889 · `.agents/workflows/post-emvidros.md` · @vivixvidrosplanos (referência de composição minimalista)
**Gemini:** ai.google.dev/gemini-api/docs — image-generation, models, function-calling, interactions, pricing · registry npm `@google/genai@2.13.0`
**Instagram:** developers.facebook.com/docs/instagram-platform — content-publishing, overview, app-review, access-levels · docs/facebook-login/guides/access-tokens/get-long-lived
**Elysia:** elysiajs.com — validation, plugin, life-cycle, handler, blog/elysia-14 · registry npm `elysia@1.4.29`
**Infra:** `ssh emvidros` (srv-linx-01, 177.54.129.7) — docker ps, /etc/caddy/sites/, watchtower-prod, /opt/emvidros/agente-projetista/
**Linear:** time `EM Vidros` e labels via MCP
