# Desenho do porte para a Vercel

> **Status:** proposto para revisão
> Escrito em 17/09/2026. Substitui as partes de `.specs/features/fabrica/DESIGN.md`
> que dependem do servidor: processo Bun único, SQLite em `data/`, artefatos em
> disco, Tailscale Funnel e imagem Docker. O que aquele documento diz sobre telas,
> papéis, vista do fluxo, arestas e o que sai junto com o Telegram continua valendo.

## 1. Resumo

O em-marketing está pronto desde 28/08 e ninguém nunca usou. O código da Fase 2 passa
nas 13 suítes, o container roda há semanas em `127.0.0.1:3010`, e o Ricardo não tem
como abrir nada, porque o endereço público nunca existiu. O ACME do wildcard
`*.emvidros.com.br` falha nos dois desafios desde agosto, e o problema é da borda
80/443 da empresa, não deste projeto. O plano B, Tailscale Funnel, também nunca foi
ligado: `CertDomains` está nulo e não há configuração de serve.

O Henrique decidiu em 17/09/2026 tirar o projeto do servidor. Ele passa a rodar
inteiro na Vercel: tela, API e workers no mesmo domínio, banco no Neon, artefatos no
Vercel Blob. O certificado deixa de ser problema nosso, e o site da Fase 3 nasce
direto no lugar onde vai viver, em vez de nascer no servidor e mudar de casa depois.

A conta é a mesma do REP Campo, no plano Hobby, por escolha do Henrique.

O custo principal é que o plano de controle deixa de ser síncrono. Hoje ele é
`bun:sqlite`, que responde na hora; qualquer Postgres responde por rede. As cerca de
1.800 linhas de `src/controle/` e todos os chamadores em `src/workers/` e
`scripts/verificar/` viram `async`. O segundo custo é o teto de 300 segundos por
invocação do plano Hobby, que passa a ser uma restrição de desenho de cada tarefa, e
não um detalhe de operação.

## 2. Contexto e alcance

Hoje um processo Bun só faz tudo: serve HTTP, abre o SQLite, roda um laço por papel
com lease de 60 segundos e batida de coração a cada 20, e grava artefatos em
`<dir>/<sha[0:2]>/<sha>.<ext>` com modo 0444. O processo nunca morre de propósito, e
quando morre o reconciliador recompõe o trabalho pelo banco.

Na Vercel não existe processo que fique de pé. Existe função que acorda com uma
requisição, faz o que dá em até 300 segundos e morre. Não existe disco que sobreviva
à invocação, não existe `bun:sqlite`, e o cron do plano Hobby roda uma vez por dia,
não de minuto em minuto.

Este desenho cobre a troca dessas três dependências e a construção do site da Fase 3
sobre elas. Não cobre o blog, que é a Fase 4, nem a publicação automática no
Instagram, que segue fora desde julho.

Quando isto entrar no ar, o Ricardo abre um endereço no celular, entra com e-mail e
senha, escreve um tema, acompanha o pedido andar pelas etapas, compara três direções,
pede ajuste, aprova e baixa o PNG mestre. O servidor não participa de nada disso.

## 3. Onde a mudança encosta

```
hoje                                    depois
-----------------------------------     -----------------------------------
Telegram  ->  container Bun             navegador ->  Vercel (mesmo domínio)
              :3010 no servidor                       Next.js: tela + API
              SQLite em data/                         Neon Postgres
              artefatos em disco                      Vercel Blob
              laço vivo por papel                     fila drenada na requisição
              CI -> ghcr -> watchtower                push na main -> deploy
```

Fronteiras que não mudam. O plano de controle continua o único escritor do estado. As
duas máquinas de estado continuam tabela de transição com um chokepoint só. A fila
continua com lease e época. Os artefatos continuam imutáveis e endereçados por
conteúdo. A aprovação continua presa a uma rodada, e rodada vencida continua sendo
recusada.

Sistemas de fora que o projeto toca: DeepSeek para direção e texto, Gemini Nano
Banana 2 para imagem, Linear para o registro do pedido. Nenhum deles muda.

Sai da lista de sistemas tocados: GitHub Container Registry, Watchtower, Caddy,
Tailscale e o runner self-hosted.

## 4. Desenho

### Como funciona, do começo ao fim

O Ricardo abre `https://<dominio>/`, entra com e-mail e senha. O better-auth grava a
sessão num cookie `HttpOnly`, `Secure`, `SameSite=Lax`. Tela e API estão no mesmo
domínio, então o cookie é de primeira parte e o Safari do iPhone não bloqueia. Essa é
a razão pela qual a Vercel foi descartada em 16/09 e volta agora: naquele desenho só
a tela iria para lá, e a API ficaria no servidor.

Ele escreve o tema e escolhe Feed. O `POST /api/fluxos` abre a transação no Neon,
grava `workflow_runs` em `requested`, grava o evento e cria a tarefa do estado. Antes
de responder, o handler chama `bombear()`, que reivindica uma tarefa e a executa. Se a
resposta precisar sair antes, o que sobra continua em `waitUntil`, que mantém a função
viva depois do corpo enviado.

A tela passa a consultar `GET /api/fluxos/:id` a cada 1,5 segundo. Cada consulta
devolve a `VistaFluxo` e também bombeia a fila. Enquanto o Ricardo olha a tela, o
trabalho anda; é ele quem fornece o relógio.

O designer gera a primeira arte, publica como versão imutável no Blob e no banco, e
consulta o orçamento de tempo da invocação. Passou de 210 segundos, ele para e devolve
`continuar`. A tarefa volta para `pendente` sem mudar o estado do fluxo, e a próxima
requisição pega de onde parou, porque `modoDoDesigner` recalcula o que falta a partir
das versões já publicadas. Isso já é assim hoje; a mudança é parar no meio de propósito.

As três artes prontas, o diretor de arte julga cada uma contra os gates do §3.4. O
fluxo entra em `awaiting_prototype_review`, e o bloco "Revisão do Ricardo" aparece
como decisão pendente. Ele compara as três, aceita uma. O `POST /api/fluxos/:id/decisao`
confere a rodada, o papel da conta e a chave de idempotência, grava a aprovação e
salta para a entrega. O download do mestre sai do Blob por URL assinada de vida curta,
e fica registrado em `deliveries`.

### Componentes e o que cada um é dono

**`src/controle/db.ts`.** Continua o único arquivo que abre conexão. Passa a exportar
um pool do Neon em vez de um `Database`, e `emTransacao` vira `async`. Ele não é dono
de regra nenhuma de negócio, não sabe o que é fluxo nem tarefa, e continua sendo o
arquivo que o gate de fronteira vigia.

**`src/controle/*`, o plano de controle.** Dono do estado e único escritor. Ganha
`async` em toda a superfície e perde nada de regra. Não é dono de autorização de
sessão: ele recebe a conta e o papel já resolvidos e decide se aquele papel pode
aquela ação.

**`src/fila/bombear.ts`, novo.** Dono de decidir quando parar. Reivindica tarefas de
uma lista de papéis, executa uma de cada vez, respeita o orçamento de tempo e devolve
quantas rodaram. Não é dono de aresta nenhuma da máquina de estados e não escolhe
destino: isso continua no executor e no plano de controle.

**`src/workers/*`, os executores.** Donos do trabalho de cada papel. Ganham o
resultado `continuar` e a obrigação de serem retomáveis. Não são donos do relógio: o
orçamento chega de fora.

**`app/`, o Next.js.** Dono da tela e das rotas HTTP. Ele resolve a sessão, extrai a
conta e o papel e repassa. Não é dono de autorização de conteúdo e não recalcula
regra: `vistaDoFluxo` continua função pura do plano de controle, e a tela desenha o
que vier em `acoes`.

**`src/artefatos/blob.ts`, novo.** Dono dos bytes. Grava por chave derivada do SHA-256
e devolve URL assinada para leitura. Não é dono da linhagem nem da versão, que
continuam linhas no banco.

### Decisões

**Neon Postgres no lugar do SQLite.** Escolha do Henrique em 17/09/2026, com o Turso
na mesa e recusado. O Neon já roda o REP Campo, então é uma conta a menos. O preço é
concreto e vale escrever: os seis gatilhos `BEFORE UPDATE/DELETE` que fazem `events`,
`approvals` e `artifact_versions` serem append-only viram funções plpgsql; a cerca de
`BEGIN IMMEDIATE` vira o comportamento normal de transação do Postgres; e o predicado 1
do arnês, que hoje mata o processo com SIGKILL para provar a recuperação do WAL, muda
de natureza, porque no Postgres a prova equivalente é a transação abortada não deixar
estado pela metade.

**Vercel Blob no lugar do disco.** Não há alternativa dentro da Vercel, e o Blob já é
usado no REP Campo. A imutabilidade perde uma camada: o modo 0444 do arquivo não
existe. Sobram a chave derivada do conteúdo, que torna reescrita inofensiva, e os
gatilhos do banco. A armadilha conhecida vale aqui: a API de loja privada só aceita
`x-api-version: 7`, e a 11 e a 12 recusam com "Invalid pathname".

**A fila é drenada na requisição, e o cron é rede de segurança.** No plano Hobby o
cron da Vercel roda uma vez por dia, então não dá para ser o motor. Quem move o
trabalho é quem está olhando a tela. O cron diário existe só para devolver à fila
tarefa com lease vencida de pedido abandonado, e é a única coisa que anda sem ninguém
presente. A consequência honesta: pedido aberto e janela fechada fica parado até
alguém abrir a tela de novo ou o cron passar.

**Orçamento de 210 segundos por invocação.** O teto do Hobby é 300, e o corte fica
90 segundos abaixo para caber uma geração de imagem já começada. O executor confere o
orçamento entre peças, nunca no meio de uma chamada ao modelo.

**Parar no orçamento não conta como tentativa.** Isto é uma armadilha do código de
hoje, e vale escrever para a implementação não a inventar errado. `reivindicar`
incrementa `tentativas` em toda reivindicação, e `max_tentativas` é 3 por padrão. Sem
tratamento, uma tarefa que precisa de três invocações para terminar iria para
`revisao_manual` justamente por estar progredindo. O caminho `continuar` decrementa
`tentativas` na mesma transação em que devolve a tarefa para `pendente`. O incremento
continua na reivindicação, e não na falha, porque invocação que morre não chama
ninguém: se o incremento morasse em `falhar()`, uma tarefa que sempre mata o worker
tentaria para sempre. Com a correção, `tentativas` passa a significar reivindicações
que não produziram progresso, que é o que `max_tentativas` sempre quis contar.

**Next.js App Router no lugar de Vite+ com Elysia.** O desenho de 16/09 escolheu
Vite+ e Elysia porque o alvo era um processo Bun no servidor. Na Vercel o Next.js é o
caminho que não precisa de adaptador para nada, e resolve o mesmo requisito de origem
única que motivou a escolha anterior. React 19, Tailwind 4, Motion, nuqs e
`@xyflow/react` continuam iguais, e os sete componentes do Unlumen que exigiam `next`
deixam de ficar de fora.

**O runtime de produção é Node, e o de desenvolvimento continua Bun.** A Vercel não
roda Bun em função. O código não pode usar API só do Bun fora de `scripts/`, e o CI
tem que rodar a suíte nos dois runtimes. A lição de 25/08 já está escrita em
`STATE.md`: portão que só roda num ambiente não prova o outro.

**A suíte roda dentro do build da Vercel.** Hoje o estágio `verificar` do Dockerfile
segura a imagem, e imagem vermelha nunca existe. Com deploy por integração git, um
push vermelho subiria. Para não perder o portão, `bun run verificar` entra no comando
de build, e suíte vermelha derruba o build antes da promoção. O banco da suíte é
PGlite, Postgres embarcado, para o arnês continuar rodando sem rede e sem segredo.

**O Telegram sai inteiro nesta leva.** Já era o plano da Fase 3 e não muda. O bot
nunca entrou no ar, o webhook nunca foi registrado e a allowlist está vazia desde
sempre, então não há usuário para migrar.

**O servidor é desativado no fim, não no começo.** O container, o `compose.yml` fora
da pasta de dono, o `deploy.yml` com ghcr e watchtower e o vhost do Caddy só saem
depois do primeiro pedido real concluído na Vercel. Enquanto isso o container fica
de pé sem tráfego, e é rollback.

## 5. Invariantes e requisitos

### Invariantes

- `INV-1`: só `src/controle/db.ts` abre conexão com o banco. Nenhum outro arquivo de
  `src/` importa o driver do Postgres.
- `INV-2`: `events`, `approvals` e `artifact_versions` não aceitam `UPDATE` nem
  `DELETE`, e a recusa vem do banco, não do código da aplicação.
- `INV-3`: uma tarefa em execução só grava se a época da lease dela ainda for a
  corrente. Worker zumbi que voltou a si não escreve linha.
- `INV-4`: duas invocações concorrentes nunca executam a mesma tarefa. A reivindicação
  é uma transação só.
- `INV-5`: nenhuma invocação de função passa de 300 segundos. O executor para no
  orçamento e devolve `continuar`.
- `INV-6`: nenhuma rota que leia ou escreva dado de fluxo responde sem sessão válida.
- `INV-7`: autorização é decidida no plano de controle. A tela não é fonte de verdade
  de nada que o servidor não confira de novo.
- `INV-8`: decisão de rodada vencida é recusada, e o segundo toque na mesma decisão
  vira uma decisão só, não um erro na cara de quem clicou.
- `INV-9`: os bytes de uma versão de artefato nunca mudam. Mesma chave significa
  mesmo conteúdo.
- `INV-10`: nenhum código fora de `scripts/` usa API exclusiva do Bun.
- `INV-11`: uma tarefa que para no orçamento e retoma não consome tentativa. Só
  reivindicação sem progresso conta para `max_tentativas`.

### Requisitos

O Ricardo consegue fazer o ciclo inteiro pelo celular, de qualquer rede, só com o
link e a conta. Toda mudança de etapa aparece na tela em até 2 segundos enquanto ela
está aberta. O download entrega o mestre com o mesmo SHA-256 que foi aprovado. Uma
conta com papel `solicitante` não aprova arte. Contas são criadas pelo Henrique, e
não existe cadastro aberto nem recuperação de senha nesta fase.

## 6. Interfaces e dados

As rotas são as que o desenho da Fase 3 definiu, agora como route handlers do Next:

```
POST /api/entrar                     e-mail e senha, better-auth
POST /api/sair
GET  /api/eu                         conta e papel da sessão
GET  /api/fluxos                     pedidos visíveis, pendências primeiro
POST /api/fluxos                     abre um pedido
GET  /api/fluxos/:id                 VistaFluxo com as ações permitidas
GET  /api/fluxos/:id/etapas/:etapa   tentativas, entrada, saída e versões
POST /api/fluxos/:id/decisao         confirmar, aceitar, ajustar, recusar, cancelar
GET  /api/artefatos/:versaoId/previa  redireciona para URL assinada, papel preview
GET  /api/artefatos/:versaoId/mestre  download do mestre, registra entrega
POST /api/contas                     admin cria conta e papel
POST /api/cron/reconciliar           cron diário, protegido por CRON_SECRET
```

O SSE do desenho anterior sai. Uma conexão aberta na Vercel consome duração de função
o tempo todo que fica de pé, e no Hobby isso é o mesmo orçamento que faz o trabalho
andar. A tela consulta `GET /api/fluxos/:id` a cada 1,5 segundo, o que cabe no
requisito de 2 segundos e ainda bombeia a fila a cada passada.

### Migração e esquema

As migrações 001 a 003 são reescritas em dialeto Postgres num arquivo só, porque
nenhum banco de produção existe para migrar: o `data/` do servidor está vazio, 0
bytes. Isso é sorte e vale usar. `TEXT` continua `TEXT`, `INTEGER` de instante vira
`timestamptz`, `datetime('now')` vira `now()`, e `json` guardado como texto vira
`jsonb`. A reivindicação da fila ganha `FOR UPDATE SKIP LOCKED`, que o SQLite não tem
e que torna a concorrência entre invocações barata.

A migração 004, que o desenho da Fase 3 já previa, entra junto: `chat_id` e
`solicitante_id` viram `conta_id TEXT`, `approvals.reviewer_id` vira `TEXT`, a tabela
`conversas` cai e `deliveries` perde o que descrevia canal do Telegram.

### Nomes e identidade

Os ids de fluxo, tarefa e versão continuam gerados por `src/controle/ids.ts`, do
nosso lado, e não dependem de nada da Vercel nem do Neon. A conta ganha id do
better-auth, que é o dono dessa tabela. A chave do Blob é `<sha[0:2]>/<sha>.<ext>`,
derivada do conteúdo, então nunca colide de forma ambígua: chave igual é conteúdo
igual. Gravar duas vezes o mesmo conteúdo é idempotente por construção.

Se o e-mail de uma conta mudar, o id não muda, e as decisões antigas continuam
apontando para a conta certa. `events.ator` grava `conta:<id>`; os registros antigos
com `telegram:<id>` ficam como estão, porque a tabela é append-only.

### Configuração

Variáveis no projeto da Vercel: `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CRON_SECRET`, `ADAPTADORES`,
`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `LINEAR_API_KEY`, `LINEAR_LABEL_ID`.

Somem: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_IDS`,
`APROVADOR_TELEGRAM_ID`, `DB_PATH`, `ARTIFACTS_DIR`, `PORT`, `WATCHTOWER_TOKEN`,
`IG_PAGE_TOKEN`, `IG_USER_ID`.

Os três perfis continuam: `fake` no arnês, `ensaio` com modelos falsos para o loop
inteiro sem chave, `real` exigindo DeepSeek, Gemini e Linear. Com o Telegram fora, o
`ensaio` deixa de precisar de qualquer chave, o que o torna o perfil certo para o
primeiro deploy.

## 7. Falha e ciclo de vida

**A função morre no meio de uma tarefa.** É o caso comum, não o excepcional. A lease
de 60 segundos vence, o reconciliador devolve a tarefa para `pendente`, e a próxima
requisição a pega. Os efeitos já gravados ficam: artes publicadas não são geradas de
novo, porque o executor deriva o que falta do que existe.

**O modelo demora mais que o orçamento.** O executor não interrompe chamada em curso.
Ele confere o orçamento entre peças. Uma única chamada que passe de 300 segundos
estoura a invocação e cai no caso acima, perdendo o custo daquela geração. Essa
reivindicação não produziu progresso, então conta tentativa, e na terceira a tarefa
vai para `revisao_manual` em vez de queimar crédito em laço. É o comportamento que
`max_tentativas` já tem hoje, agora com o significado certo pelo `INV-11`.

**O Neon está suspenso.** O plano gratuito desliga a computação depois de 5 minutos
parada, e a primeira consulta acorda o banco. Isso aparece como meio segundo a mais na
primeira requisição de quem chega. Não é erro e não precisa de tratamento.

**As 100 CU-hours do mês acabam.** O Neon suspende o projeto até o mês virar. Toda
rota de dado passa a devolver erro. O desenho não esconde isso: a tela mostra que o
banco não respondeu, e o Henrique decide entre esperar ou pagar.

**Ninguém abre a tela.** O trabalho para. É a consequência aceita de drenar a fila na
requisição, e o cron diário é o único piso: no pior caso um pedido esquecido espera
24 horas até o cron passar, e mesmo aí o cron só devolve tarefa com lease vencida à
fila, sem executar nada. Se doer, o remédio é o plano Pro com cron
de minuto em minuto, e a mudança é uma linha no `vercel.json`.

**Duas abas do mesmo Ricardo.** Ambas bombeiam, e `FOR UPDATE SKIP LOCKED` garante
que cada tarefa vai para uma só. Duplo toque no mesmo botão vira uma decisão só pela
chave de idempotência.

**Deploy no meio de um pedido.** A Vercel troca as funções, não o banco. Tarefa em
execução perde a invocação, a lease vence e outra requisição retoma. Não há estado em
memória para perder, que é a propriedade que o plano de controle já tinha.

## 8. Segurança, privacidade e operação

A fronteira de confiança é o cookie de sessão. Tudo atrás dele; nada de fluxo responde
sem ele. O papel da conta é coluna no banco e é lido a cada requisição, não confiado do
cliente. A barra por tentativa de senha conta por conta e por IP, e o IP vem do
`x-forwarded-for` que a Vercel escreve.

As URLs do Blob são assinadas e de vida curta, e a rota de prévia recusa qualquer
papel de artefato que não seja `preview`. O protótipo é gravado com papel `master`,
então servir "o protótipo" sem essa checagem seria servir o mestre sem querer.

Os segredos ficam nas variáveis de ambiente do projeto da Vercel, e nenhum fica no
repositório. Isso é melhor do que hoje, onde `/etc/emvidros/em-marketing.env` é um
arquivo no servidor.

Os limites que este projeto passa a dividir, todos no plano Hobby:

- Neon, 0,5 GB de armazenamento e 100 CU-hours por mês, por projeto. Um projeto novo,
  separado do REP Campo, para as cotas não se misturarem.
- Vercel Blob, 1 GB de armazenamento e 10 GB de transferência por mês, contados junto
  com o resto da conta Hobby, e aí o REP Campo entra na conta.
- Função, 300 segundos de teto, que é o `INV-5`.
- Cron, uma execução por dia.

O limite que aperta primeiro é 1 GB de Blob. Um pedido guarda três mestres mais
prévias, e um mestre em 2K não é pequeno. A retenção de artefatos está em aberto no
PRD §4.11 desde agosto, e aqui ela deixa de ser teórica: sem regra de retenção o
armazenamento enche. A proposta é apagar prévias de rodada vencida depois de 30 dias e
manter os mestres aprovados.

## 9. Critérios de aceite

- `AC-1`: `bun run verificar` passa contra PGlite, sem rede e sem segredo, e o mesmo
  comando passa rodando em Node.
- `AC-2`: um push na `main` com a suíte vermelha não promove deploy.
- `AC-3`: entrar com senha certa funciona; com senha errada não; e a quinta tentativa
  seguida é barrada.
- `AC-4`: nenhuma rota de `/api` que toque fluxo responde 200 sem cookie de sessão.
- `AC-5`: um pedido em `ensaio` vai do tema ao download pelo navegador, e nenhuma
  invocação da função passa de 300 segundos.
- `AC-6`: uma decisão de rodada anterior é recusada, e o duplo toque grava uma decisão
  só.
- `AC-7`: uma conta `solicitante` não vê o botão de aprovar arte, e o `POST` da
  decisão feito na mão por essa conta é recusado pelo servidor.
- `AC-8`: matar a invocação no meio da geração das três artes e retomar não gera de
  novo o que já foi publicado, e o SHA-256 do mestre baixado é o do aprovado.
- `AC-9`: `grep -ri telegram src/ app/ scripts/` não acha nada.
- `AC-11`: uma tarefa que para no orçamento quatro vezes seguidas e progride em todas
  termina o trabalho, e não cai em `revisao_manual`.
- `AC-10`: o Ricardo abre o link no celular dele, entra, pede, ajusta, aprova e baixa,
  sem ajuda. É a prova da fase.

## 10. Como cada coisa é provada

`INV-1` e `INV-10` são gate estático em `scripts/verificar/fronteira.ts`, que hoje já
proíbe `bun:sqlite` fora de `db.ts`. Ele ganha dois padrões: o driver do Postgres e as
APIs do Bun fora de `scripts/`. Prova contra sabotagem, como já se faz: plantar a
violação e ver o arnês ficar vermelho.

`INV-2` é a suíte de fronteira tentando `UPDATE` nas três tabelas e esperando o erro
do banco. `INV-3` e `INV-4` são o predicado 2 adaptado, com duas conexões
concorrentes disputando a mesma tarefa em vez de dois processos.

`INV-5`, `INV-11`, `AC-8` e `AC-11` são a suíte nova de orçamento: um adaptador falso que demora,
orçamento curto, e a conferência de que o executor parou, devolveu `continuar` e
retomou sem repetir efeito.

`INV-6`, `INV-7`, `AC-3`, `AC-4` e `AC-7` são a suíte de sessão, batendo em cada rota
sem cookie, com cookie de papel errado e com cookie válido.

`INV-8` e `AC-6` são o predicado 2, que já existe e continua valendo palavra por
palavra.

`INV-9` é o predicado 3 adaptado: a mesma entrega duas vezes produz um download só, e
o SHA-256 do ida e volta bate com o mestre.

`AC-5` é a suíte `ponta-a-ponta` reescrita para dirigir o loop por HTTP com sessão, no
lugar dos updates sintéticos do Telegram. Ela não some, muda de canal.

`AC-1` e `AC-2` são o CI. `AC-10` é o Ricardo, e não tem substituto automático.

## 11. Riscos

- **O porte para `async` toca quase todo o plano de controle e pode trazer bug de
  concorrência que o SQLite escondia**, porque lá a transação era serializada por um
  lock de escrita só. Mitigação: as transações continuam explícitas e curtas, e a
  reivindicação passa a usar `FOR UPDATE SKIP LOCKED` em vez de depender do lock global.
- **O arnês roda em PGlite e a produção roda em Neon.** São o mesmo Postgres, mas não
  a mesma versão nem o mesmo caminho de rede. Mitigação: uma suíte de fumaça contra um
  branch do Neon, rodada à mão antes de cada entrega grande, e não no caminho do CI.
- **O Hobby é para uso não comercial**, e o em-marketing é ferramenta de trabalho da
  EM Vidros. Mitigação nenhuma do meu lado; é decisão do Henrique, tomada com o fato na
  mesa, e o mesmo já vale para o REP Campo.
- **Trabalho só anda com alguém olhando.** Mitigação: o cron diário e, se doer, o
  plano Pro.
- **1 GB de Blob divide com o REP Campo.** Mitigação: regra de retenção antes do
  primeiro uso real, não depois.
- **`sharp` e as fontes da marca precisam entrar no pacote da função.** O `laco.ts` lê
  o logo com `readFileSync` a partir de `brand/tokens.json`, e sem as fontes o `resvg`
  cai num fallback que muda os bytes de execução para execução. Mitigação:
  `outputFileTracingIncludes` no `next.config`, e uma verificação que compara o SHA de
  uma composição conhecida dentro do ambiente de produção.

## 12. Perguntas em aberto

- Endereço: `em-marketing.vercel.app` ou `mkt.emvidros.com.br` apontando para a Vercel
  pelo DNS da Wix. Não bloqueia; o padrão é começar no `vercel.app`, como o REP Campo,
  e trocar depois sem mexer no código. O `docs/superpowers/specs/2026-08-31-publicacao-apps-diretores-wix-design.md`
  já descreve o caminho do DNS.
- Retenção de artefatos. Não bloqueia escrever código, bloqueia o primeiro uso real.
  Proposta acima, na seção 8.
- Substituto do Ricardo como aprovador. O PRD promete desde agosto e o código nunca
  teve. Não bloqueia.
- Quando desligar o container do servidor. Proposta: depois do `AC-10`.

## 13. Fora deste desenho

Blog, que é a Fase 4. Publicação e agendamento automáticos no Instagram. Calendário.
Aviso externo por WhatsApp ou e-mail quando algo espera decisão, que o Henrique já
deixou fora da Fase 3 em 16/09. Cadastro livre, convite por link e recuperação de
senha. Custo por tarefa no inspetor. Delegação de aprovador. Migrar qualquer dado do
servidor, porque não existe dado.
