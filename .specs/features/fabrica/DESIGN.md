# Design da Fase 3 (fábrica no site)

Spec: `docs/prd-agencia-multiagente.md` US-1 a US-11, §4.7, §4.11, §4.13 e §5.1
"Fábrica no site". Referência visual: `docs/referencia-fabrica.png`. Reescrito em
16/09/2026, quando o site deixou de ser vista de leitura e passou a substituir o
Telegram. Nada daqui está implementado.

## O que muda para quem usa

Hoje o Ricardo só existiria para o produto dentro de um bot do Telegram que nunca
chegou a entrar no ar. Ao fim da fase, ele abre um endereço no navegador do celular,
entra com e-mail e senha, escreve o tema, vê o pedido andar pelas etapas num canvas,
compara as três direções, pede ajuste em texto livre, aprova e baixa o PNG mestre.
O time de marketing entra com conta própria e faz o mesmo, menos aprovar arte, e
pode cancelar o pedido que abriu. O Henrique
cadastra as contas e vê onde cada pedido parou.

Ninguém precisa estar numa rede específica. Basta o link e a conta.

## Endereço público

O site é tela e API no mesmo endereço, servidos pelo mesmo processo Bun. Isso não é
detalhe de implementação, é o que mantém o cookie de sessão sendo cookie de primeira
parte. Separar tela e API em domínios diferentes faria o Safari do iPhone tratar o
cookie do better-auth como cookie de terceiro e bloquear, e o Ricardo não conseguiria
nem entrar.

Por isso descartei hospedar a tela na Vercel. Ela resolveria o endereço da tela e
deixaria o problema inteiro na API, que continua no servidor com o SQLite, os
workers e os arquivos. Seriam dois deploys, um domínio a mais e o login quebrado no
aparelho de quem mais usa.

No primeiro momento o endereço público sai pelo Tailscale Funnel, que publica o
`127.0.0.1` do servidor num endereço `ts.net` com certificado da Tailscale, aberto
para qualquer pessoa com o link, sem exigir Tailscale de quem acessa e sem tocar no
Caddy compartilhado. Ligar o Funnel é uma mudança na política da tailnet, feita pelo
Henrique.

O destino é `mkt.emvidros.com.br`, que já tem vhost em `/etc/caddy/sites/` e já está
em `/etc/caddy/allowed-hosts`, apontando para a porta 3010. Ele está travado por um
problema que não é deste projeto: em 16/09/2026 o ACME falha nos dois desafios para
todo o wildcard `*.emvidros.com.br`, e o Caddyfile registra que as portas 80 e 443
chegam por um proxy acima. Enquanto isso não for resolvido, nenhum site da empresa
tira certificado novo. Trocar o Funnel pelo domínio depois é mudar para onde o
`reverse_proxy` aponta, sem mexer no app.

## Login

`better-auth` é o padrão da casa para app em Bun, e o template de projeto novo já
manda usar. O em-hub e o portal de aprovação rodam com ele.

- E-mail e senha, sem cadastro aberto. O Henrique cria a conta e escolhe o papel.
- Sessão em cookie `HttpOnly`, `Secure` e `SameSite=Lax`.
- As tabelas de conta e sessão ficam no mesmo SQLite do plano de controle, porque
  quem valida a sessão é o mesmo processo que já é dono do estado.
- Quem abre o banco continua sendo só `src/controle/db.ts`. O better-auth recebe a
  conexão que já existe, e o schema dele entra como migração nossa, gerada uma vez
  pela CLI dele e colada em `migracoes.ts`. Sem isso o gate de fronteira do
  `bun run verificar`, que proíbe `bun:sqlite` fora de `db.ts`, reprova com razão.
- O endereço público entra em `baseURL` e `trustedOrigins` do better-auth, e o
  cookie sai `Secure` porque o Funnel termina o TLS. Trocar o Funnel pelo domínio é
  trocar essas duas variáveis e para onde o proxy aponta, nada no código.
- A barra por tentativa conta por conta e por IP, e o IP vem do `X-Forwarded-For` que
  o Funnel escreve. Confiar nesse cabeçalho só vale porque nada além do proxy alcança
  a porta.
- Papéis: `solicitante` pede e acompanha, `aprovador` também decide, `admin` também
  cadastra. O papel é coluna da conta, e a autorização mora no plano de controle, não
  na tela.
- Toda decisão grava a conta que decidiu. `approvals.reviewer_id` deixa de ser
  Telegram ID e passa a apontar para a conta.

## O que sai junto com o Telegram

Regra de migrar e apagar: o canal antigo não fica de reserva. Sai na mesma leva em
que o site passa a fazer o trabalho dele. Isso é possível sem susto porque o bot
nunca entrou no ar: o webhook nunca foi registrado e a allowlist de chats está vazia
desde sempre.

`grep -rli telegram src/ scripts/` acha 23 arquivos hoje. Somem inteiros:

- `src/telegram/conversa.ts`, 565 linhas de máquina de conversa por chat. A etapa de
  conversa vira estado de tela mais o estado do fluxo, que já existe.
- `src/adaptadores/telegram.ts`, 197 linhas.
- `src/workers/apresentador.ts`, 223 linhas, que empacotava revisão em álbum e
  botões. O site lê a revisão aberta direto do plano de controle.
- `src/controle/conversas.ts`, a tabela de conversa por chat.

Perdem a parte de Telegram: `src/adaptadores/fake.ts`, `tipos.ts` e `index.ts` (a
porta `PortaTelegram`), `src/controle/entregas.ts` (a entrega por `sendDocument`
vira download), `src/controle/api.ts` (`EntradaTelegram`), `src/controle/fluxos.ts`
(`fluxoAtivoDoChat`), `src/workers/executores.ts`, `src/server.ts` (webhook, segredo
e allowlist) e nove arquivos de `scripts/verificar/`. A suíte `ponta-a-ponta`, que
hoje dirige o loop com updates sintéticos do Telegram, é reescrita para dirigir o
mesmo loop por HTTP com sessão. Ela não some: é a prova do passo 3.

Migração 004, na mesma leva:

- `workflow_runs.chat_id` e `workflow_runs.solicitante_id` são `INTEGER NOT NULL`
  hoje. Viram uma coluna só, `conta_id TEXT`, apontando para a conta que pediu.
- `approvals.reviewer_id` é `INTEGER` e vira `TEXT` com o mesmo destino.
- `events.ator` grava `telegram:<id>`; os registros antigos ficam como estão, porque
  a tabela é append-only, e os novos gravam `conta:<id>`.
- `deliveries` perde o que descreve canal e `file_id` do Telegram.
- A tabela `conversas` cai, como a migração 003 fez com as cinco tabelas do bot v1.
- As variáveis `TELEGRAM_*` e `APROVADOR_TELEGRAM_ID` saem do `.env.example` e do env
  de produção.

O banco de produção hoje não tem fluxo nenhum de valor, então a migração converte o
que houver e não precisa de ponte para os dois formatos.

O que não muda é o miolo: máquinas de estado, plano de controle como escritor único,
fila com lease, artefatos imutáveis e aprovação versionada continuam iguais. O canal
sempre foi periferia, e é isso que faz esta troca caber numa fase.

## Processo, porta e banco

O site não é serviço novo. O PRD §4.1 diz que só o plano de controle abre o SQLite,
então tela, API e sessão ficam no mesmo processo Bun que já roda os workers.

Com o Telegram fora, sobra uma superfície HTTP só. O listener continua sendo o de
hoje, publicado em `127.0.0.1:3010`, e o Funnel aponta para ele. Some o webhook, some
o segredo e some a allowlist de chat. A rota `/health` fica pública, o que é o que
ela já era pelo vhost, e não devolve nada além de `ok` e o instante.

Banco não muda de lugar. Continua o SQLite do plano de controle em `data/`, agora com
as tabelas de conta e sessão junto. O Postgres central só entraria se aparecesse um
segundo escritor, e o desenho proíbe isso.

Mexer em `Dockerfile` e `compose.yml` passa pelo Henrique, e o classificador barra a
edição. A implementação deixa o trecho pronto e diz onde está.

## Formato do dado

A tela inteira é função de quatro tabelas que já existem, `workflow_runs`, `tasks`,
`events` e `artifact_versions`, mais as duas do login.

```ts
type EtapaId = string & { readonly __marca: "etapa" };
type ContaId = Id<"conta">;

interface Etapa {
  id: EtapaId;
  titulo: string;            // "Direção criativa"
  papel: Papel | "humano";   // quem trabalha nela
}

/**
 * Ao lado de TRANSICOES_INSTAGRAM. Mapped type: esquecer um estado não compila.
 * "transitorio" é estado que o fluxo atravessa na mesma transação e nunca fica parado.
 */
type EtapaDoEstado<E extends string> = { readonly [S in E]: EtapaId | "transitorio" | "terminal" };

type EstadoBloco =
  | "pendente"
  | "trabalhando"
  | "concluida"
  | "aguardando_decisao"
  | "revisao_manual"
  | "falhou";

interface Bloco {
  etapa: Etapa;
  estado: EstadoBloco;
  tentativa: number;
  desde: string | null;       // criado_em do evento que entrou na etapa
  tarefaId: TarefaId | null;
}

interface Aresta {
  de: EtapaId;
  para: EtapaId;
  tipo: "avanco" | "retorno";
}

interface VistaFluxo {
  fluxoId: FluxoId;
  tipo: TipoFluxo;
  tema: string;
  estado: EstadoQualquer;
  rodada: number;
  blocos: Bloco[];
  arestas: Aresta[];
  /** O que a sessão atual pode fazer agora. A tela não decide isso sozinha. */
  acoes: Acao[];
  ultimoSeq: number;
}

type Acao =
  | { tipo: "confirmar_brief" }
  | { tipo: "aceitar"; opcoes: VersaoId[] }
  | { tipo: "ajustar" }
  | { tipo: "recusar_todas" }
  | { tipo: "cancelar" }
  | { tipo: "baixar"; versoes: VersaoId[] }
  /** Só grava data e URL em deliveries. Não é transição de estado. */
  | { tipo: "marcar_publicado" };
```

A lista `acoes` sai do estado do fluxo cruzado com o papel da conta. A tela desenha
botão para o que vier e não inventa nenhum. O plano de controle confere de novo na
hora de executar, porque tela não é lugar de autorização.

A tabela etapa por estado do Instagram, derivada de `TAREFA_DO_ESTADO` e
`PAPEL_DA_TAREFA`:

| Etapa | Papel | Estados |
|---|---|---|
| Pedido | humano | `requested` |
| Direção criativa | diretor_criativo | `brief_confirmed` |
| Protótipos | designer | `directions_ready`, `prototypes_generating` |
| Controle visual | diretor_de_arte | `prototype_qa` |
| Revisão do Ricardo | humano | `awaiting_prototype_review` |
| Pacote | designer | `package_finalizing` |
| Controle do pacote | diretor_de_arte | `package_qa` |
| Revisão do pacote | humano | `awaiting_package_review` |
| Entrega | operacoes | `approved_for_manual_delivery` |
| Linear | operacoes | `delivered` |

`prototype_approved` e `adjustment_requested` são transitórios. O
`src/controle/aprovacoes.ts` faz os dois saltos do aceite e do ajuste na mesma
transação, então nenhum fluxo fica parado neles e nenhum bloco os mostra. Os
terminais (`archived`, `rejected`, `cancelled`, `failed`) viram o estado do pedido,
não um bloco. O blog ganha a tabela dele no mesmo formato.

Pedido de formato único nunca passa pelo pacote, porque o aceite salta de
`prototype_approved` direto para `approved_for_manual_delivery`. A vista desses
pedidos não tem os blocos Pacote, Controle do pacote e Revisão do pacote.

As arestas não são escritas à mão. A vista percorre `TRANSICOES_INSTAGRAM`
atravessando os estados transitórios, até chegar num estado parado. Cada caminho de
um estado parado a outro vira uma aresta entre as etapas dos dois. É `retorno`
quando a etapa de destino vem antes da de origem na tabela, e `avanco` no resto.
Assim `prototype_qa → prototypes_generating` sai como retorno de Controle visual
para Protótipos, e `awaiting_package_review → adjustment_requested →
package_finalizing` sai como retorno de Revisão do pacote para Pacote. São as linhas
tracejadas de reparo da referência.

`vistaDoFluxo` é função pura no plano de controle. O site não recalcula regra
nenhuma. Ele desenha o que recebe.

## API

Tudo no mesmo endereço, atrás de sessão. Sem sessão, qualquer rota devolve 401, e a
raiz devolve a tela de entrada.

```
POST /api/entrar                       e-mail e senha, better-auth
POST /api/sair
GET  /api/eu                           conta e papel da sessão

GET  /api/fluxos                       pedidos que a conta pode ver, pendências primeiro
POST /api/fluxos                       abre um pedido (tema, formato, objetivo)
GET  /api/fluxos/:id                   VistaFluxo, com as ações permitidas
GET  /api/fluxos/:id/etapas/:etapa     tentativas, entrada, saída e versões da etapa
GET  /api/fluxos/:id/eventos           SSE
POST /api/fluxos/:id/decisao           confirmar brief, aceitar, ajustar, recusar, cancelar
GET  /api/artefatos/:versaoId/previa   bytes de uma versão com papel 'preview'
GET  /api/artefatos/:versaoId/mestre   download do mestre, com nome de arquivo

POST /api/contas                       admin cria conta e papel
```

`POST /api/fluxos/:id/decisao` é a única porta de decisão sobre conteúdo e recebe
fluxo, etapa, rodada e versões, os mesmos campos que o callback do Telegram
carregava. Cancelar continua sendo caminho próprio (`cancelar` em
`src/controle/api.ts`), porque quem abriu o pedido pode encerrar o próprio pedido sem
ser aprovador.

As regras de `src/controle/aprovacoes.ts` continuam valendo inteiras, da recusa de
rodada vencida ao destino de cada ação. Dois trechos são reescritos, e vale saber
qual: `checar()` compara o autor com um `APROVADOR_TELEGRAM_ID` numérico do ambiente,
e passa a resolver o papel da conta da sessão; e o `data` de 64 bytes do callback do
Telegram deixa de ser decodificado, porque os mesmos campos chegam no corpo do POST.

A chave de idempotência do corpo reusa `executarUmaVez` de
`src/controle/idempotencia.ts`. Hoje o segundo toque cai em `aprovacao_vencida`,
porque a revisão pendente já zerou, e a tela mostraria erro onde não houve erro.

O SSE consulta `events` por `seq > cursor` a cada 500 ms, manda os eventos novos e a
`VistaFluxo` inteira de novo. Com dez blocos o payload é pequeno, e o cliente não
precisa de um redutor que duplique a máquina de estados. Na reconexão, o navegador
manda `Last-Event-ID` com o último `seq`.

A rota de prévia recusa qualquer papel que não seja `preview`. O protótipo é gravado
com `papel: "master"` (`src/workers/designer.ts`), então servir "o protótipo" seria
servir o mestre sem querer. O mestre tem rota própria, que exige sessão e registra o
download como entrega.

## Telas

- **Entrar.** E-mail, senha e nada mais.
- **Pedidos.** Lista com o que espera decisão em cima, e o botão de pedir.
- **Pedido.** Canvas com os blocos, inspetor de etapa à direita e atividade embaixo.
- **Revisão.** As três prévias lado a lado, justificativa de cada direção, e os
  botões de aceitar, ajustar, recusar todas e cancelar.
- **Entrega.** Prévia aprovada, download do mestre, legenda com botão de copiar e o
  link do Linear.
- **Contas.** Só para `admin`, com e-mail, papel e criação.

Fica de fora da referência: pausar a execução, sandboxes e arrastar blocos para
reorganizar. O layout é calculado, e salvar posição manual seria estado sem dono.

O estado de tela que vale compartilhar mora na URL, via nuqs:
`?fluxo=<id>&etapa=<id>&aba=detalhes|saida|atividade`. A posição da câmera não entra.

## Sensação nativa

A skill `apple-design` vale na implementação inteira. O que ela decide aqui:

- **Pan pelo evento de rolagem.** Dois dedos no trackpad movem o canvas e pinça faz
  zoom (`panOnScroll` e `zoomOnPinch` no React Flow). O `wheel` do macOS já chega com
  a inércia do sistema, então a desaceleração é a nativa, não uma imitação.
- **Câmera que segue e para de seguir.** Quando a etapa em andamento muda, a câmera
  anda até ela com mola `bounce: 0, duration: 0.4`. Se a pessoa arrastou o canvas, a
  câmera para de seguir até ela tocar em "Seguir etapa".
- **Resposta no toque.** Bloco e botão pressionados escalam para 0,97 no
  `pointerdown`, não no clique.
- **Decisão sem espera.** Aceitar, ajustar e recusar marcam o estado na hora e
  confirmam quando a resposta chega. Se o plano de controle recusar, a tela volta e
  diz o motivo.
- **Mola interrompível.** Inspetor, revisão e faixa inferior abrem com mola
  `bounce: 0`. Sem `@keyframes` em nada que a pessoa toca.
- **Bloco trabalhando.** Barra indeterminada fina na base do bloco e borda em teal
  `#2C7A75`. Nada pisca.
- **Movimento reduzido.** Com `prefers-reduced-motion`, tudo vira troca de opacidade
  e a câmera pula direto.

## Stack

Versões conferidas em 16/09/2026.

| Peça | Versão | Nota |
|---|---|---|
| Bun | sempre a última | Regra do Henrique de 16/09/2026. Host já em 1.4.2, e as 13 suítes passam nela. `Dockerfile` e CI seguem `oven/bun:latest` |
| better-auth | padrão da casa | Já roda no em-hub e no portal de aprovação, e o template de projeto novo manda usar |
| Vite+ (`vite-plus`, CLI `vp`) | 0.3.2, beta | MIT, da VoidZero. Usa Bun como gerenciador de pacotes, e gerencia o próprio Node para o build |
| React | 19 | Exigido por Motion, nuqs, Unlumen UI e beautiful.ui |
| Tailwind CSS | 4.3.3 | Pelo plugin `@tailwindcss/vite`. O Vite+ não traz Tailwind |
| Motion | 13.3.0 | `import { motion } from "motion/react"` |
| nuqs | 2.10.1 | `nuqs/adapters/react`, sem React Router |
| @xyflow/react | 12.11.6 | MIT. A marca "React Flow" no canto só sai com assinatura Pro |
| Unlumen UI | registry shadcn | Componentes com Tailwind e Motion. Licença própria: o gratuito pode uso comercial, redistribuir é proibido. Sete dos 235 itens dependem de `next` e ficam de fora |
| beautiful.ui | registry shadcn | 27 componentes para interface de agente, entre eles flowchart e approval card. MIT segundo o site. Exige Tailwind v4, e o `foundation.css` importa um `shadow-plugin` que não declara |

O `vp` precisa de Node, e a imagem de produção só tem Bun. O `Dockerfile` ganha um
estágio só para o site, que roda `vp build` e gera `web/dist`. A imagem final copia
`web/dist` e o Elysia serve os arquivos. O container em produção não roda Node nem
Vite.

O site mora em `web/`, dentro deste repositório, e importa os tipos de
`src/modelos/tipos.ts` direto, então `VistaFluxo` tem uma definição só.

## Ordem de implementação

Cada passo termina numa prova e só então o próximo começa. A prova da fase inteira é
a do PRD §5.1 "Fábrica no site".

1. **Bun na última versão.** `Dockerfile` e CI em `oven/bun:latest`. Prova:
   `bun run verificar` verde dentro da imagem, não só no shell. No host já passou em
   1.4.2, 13 suítes em 54,6 s, em 16/09/2026.
2. **Contas e sessão.** better-auth no plano de controle, tabelas de conta e sessão,
   papel, e o `admin` criando gente. Prova: suíte nova no `bun run verificar` entra
   com senha certa, é barrada com senha errada, é barrada por tentativa repetida, e
   nenhuma rota de dado responde sem cookie.
3. **Decisão pelo site.** `POST /api/fluxos/:id/decisao` sobre as regras que já
   existem em `aprovacoes.ts`, mais a lista `acoes` na vista. Prova: a suíte roda um
   pedido `ensaio` inteiro por HTTP, sem Telegram, incluindo rodada vencida recusada,
   `solicitante` sem poder aprovar e duplo toque virando uma decisão só.
4. **Telegram apagado.** Os cinco arquivos, o webhook, a migração que derruba
   `conversas` e as variáveis de ambiente. Prova: `grep -ri telegram src/ scripts/`
   não acha nada e as suítes continuam verdes.
5. **Site.** `web/` com entrada, lista, canvas, inspetor, revisão e entrega. Prova:
   um pedido `ensaio` vai do tema ao download pelo navegador, com cada mudança
   chegando ao bloco em até 2 segundos.
6. **Endereço público.** Funnel ligado, `Dockerfile` e compose entregues ao Henrique.
   Prova: o Ricardo abre o link no celular dele, entra, pede, ajusta, aprova e baixa.
   É também a prova da fase.

## Decisões abertas

- Endereço definitivo, entre destravar `mkt.emvidros.com.br` e ficar no Funnel.
- Aviso externo quando algo espera decisão. Fora desta fase por escolha do Henrique
  em 16/09/2026. Entra se a lista de pendências não bastar, e o candidato é o
  WhatsApp pela Evolution API, que já roda no servidor.
- Retenção dos artefatos locais, que o PRD §4.11 deixa em aberto desde agosto.

## Fora da Fase 3

Publicação automática. Calendário e agendamento. Blog, que é a Fase 4. Cadastro
livre, convite por link e recuperação de senha. Aviso externo. Custo por tarefa no
inspetor, que espera o orçamento do PRD §4.12. Delegação de aprovador, que o PRD
promete desde agosto e o código nunca teve.

Sessão que expira no meio do SSE fecha a conexão com 401, e a tela leva de volta para
a entrada em vez de ficar parada mostrando estado velho. O `EventSource` manda o
cookie sozinho porque tela e API dividem a origem, que é mais um motivo para elas não
se separarem.
