# Fábrica no servidor, site na Vercel

> **Status:** proposto para revisão
>
> Escrito em 17/09/2026. Substitui a versão do mesmo dia, que levava o projeto
> inteiro para a Vercel com Neon e Blob. O Henrique decidiu depois que o banco e os
> arquivos ficam no servidor da EM Vidros, e que o deploy continua sendo na Vercel.
> A numeração de `INV-n` e `AC-n` recomeça, porque nada foi implementado nem citado
> na versão anterior.
>
> `.specs/features/fabrica/DESIGN.md` continua valendo para telas, papéis, vista do
> fluxo, arestas e a lista do que sai junto com o Telegram.

## 1. Resumo

O em-marketing está pronto desde 28/08 e ninguém nunca usou. As 13 suítes passam, o
container roda há semanas em `127.0.0.1:3010`, e o Ricardo não tem como abrir nada,
porque o endereço público nunca existiu. O ACME do wildcard `*.emvidros.com.br` falha
nos dois desafios desde agosto, e o problema é da borda 80/443 da empresa, que cai no
proxy `192.168.14.23`, não deste projeto.

A decisão do Henrique em 17/09/2026 tem duas metades. O deploy vai para a Vercel. O
banco e os artefatos ficam no servidor da EM Vidros.

Então o sistema passa a ter dois lados. A fábrica continua no servidor, do jeito que
já é: processo Bun único, SQLite, laço vivo por papel, artefato em disco com modo
0444. Ela ganha uma API HTTP e o better-auth por cima do que já existe. O site nasce
na Vercel como aplicação Next.js, desenha as telas e repassa cada chamada para a
fábrica. A ponte entre os dois é o Tailscale Funnel, que dá o certificado válido que
nunca existiu e não depende da borda quebrada.

O custo principal é que passam a existir dois deploys e um salto a mais em cada
requisição. O site na Vercel não compra disponibilidade nenhuma: servidor fora do ar
significa site fora do ar, agora com uma tela bonita dizendo isso. O custo secundário
é que o cookie de sessão nasce na fábrica e chega ao navegador atravessando o proxy do
site, e essa é a parte que precisa estar certa para o Safari do iPhone não recusar.

Em troca, as cerca de 1.800 linhas de `src/controle/` não são tocadas. Não há porte
para `async`, não há troca de banco, não há orçamento de tempo por invocação e não há
cron. O trabalho que sobra é o site, a API que o alimenta e a ponte.

## 2. Contexto e alcance

Hoje um processo Bun só faz tudo: serve HTTP, abre o SQLite, roda um laço por papel
com lease de 60 segundos e batida de coração a cada 20, e grava artefatos em
`<dir>/<sha[0:2]>/<sha>.<ext>`. O único canal de entrada é um webhook do Telegram que
nunca foi registrado, para uma allowlist que está vazia desde sempre. O container
responde só em `127.0.0.1:3010`, então de fora da máquina não existe.

Este desenho cobre três coisas: o endereço público, a API e a sessão que a fábrica
passa a oferecer, e o site da Fase 3 construído sobre elas na Vercel. Não cobre o
blog, que é a Fase 4, nem a publicação automática no Instagram, que segue fora desde
julho.

Quando isto entrar no ar, o Ricardo abre um endereço no celular, entra com e-mail e
senha, escreve um tema, acompanha o pedido andar pelas etapas, compara três direções,
pede ajuste, aprova e baixa o PNG mestre.

Não há dado para migrar. O `data/` do servidor tem 0 bytes, porque nenhum pedido real
jamais entrou. Isso é sorte e vale usar: o esquema pode mudar sem cuidado de migração.

## 3. Onde a mudança encosta

```
hoje                                    depois
-----------------------------------     -----------------------------------
Telegram  ->  container Bun             navegador ->  Vercel
              :3010, só localhost                     Next.js, só tela e proxy
              SQLite em data/                            |
              artefatos em disco                         | HTTPS + token
              laço vivo por papel                        v
              nenhum endereço público               Tailscale Funnel
                                                    emvidros-srv.tail585ce3.ts.net
                                                         |
                                                         v
                                                    container Bun :3010
                                                    SQLite, artefatos, laço vivo
```

Fronteiras que não mudam. O plano de controle continua o único escritor do estado. As
duas máquinas de estado continuam tabela de transição com um chokepoint só. A fila
continua com lease e época. Os artefatos continuam imutáveis e endereçados por
conteúdo. A aprovação continua presa a uma rodada, e rodada vencida continua sendo
recusada. O laço vivo continua sendo quem move o trabalho.

Sistemas de fora que o projeto toca: DeepSeek para direção e texto, Gemini Nano
Banana 2 para imagem, Linear para o registro do pedido. Nenhum deles muda, e todos
continuam sendo chamados de dentro do servidor, com as chaves que já estão lá.

Entram na lista: Vercel, para hospedar o site, e Tailscale Funnel, para o endereço.

Saem: Telegram, e o vhost do Caddy que nunca funcionou. O Funnel aponta direto para
`127.0.0.1:3010`, então não há proxy intermediário no caminho.

Continuam: GitHub Container Registry, Watchtower e o runner self-hosted, que seguem
publicando o container da fábrica.

## 4. Desenho

### Como funciona, do começo ao fim

O Ricardo abre `https://em-marketing.vercel.app/` no iPhone. O Next.js serve a tela de
entrada. Ele digita e-mail e senha, e o `POST /api/auth/sign-in/email` bate no site,
que repassa a chamada para a fábrica pelo Funnel, com o token do site no cabeçalho
`Authorization`. O better-auth, que roda na fábrica e grava no mesmo SQLite, confere a
senha e devolve `Set-Cookie`. O proxy do site repassa esse cabeçalho sem tocar nele. O
navegador guarda o cookie no domínio da Vercel, que é o único domínio com que ele
falou, então o cookie é de primeira parte e o Safari não bloqueia.

Ele escreve o tema e escolhe Feed. O `POST /api/fluxos` atravessa o mesmo caminho. Na
fábrica, o handler resolve a sessão pelo cookie, pega a conta e o papel, e chama
`criarControle().paraSite.abrirFluxo()`. A transação grava `workflow_runs` em
`requested`, grava o evento e cria a primeira tarefa. A resposta volta em uma ida e
volta, porque abrir pedido é escrita curta.

O laço vivo dentro do container já está rodando. Em até um segundo ele reivindica a
tarefa nova e começa. Ninguém precisa estar olhando a tela para o trabalho andar, o
que é a diferença central para o desenho anterior.

A tela consulta `GET /api/fluxos/:id` a cada 2 segundos enquanto o fluxo está aberto.
Cada consulta é uma invocação de função na Vercel que repassa e devolve a `VistaFluxo`
inteira. A tela redesenha o canvas com os blocos e arestas que vierem.

O designer gera as três artes, publica cada uma como versão imutável em disco e no
banco, e o diretor de arte julga contra os gates do §3.4. O fluxo entra em
`awaiting_prototype_review` e o bloco "Revisão do Ricardo" aparece como decisão
pendente. Ele compara as três e aceita uma. O `POST /api/fluxos/:id/decisao` confere a
rodada, o papel da conta e a chave de idempotência, grava a aprovação e salta para a
entrega.

O download do mestre é `GET /api/artefatos/:versaoId/mestre`. O site repassa, a
fábrica confere a sessão, lê o arquivo, confere o SHA-256 contra o que está no banco,
registra a entrega e devolve os bytes. Eles voltam pelo Funnel, atravessam a função da
Vercel e chegam ao navegador. O endereço `ts.net` nunca aparece no HTML.

### Componentes e o que cada um é dono

**A fábrica, `src/` no container do servidor.** Dona do estado, da fila, dos workers,
dos bytes dos artefatos e das sessões. Continua sendo o único escritor. Não é dona de
nenhuma tela e não sabe o que é Vercel.

**`src/controle/*`.** Não muda, fora da migração 004. Continua síncrono, continua em
`bun:sqlite`, continua decidindo autorização por papel. Não é dono de identidade: ele
recebe conta e papel já resolvidos.

**`src/http/rotas.ts`, novo.** Dono da superfície HTTP e da conferência do token do
site. Traduz requisição em chamada do plano de controle e erro de domínio em código de
status. Não é dono de regra de negócio nenhuma e não escreve no banco direto.

**`src/auth.ts`, novo.** Dono da identidade. Recebe de `db.ts` a mesma instância do
`Database` e entrega ao better-auth, que cria as tabelas dele no mesmo arquivo. Não é
dono do mapa de papel para ação, que continua no plano de controle.

**`site/`, o Next.js na Vercel.** Dono da tela e do repasse. Resolve nada e decide
nada: pega a requisição do navegador, injeta o token, repassa para a fábrica e devolve
o que vier, incluindo `Set-Cookie`. Não é dono de estado, não abre banco, não guarda
arquivo e não tem chave de modelo nenhuma.

**O Tailscale Funnel.** Dono do endereço público e do certificado. Não é dono de
autorização: ele entrega para a fábrica tudo que chegar, e quem recusa é a fábrica.

### Decisões

**O dado fica no servidor e o deploy vai para a Vercel.** Decisão do Henrique em
17/09/2026, tomada depois de eu recomendar o contrário. O que ela custa está escrito no
resumo e nos riscos, e o que ela dá é deploy por push sem o servidor no caminho, mais
o dado dentro de casa. Eu registro a recomendação recusada porque ela volta a importar
se um dia a latência ou os dois pipelines incomodarem.

**A ponte é HTTPS com token, não Postgres exposto.** A alternativa era expor o banco
pela internet com `tailscale funnel --tcp` e deixar a função da Vercel falar SQL
direto. Ela foi recusada por duas razões. Obrigaria a trocar o SQLite por Postgres, e
com isso a portar para `async` as cerca de 1.800 linhas de `src/controle/` e todos os
chamadores. E poria um motor SQL inteiro na internet pública, sem IP fixo de saída na
Vercel para fechar por firewall. Com HTTPS, a superfície exposta é só a lista de rotas
que eu escrevi.

**O SQLite fica.** Não há ganho em trocar. O escritor é único e mora na mesma máquina
do arquivo, que é exatamente o caso em que o SQLite ganha. O `emvidros-postgres` que
já roda no servidor foi considerado e recusado pelo mesmo motivo, mais um: colocaria o
em-marketing na mesma instância da controladoria e dos dois n8n, sem necessidade.

**O better-auth roda na fábrica, e o site repassa o cookie.** A alternativa era rodar
o better-auth na Vercel com um adaptador de banco feito à mão falando HTTP com a
fábrica. Recusada por ser mais código e mais superfície para errar. Rodando na fábrica,
o `baseURL` é o endereço da Vercel, e o better-auth trata `baseURL` estático como
prioritário sobre cabeçalho de proxy, então ele emite cookie e link de callback com o
domínio certo mesmo recebendo a requisição pelo `ts.net`. O `trustedOrigins` recebe o
mesmo endereço, e requisição de origem fora da lista leva 403.

**O site é proxy, não cliente.** Todo byte que o navegador vê sai do domínio da Vercel.
Isso não é enfeite: é o que mantém o cookie de primeira parte, evita CORS inteiro e
impede que o nome `ts.net` vaze para o HTML. O repasse é um route handler com `fetch`,
e não um `rewrite` do `vercel.json`, por duas razões: `rewrite` não injeta cabeçalho, e
destino externo de `rewrite` tem teto de 120 segundos. O preço é que o download do
mestre passa pela função, e um mestre em 2K custa alguns segundos de duração e alguns
MB de transferência por download. Se um dia isso doer, a saída é a fábrica devolver URL
assinada de vida curta e o navegador buscar direto, e aí o `ts.net` aparece.

**Token compartilhado conferido antes de qualquer lógica.** O Funnel expõe o host para
a internet inteira, e o nome do host é público, porque o certificado dele entra nos
registros de Certificate Transparency. Então scanner vai bater na porta. Toda rota
confere um `Authorization: Bearer` contra `SITE_TOKEN` com comparação de tempo
constante, e responde 401 antes de tocar no banco. O cookie de sessão é a segunda
camada, e é ela que diz quem é a pessoa.

**A tela consulta a cada 2 segundos, e não há SSE.** Com o laço vivo na fábrica, o
único trabalho da consulta é ler. Duas fontes de tempo real sobre um proxy custam mais
do que valem para dois usuários, e stream aberto atravessando função da Vercel esbarra
no teto de duração dela. Dois segundos cabe no requisito de a tela acompanhar a etapa.

**O laço vivo fica, e some tudo que existia para substituí-lo.** O desenho anterior
tinha orçamento de 210 segundos por invocação, resultado `continuar`, decremento de
tentativa e cron diário de rede de segurança. Nada disso entra: o processo no servidor
não morre no meio, e o reconciliador de 30 em 30 segundos já cobre o que morre.

**Next.js mesmo com o site sendo quase só tela.** O Next.js é o caminho sem adaptador
na Vercel, e os sete componentes do Unlumen que exigem `next` deixam de ficar de fora.
Também mantém a porta aberta: se um dia o dado mudar de casa, o site não é reescrito.

**Dois portões de teste, um para cada lado.** O estágio `verificar` do Dockerfile
continua segurando a imagem da fábrica, então imagem vermelha nunca existe. O site
ganha o próprio, rodando no comando de build da Vercel, e build vermelho não promove.
Nenhum dos dois cobre o outro, e isso é aceito de propósito: são dois artefatos com
dois ciclos de vida.

**O Telegram sai inteiro nesta leva.** Já era o plano da Fase 3. Morrem
`src/telegram/conversa.ts`, `src/adaptadores/telegram.ts`,
`src/workers/apresentador.ts` e `src/controle/conversas.ts`. Não há usuário para
migrar, porque nunca houve usuário.

## 5. Invariantes e requisitos

### Invariantes

- `INV-1`: só `src/controle/db.ts` abre o banco. O better-auth recebe a instância
  pronta e não abre a sua.
- `INV-2`: `events`, `approvals` e `artifact_versions` não aceitam `UPDATE` nem
  `DELETE`, e a recusa vem do banco.
- `INV-3`: uma tarefa em execução só grava se a época da lease ainda for a corrente.
- `INV-4`: duas execuções concorrentes nunca pegam a mesma tarefa.
- `INV-5`: nenhuma rota de `/api` na fábrica executa lógica sem o token do site
  conferido. Sem token válido, a resposta é 401 e nada é lido nem gravado. O `/health`
  é a única exceção, porque o healthcheck do Docker bate nele de dentro do container e
  ele não toca no banco.
- `INV-6`: nenhuma rota que leia ou escreva dado de fluxo responde sem sessão válida.
- `INV-7`: autorização é decidida no plano de controle. A tela não é fonte de verdade
  de nada que a fábrica não confira de novo.
- `INV-8`: decisão de rodada vencida é recusada, e o segundo toque na mesma decisão
  vira uma decisão só, não um erro na cara de quem clicou.
- `INV-9`: os bytes de uma versão de artefato nunca mudam, e o SHA-256 é conferido na
  leitura antes de a resposta sair.
- `INV-10`: o navegador nunca fala com a fábrica direto. Nenhuma resposta do site
  contém o nome do host `ts.net`.
- `INV-11`: nada em `site/` abre banco, escreve arquivo ou guarda segredo de modelo. O
  site tem duas variáveis de ambiente e nenhuma delas é chave de terceiro.

### Requisitos

O Ricardo faz o ciclo inteiro pelo celular, de qualquer rede, só com o link e a conta.
Enquanto a tela de um fluxo está aberta, mudança de etapa aparece em até 4 segundos,
que são os 2 do intervalo de consulta mais a ida e volta. O download entrega o mestre
com o mesmo SHA-256 que foi aprovado. Uma conta com papel `solicitante` não aprova
arte. Contas são criadas pelo Henrique, e não existe cadastro aberto nem recuperação
de senha nesta fase.

## 6. Interfaces e dados

A fábrica passa a servir, além do `/health` que já existe:

```
POST /api/auth/*                      better-auth: entrar, sair, sessão
GET  /api/eu                          conta e papel da sessão
GET  /api/fluxos                      pedidos visíveis, pendências primeiro
POST /api/fluxos                      abre um pedido
GET  /api/fluxos/:id                  VistaFluxo com as ações permitidas
GET  /api/fluxos/:id/etapas/:etapa    tentativas, entrada, saída e versões
POST /api/fluxos/:id/decisao          confirmar, aceitar, ajustar, recusar, cancelar
GET  /api/artefatos/:versaoId/previa  bytes da prévia
GET  /api/artefatos/:versaoId/mestre  bytes do mestre, registra a entrega
POST /api/contas                      admin cria conta e papel
GET  /api/saude                       { ok, contrato, versao }
```

Some `POST /webhooks/telegram`.

No site, um route handler só, `app/api/[...caminho]/route.ts`, repassa tudo que chega
em `/api/` para `${FABRICA_URL}/api/...`. Ele copia o corpo, o método, e os cabeçalhos
`cookie`, `content-type` e `origin`; injeta o `Authorization`; e devolve a resposta
com `set-cookie` e `content-type` intactos. Ele não interpreta nada. As telas em
server component chamam a fábrica pelo mesmo caminho, do lado do servidor.

### O contrato entre os dois lados

Os dois lados sobem por pipelines diferentes, então ficam fora de passo por minutos.
`GET /api/saude` devolve `contrato`, um inteiro que sobe só em mudança que quebra. O
site conhece o número que espera. Diferente, ele mostra "a fábrica está sendo
atualizada, tente em um minuto" em vez de desenhar tela com dado que não entende. A
regra de ordem é: mudança que quebra vai para a fábrica primeiro, site depois. Campo
novo em resposta não quebra, e o site ignora o que não conhece.

### Migração e esquema

A migração 004, que o desenho da Fase 3 já previa, entra junto: `chat_id` e
`solicitante_id` viram `conta_id TEXT`, `approvals.reviewer_id` vira `TEXT`, a tabela
`conversas` cai, e `deliveries` perde as colunas que descreviam canal do Telegram. Como
o banco de produção está vazio, a migração não precisa preservar linha nenhuma.

O better-auth cria as tabelas dele no mesmo arquivo, com os nomes padrão (`user`,
`session`, `account`, `verification`). Elas ficam fora dos gatilhos de append-only,
porque sessão expira e é apagada de propósito.

### Nomes e identidade

Os ids de fluxo, tarefa e versão continuam gerados por `src/controle/ids.ts`, do nosso
lado. A conta ganha id do better-auth, que é o dono daquela tabela. `events.ator` passa
a gravar `conta:<id>`; os registros antigos com `telegram:<id>` ficam como estão,
porque a tabela é append-only. Se o e-mail de uma conta mudar, o id não muda, e as
decisões antigas continuam apontando para a conta certa.

O caminho do artefato continua derivado do conteúdo, `<sha[0:2]>/<sha>.<ext>`, então
gravar o mesmo conteúdo duas vezes é idempotente por construção.

### Configuração

No servidor, em `/etc/emvidros/em-marketing.env`, continuam `ADAPTADORES`,
`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `LINEAR_API_KEY`, `LINEAR_LABEL_ID`, `DB_PATH`,
`ARTIFACTS_DIR` e `PORT`. Entram `SITE_TOKEN`, `BETTER_AUTH_SECRET` e
`BETTER_AUTH_URL`, este último com o endereço da Vercel.

No projeto da Vercel, duas variáveis: `FABRICA_URL` e `SITE_TOKEN`.

Somem dos dois lados: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`TELEGRAM_ALLOWED_CHAT_IDS` e `APROVADOR_TELEGRAM_ID`.

A ponte é ligada com um comando, na conta do administrator:

```
tailscale funnel --bg 3010
```

O host inteiro fica para o em-marketing. Se outro serviço precisar de Funnel depois,
`--set-path` divide por caminho, e aí a fábrica precisa saber o prefixo.

## 7. Falha e ciclo de vida

**A fábrica está fora do ar.** O proxy do site recebe recusa de conexão ou estoura o
tempo. Ele responde 503 com um corpo que a tela entende, e a tela mostra que o servidor
da empresa não respondeu, com um botão de tentar de novo. Nada fica pela metade,
porque nada foi gravado. O site continua servindo a tela, e é só isso que ele pode
fazer sozinho.

**O Funnel caiu, mas a fábrica está de pé.** Do lado de fora é indistinguível do caso
acima, e a tela diz a mesma coisa. Do lado de dentro, `tailscale funnel status` mostra
a configuração vazia, e o comando acima a recoloca. Reinício do servidor não perde a
configuração, porque `--bg` a persiste.

**O Tailscale está lento.** O tráfego do Funnel passa por relay da Tailscale e tem
limite de banda não configurável. Uma consulta de `VistaFluxo` é pequena e não sente.
O download de um mestre sente. Se ele passar do teto de duração da função, o Ricardo vê
erro; a entrega já foi registrada, então ele pode tentar de novo e o registro não
duplica.

**O token do site foi trocado só de um lado.** Toda chamada leva 401 e a tela mostra
que o site não está autorizado a falar com a fábrica, que é uma mensagem diferente da
de servidor fora do ar, de propósito, porque a correção é diferente. Trocar o token é
pôr o valor novo nos dois lados, fábrica primeiro, aceitando os dois valores durante a
troca se ela não puder ser simultânea.

**Um lado subiu e o outro não.** É o contrato da seção 6. Site novo com fábrica velha
mostra o aviso de atualização e não desenha tela quebrada.

**O processo da fábrica morre no meio de uma tarefa.** É o comportamento que já existe
hoje e não muda: a lease de 60 segundos vence, o reconciliador devolve a tarefa para
`pendente`, e o laço a pega de novo. As artes já publicadas não são geradas outra vez,
porque `modoDoDesigner` recalcula o que falta a partir do que existe.

**O Watchtower troca o container no meio de um pedido.** Mesmo caso acima. A sessão do
Ricardo sobrevive, porque o better-auth guarda sessão no banco, e o banco está no
volume, não no container.

**O disco do servidor enche.** A escrita do artefato falha, a transação aborta, a
tarefa falha e entra no caminho de retentativa que já existe. Na terceira, vai para
`revisao_manual`. O `/api/saude` não mede disco, e isso fica para o Uptime Kuma, que já
roda no servidor.

**Tudo ruim ao mesmo tempo, no boot.** O container sobe, as migrações rodam, o
reconciliador passa e devolve à fila o que estava em voo. Se o banco não abrir, o
processo morre no boot e o Watchtower o reinicia em laço, e o sintoma externo é o 503
do primeiro caso.

## 8. Segurança, privacidade e operação

A fronteira de confiança tem duas camadas. A de fora é o token do site, que separa a
internet inteira do resto, e sem ele nenhuma rota faz trabalho. A de dentro é o cookie
de sessão, que diz quem é a pessoa. O papel da conta é coluna no banco, lido a cada
requisição, e nunca confiado do cliente.

O nome `emvidros-srv.tail585ce3.ts.net` é público, porque o certificado dele aparece
nos registros de Certificate Transparency. Partir do princípio de que ninguém vai achar
seria errado. É por isso que o 401 vem antes de qualquer leitura, e é por isso que só a
porta 3010 é exposta, e não a máquina: o servidor tem Portainer em 9443, Watchtower em
8080 e um Postgres de teste em 55432, todos em localhost, e nenhum deles entra no
Funnel.

A barra por tentativa de senha conta por conta e por endereço de origem. O endereço
chega em `x-forwarded-for`, escrito pela Vercel, e o proxy do site repassa. Dentro da
fábrica esse cabeçalho só é lido quando a requisição já passou pelo token, então não é
forjável por qualquer um.

Os segredos dos modelos continuam onde já estão, no `.env` do servidor, e não sobem
para a Vercel. O projeto da Vercel guarda duas variáveis, e nenhuma delas dá acesso a
DeepSeek, Gemini ou Linear. Isso é melhor do que o desenho anterior, que levava as
cinco chaves para lá.

Os limites compartilhados e o que acontece em cada um:

- Banda do Funnel, com teto não configurável e não publicado pela Tailscale. Ao bater,
  o download fica lento e pode estourar o tempo da função. Medir no primeiro download
  real de um mestre, e anotar o número.
- Duração de função na Vercel, 300 segundos por invocação no Hobby, que é o teto de
  projeto novo. Nenhuma rota chega perto, porque o trabalho pesado ficou no servidor;
  só o download de um mestre grande por uma ponte lenta chegaria.
- Disco do servidor, compartilhado com todo o resto de `/opt/emvidros`. Um pedido
  guarda três mestres mais prévias. A regra de retenção continua em aberto, e agora ela
  aperta mais devagar do que apertaria em 1 GB de Blob.
- Backup: o `data/` do em-marketing entra no restic que já cobre `/opt/emvidros` e vai
  para o SFTP em `192.168.14.23`. Não há nada a fazer, além de conferir que entrou.

## 9. Critérios de aceite

- `AC-1`: `bun run verificar` passa na fábrica, sem rede e sem segredo, e o build do
  site passa o portão dele.
- `AC-2`: uma imagem da fábrica com suíte vermelha não é publicada, e um push que
  quebre o site não é promovido na Vercel.
- `AC-3`: `curl` no endereço público sem o token do site leva 401, e a resposta não
  diferencia rota que existe de rota que não existe.
- `AC-4`: entrar com senha certa funciona, com senha errada não, e a quinta tentativa
  seguida é barrada.
- `AC-5`: nenhuma rota de `/api` que toque fluxo responde 200 sem cookie de sessão,
  mesmo com o token do site correto.
- `AC-6`: um pedido em perfil `ensaio` vai do tema ao download pelo navegador, sem
  ninguém tocar no servidor.
- `AC-7`: uma decisão de rodada anterior é recusada, e o duplo toque grava uma decisão
  só.
- `AC-8`: uma conta `solicitante` não vê o botão de aprovar arte, e o `POST` da decisão
  feito na mão por essa conta é recusado pela fábrica.
- `AC-9`: o SHA-256 do mestre baixado pelo navegador é igual ao do mestre aprovado.
- `AC-10`: derrubar o container no meio da geração das três artes e subir de novo
  termina o pedido sem gerar de novo o que já foi publicado.
- `AC-11`: com a fábrica parada, o site carrega e mostra a mensagem de servidor fora do
  ar, e não uma tela de erro do Next.
- `AC-12`: `grep -ri telegram src/ site/ scripts/` não acha nada.
- `AC-13`: o Ricardo abre o link no celular dele, entra, pede, ajusta, aprova e baixa,
  sem ajuda. É a prova da fase.

## 10. Como cada coisa é provada

`INV-1` e `INV-11` são gate estático em `scripts/verificar/fronteira.ts`, que hoje já
proíbe `bun:sqlite` fora de `db.ts`. Ele ganha dois padrões: importar banco dentro de
`site/`, e ler variável de chave de modelo dentro de `site/`. Prova contra sabotagem,
como já se faz: plantar a violação e ver o arnês ficar vermelho.

`INV-2` é a suíte de fronteira tentando `UPDATE` nas três tabelas e esperando o erro do
banco. `INV-3`, `INV-4` e `AC-10` são os predicados 1 e 2, que já existem e continuam
valendo palavra por palavra, incluindo a morte do processo por SIGKILL.

`INV-5`, `AC-3` e `AC-5` são a suíte nova de fronteira HTTP: cada rota batida sem
token, com token e sem cookie, com cookie de papel errado, e com os dois certos.

`INV-6`, `INV-7`, `AC-4` e `AC-8` são a suíte de sessão, contra a fábrica direto, sem
passar pelo site.

`INV-8` e `AC-7` são o predicado 2, sem mudança.

`INV-9` e `AC-9` são o predicado 3 adaptado: a mesma entrega duas vezes produz um
download só, e o SHA do ida e volta bate.

`INV-10` é um teste do site que busca a string `ts.net` no HTML e no JavaScript
gerados pelo build, e falha se achar.

`AC-6` é a suíte `ponta-a-ponta` reescrita para dirigir o loop por HTTP com sessão, no
lugar dos updates sintéticos do Telegram. Ela não some, muda de canal.

`AC-11` é um teste do site com a `FABRICA_URL` apontando para uma porta morta.

`AC-1`, `AC-2` e `AC-12` são o CI. `AC-13` é o Ricardo, e não tem substituto
automático.

## 11. Riscos

- **O site na Vercel não compra disponibilidade.** Com o dado no servidor, qualquer
  queda do servidor, da internet da empresa ou do Funnel derruba o produto, agora com um
  salto a mais para falhar. Mitigação: nenhuma dentro deste desenho. É a consequência
  aceita da decisão, e o remédio, se doer, é levar o dado junto.
- **O repasse do cookie é a parte frágil.** Errar `baseURL`, `trustedOrigins` ou um
  cabeçalho no proxy dá sintoma confuso, do tipo que funciona no Chrome do desktop e
  falha no Safari do iPhone. Mitigação: `AC-4` e `AC-5` rodam contra a fábrica, e o
  `AC-13` é feito no aparelho do Ricardo, não num emulador.
- **Banda e latência do Funnel são desconhecidas para nós.** A Tailscale diz que há
  limite e não diz qual. Mitigação: medir no primeiro mestre real e anotar em
  `STATE.md`; se não servir, a saída é URL assinada direta.
- **Dois pipelines, dois jeitos de estar velho.** Mitigação: o número de contrato em
  `/api/saude` e a regra de ordem da seção 6.
- **O Hobby da Vercel é para uso não comercial**, e o em-marketing é ferramenta de
  trabalho da EM Vidros. Mitigação nenhuma do meu lado. É decisão do Henrique, tomada
  com o fato na mesa, e o REP Campo já está na mesma situação desde 02/09.
- **O Funnel depende de configuração no console do Tailscale**, que não sai daqui: o
  atributo `funnel` na política do tailnet e os certificados HTTPS do tailnet, hoje
  desligados, porque `CertDomains` está nulo. Mitigação: é o primeiro passo da
  implementação, e falha nele aparece antes de qualquer código.

## 12. Perguntas em aberto

- Endereço do site: `em-marketing.vercel.app` ou um subdomínio apontado pelo DNS da
  Wix. Não bloqueia. O padrão é começar no `vercel.app`, como o REP Campo, e trocar
  depois; a troca mexe em `BETTER_AUTH_URL` e em `trustedOrigins`, não em código.
- Retenção de artefatos. Não bloqueia escrever código. Com o disco do servidor no lugar
  do Blob, deixou de ser urgente, mas continua sem regra.
- Substituto do Ricardo como aprovador. O PRD promete desde agosto e o código nunca
  teve. Não bloqueia.
- Se a Tailscale aceita Funnel neste tailnet sem plano pago e sem atrito, e qual a
  latência real dele até a Vercel. Não bloqueia escrever código, bloqueia o `AC-13`.

## 13. Fora deste desenho

Blog, que é a Fase 4. Publicação e agendamento automáticos no Instagram. Calendário.
Aviso externo por WhatsApp ou e-mail quando algo espera decisão, que o Henrique já
deixou fora da Fase 3 em 16/09. Cadastro livre, convite por link e recuperação de
senha. Custo por tarefa no inspetor. Delegação de aprovador. Trocar o SQLite por
Postgres. Migrar qualquer dado, porque não existe dado.
