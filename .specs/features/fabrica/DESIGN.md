# Design da Fase 3 (fábrica visível)

Spec: `docs/prd-agencia-multiagente.md` §1.2, §1.4, US-10, §4.11, §4.13 e §5.1 "Fábrica
visível". Referência visual: `docs/referencia-fabrica.png`. Escrito em 15/09/2026,
antes de qualquer código. Nada daqui está implementado.

## O que muda para quem usa

Hoje o único jeito de saber em que ponto está um pedido é o Telegram do Ricardo ou o
banco. Ao fim da fase, o Henrique abre o site da fábrica no MacBook e vê cada pedido
como uma linha de blocos num canvas, um bloco por etapa. O bloco que está trabalhando
se destaca, mostra o agente e a tentativa, e o que acontece chega em até 2 segundos.
Clicar num bloco abre a entrada, a saída e as prévias daquela etapa.

O Ricardo continua pedindo, aprovando e baixando pelo Telegram. O site não muda nada
no fluxo dele. Se ele entrar na rede Tailscale, vê a mesma fábrica pelo celular.

## Onde roda: no servidor, não na Vercel

Dá para deixar o site rodando no servidor e abrir quando quiser, e é o que eu faria.
O estado inteiro mora no SQLite do plano de controle, dentro deste servidor. Um front
na Vercel precisaria de uma API de leitura exposta na internet, com autenticação,
CORS e o fluxo de eventos atravessando a rede pública. Seria também um segundo
caminho de deploy, fora do padrão ghcr e Watchtower da casa. Tudo isso para mostrar
dado que já está a um `127.0.0.1` de distância.

O acesso é pela Tailscale, que em 15/09/2026 já está ativa no servidor
(`emvidros-srv.tail585ce3.ts.net`, 100.79.186.27) e no MacBook do Henrique.

```
MacBook (tailnet)
   |  https://emvidros-srv.tail585ce3.ts.net
   v
tailscale serve  (certificado emitido pela Tailscale)
   |
   v
127.0.0.1:3011  listener de leitura do plano de controle
```

O comando fica assim, e só roda na implementação:

```
sudo tailscale serve --bg http://127.0.0.1:3011
```

Antes dele, alguém com acesso ao painel da Tailscale liga os certificados HTTPS da
tailnet. Em 15/09/2026 o `tailscale status --json` do servidor mostra
`CertDomains: null`, e sem isso o `serve` não emite certificado. O `serve` atende
dentro do próprio `tailscaled` e não abre socket na 443 do host, então não disputa
porta com o Caddy. O passo 5 confirma isso na prática.

Sem Tailscale no aparelho, o túnel SSH é o mesmo site em `localhost` de verdade:
`ssh -L 3011:127.0.0.1:3011 emvidros` e depois `http://localhost:3011`.

Descartei o subdomínio público. Ele passaria pelo Caddy compartilhado, que termina o
HTTPS de seis sites de produção, e exigiria login no site. A Tailscale entrega a
restrição de rede sem código nosso.

A restrição é só de rede. Qualquer aparelho da tailnet e qualquer túnel SSH veem
todos os pedidos. Para um site que só lê, basta. Se um dia vierem ações, o cabeçalho
`Tailscale-User-Login` só vale quando a requisição passou pelo `serve`, porque pelo
túnel SSH qualquer um escreve esse cabeçalho. Ação nenhuma pode confiar nele sem
resolver isso antes.

## Processo, porta e banco

O site não é um serviço novo. O PRD §4.1 diz que só o plano de controle abre o
SQLite, então a leitura fica dentro do mesmo processo Bun que já roda os workers.

- O `src/server.ts` sobe um segundo listener Elysia na porta `PORT_FABRICA` (padrão
  3001), só com rotas `GET` e os arquivos estáticos do site.
- O compose publica essa porta em `127.0.0.1:3011` do host. Dentro do container o
  listener escuta em todas as interfaces, como o do webhook. A porta 3010 continua só
  com o webhook.
- O vhost público `mkt.emvidros.com.br` aponta para a 3010 e nunca vê o site. Quem
  garante isso é a porta separada, não uma regra no Caddy.
- Banco não muda. Continua o SQLite do plano de controle em `data/`, e o site não
  ganha banco próprio. O Postgres central (`emvidros-postgres`) só entraria se
  aparecesse um segundo escritor, e o desenho proíbe isso. Se perder o histórico de
  um dia passar a importar, a conversa é migrar para `db_em_marketing` no Postgres
  central, que tem PITR.

Mudar `Dockerfile` e `compose.yml` passa pelo Henrique. A implementação deixa o
trecho pronto e não edita esses arquivos.

## Formato do dado

A tela inteira é uma função de quatro tabelas que já existem, `workflow_runs`,
`tasks`, `events` e `artifact_versions`. Nenhuma coluna nova.

```ts
type EtapaId = string & { readonly __marca: "etapa" };

interface Etapa {
  id: EtapaId;
  titulo: string;            // "Direção criativa"
  papel: Papel | "ricardo";  // quem trabalha nela
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
  | "aguardando_ricardo"
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
  ultimoSeq: number;
}
```

A tabela etapa por estado do Instagram, derivada de `TAREFA_DO_ESTADO` e
`PAPEL_DA_TAREFA`:

| Etapa | Papel | Estados |
|---|---|---|
| Pedido | ricardo | `requested` |
| Direção criativa | diretor_criativo | `brief_confirmed` |
| Protótipos | designer | `directions_ready`, `prototypes_generating` |
| Controle visual | diretor_de_arte | `prototype_qa` |
| Revisão do Ricardo | ricardo | `awaiting_prototype_review` |
| Pacote | designer | `package_finalizing` |
| Controle do pacote | diretor_de_arte | `package_qa` |
| Revisão do pacote | ricardo | `awaiting_package_review` |
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
para Protótipos. `awaiting_package_review → adjustment_requested → package_finalizing`
sai como retorno de Revisão do pacote para Pacote. Essas são as linhas tracejadas de
reparo da referência.

O bloco em `revisao_manual` é o que a tarefa em `tasks.estado = 'revisao_manual'`
vira. É o caso em que alguém precisa olhar, e por isso não se confunde com `falhou`.

`vistaDoFluxo` é função pura no plano de controle. O site não recalcula regra
nenhuma. Ele desenha o que recebe.

## API de leitura

Todas `GET`, no listener de `PORT_FABRICA`.

```
/api/fluxos                                  pedidos, os ativos primeiro
/api/fluxos/:id                              VistaFluxo
/api/fluxos/:id/etapas/:etapa                tentativas, entrada, saída e versões de artefato da etapa
/api/artefatos/:versaoId/previa              bytes de uma versão com papel = 'preview'
/api/fluxos/:id/eventos                      SSE
```

A rota de prévia recusa qualquer papel que não seja `preview`. O protótipo é gravado
com `papel: "master"` (`src/workers/designer.ts`), e servir "o protótipo" seria servir
o mestre. A regra de URL opaca que expira do PRD §4.11 vale para o download do
mestre, que não passa por este site.

O SSE consulta `events` por `seq > cursor` a cada 500 ms. A cada lote, manda os
eventos novos e a `VistaFluxo` inteira de novo. Com dez blocos o payload é pequeno, e
o cliente não precisa de um redutor que duplique a máquina de estados. Na reconexão,
o navegador manda `Last-Event-ID` com o último `seq`.

Os workers rodam no mesmo processo, então dava para avisar o SSE direto na escrita do
evento. Fico com a consulta por `seq`, que continua certa se um papel virar processo
separado, como o PRD §4.2 prevê.

O Telegram ID aparece em dois formatos no banco. Um é coluna (`chat_id`,
`solicitante_id`, `reviewer_id`). O outro vai dentro de `events.ator`, como
`telegram:<id>` (`src/controle/aprovacoes.ts`, `src/controle/api.ts`). Toda resposta
passa por um filtro que tira as colunas e troca o `ator` por `ricardo` ou
`solicitante`. A prova do passo 3 procura os IDs do pedido em todo byte devolvido.

## Tela

Três regiões, tiradas da referência e com menos coisa.

- **Topo.** Tema do pedido, estado, rodada, tempo ativo e o seletor de pedido.
- **Canvas.** Os blocos em linha, arestas de avanço e de retorno, controles de zoom
  e o botão "Seguir etapa".
- **Inspetor.** Painel à direita, aberto quando há `etapa` na URL, com as abas
  Detalhes, Saída e Atividade.
- **Faixa inferior recolhível.** Atividade do pedido e as prévias geradas.

Fica de fora da referência: pausar e cancelar, menu de aprovações, sandboxes e
arrastar blocos para reorganizar. O layout é calculado, e salvar posição manual seria
estado sem dono.

O estado da tela que vale compartilhar mora na URL, via nuqs:
`?fluxo=<id>&etapa=<id>&aba=detalhes|saida|atividade`. A posição da câmera não entra.

## Sensação nativa

A skill `apple-design` vale na implementação inteira. O que ela decide aqui:

- **Pan pelo evento de rolagem.** Dois dedos no trackpad movem o canvas e pinça faz
  zoom (`panOnScroll` e `zoomOnPinch` no React Flow). O `wheel` do macOS já chega com
  a inércia do sistema, então a desaceleração é a nativa, não uma imitação.
- **Câmera que segue e para de seguir.** Quando a etapa em andamento muda, a câmera
  anda até ela com mola `bounce: 0, duration: 0.4`. Se a pessoa arrastou o canvas, a
  câmera para de seguir até ela tocar em "Seguir etapa".
- **Resposta no toque.** Bloco pressionado escala para 0,97 no `pointerdown`.
- **Mola interrompível.** Inspetor e faixa inferior abrem com mola `bounce: 0`. Sem
  `@keyframes` em nada que a pessoa toca.
- **Bloco trabalhando.** Barra indeterminada fina na base do bloco e borda em teal
  `#2C7A75`. Nada pisca.
- **Mudança de estado.** O selo do bloco troca com `layout` do Motion, sem salto.
- **Movimento reduzido.** Com `prefers-reduced-motion`, tudo vira troca de opacidade
  e a câmera pula direto.

## Stack

Versões conferidas em 15/09/2026.

| Peça | Versão | Nota |
|---|---|---|
| Bun | 1.4.1 | Pedida pelo Henrique. A 1.4.2 já saiu. O servidor tem 1.4.0 e o `Dockerfile` usa `oven/bun:1.3-slim` |
| Vite+ (`vite-plus`, CLI `vp`) | 0.3.2, beta | MIT, da VoidZero. Usa Bun como gerenciador de pacotes. Rodar o `vp` com Bun como runtime não está confirmado, porque ele gerencia o próprio Node |
| React | 19 | Exigido por Motion, nuqs, Unlumen UI e beautiful.ui |
| Tailwind CSS | 4.3.3 | Pelo plugin `@tailwindcss/vite`. O Vite+ não traz Tailwind |
| Motion | 13.3.0 | `import { motion } from "motion/react"` |
| nuqs | 2.10.1 | `nuqs/adapters/react`, sem React Router |
| @xyflow/react | 12.11.6 | MIT. A marca "React Flow" no canto só sai com assinatura Pro. Num site interno, fica |
| Unlumen UI | registry shadcn | Componentes com Tailwind e Motion. Licença própria: o gratuito pode uso comercial, redistribuir é proibido. Sete dos 235 itens dependem de `next` e ficam de fora |
| beautiful.ui | registry shadcn | 27 componentes para interface de agente, entre eles flowchart e approval card. MIT segundo o site. Exige Tailwind v4, e o `foundation.css` importa um `shadow-plugin` que não declara |

O `vp` precisa de Node, e a imagem de produção só tem Bun. O `Dockerfile` ganha um
estágio só para o site, com o Node que o `vp` pedir, que roda `vp build` e gera
`web/dist`. A imagem final copia `web/dist` desse estágio e o Elysia serve os
arquivos. O container em produção não roda Node nem Vite.

O site mora em `web/`, dentro deste repositório. Ele importa os tipos de
`src/modelos/tipos.ts` direto, então `VistaFluxo` tem uma definição só.

## Ordem de implementação

Cada passo termina numa prova e só então o próximo começa. A prova da fase inteira é
a do PRD §5.1 "Fábrica visível". As daqui são as dos passos.

1. **Bun 1.4.1 na imagem.** Prova: `bun run verificar` verde em 1.4.1 dentro da
   imagem, não só no shell. É o passo de maior risco, porque `bun:sqlite`, `sharp` e o
   teste de SIGKILL mudam de runtime junto.
2. **Protótipo do canvas.** Dez blocos falsos em React Flow contra os mesmos dez no
   flowchart do beautiful.ui, os dois com Vite+ e Tailwind. Prova: o escolhido e o
   motivo escritos neste arquivo, depois de testar no trackpad do MacBook e num
   celular. O protótipo é estrutura temporária e sai da árvore no passo 4.
3. **Vista no plano de controle.** Tabela etapa por estado, `vistaDoFluxo`, rotas
   `GET` e SSE no listener de `PORT_FABRICA`. Prova: suíte nova no `bun run
   verificar` roda um pedido `ensaio` de formato único e um de `both`, e confere a
   vista em cada transição. A mesma suíte procura os Telegram IDs do pedido nas
   respostas e confere que `POST` em qualquer rota não muda o banco. A mensagem de
   `src/workers/executores.ts` que diz que o blog chega na Fase 3 passa a dizer Fase 4.
4. **Site.** `web/` com canvas, inspetor, atividade e nuqs. Prova: um pedido `ensaio`
   aparece andando e cada mudança chega ao bloco em até 2 segundos. Um link com etapa
   aberta, colado em outra aba, mostra a mesma tela.
5. **Acesso.** Trecho do `Dockerfile` e do compose entregue ao Henrique, certificados
   HTTPS ligados na tailnet e o `tailscale serve`. Prova: o site abre no MacBook pela
   tailnet, o Caddy continua servindo a 443 dos outros sites, e `curl` por
   `mkt.emvidros.com.br` e pelo IP público não chega ao site.

## Decisões abertas

- Se o Ricardo entra na tailnet para ver a fábrica pelo celular.
- Se o site ganha ações (cancelar, aprovar, pedir) depois desta fase. Se ganhar, a
  identidade vem do `Tailscale-User-Login`, com o furo do túnel SSH resolvido, e a
  aprovação continua presa a quem o PRD §2.1 autoriza.

## Fora da Fase 3

Qualquer escrita pelo site. Pedido pelo site. Endereço público. Custo por tarefa no
inspetor, que espera o orçamento do PRD §4.12. Layout salvo por arraste.
