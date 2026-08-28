# Design da Fase 2 (MVP Instagram)

Spec: `docs/prd-agencia-multiagente.md` §2.2, §2.4 (US-1 a US-6, US-8, US-9), §3, §4.7 e
§5.1 "MVP Instagram". A Fase 1 (`DESIGN.md`) fica como está: tabelas de transição,
`transicionar()` como escritor único, fila com lease e época, artefatos imutáveis,
aprovação presa ao Telegram do Ricardo. Este arquivo diz o que entra em cima disso.

## O que muda para o Ricardo

Hoje o bot no ar é o v1, com cérebro Gemini e banco próprio, e nada do plano de
controle chega ao celular dele. Ao fim da fase, ele manda um tema, escolhe Feed,
Stories ou Ambos, confirma o brief, recebe três prévias num álbum com botões, aceita,
pede ajuste em linguagem natural ou recusa todas, recebe o pacote (Feed, Stories e
legenda), aprova, baixa o PNG mestre como documento e recebe o link do Linear. Sem
chave da DeepSeek e sem billing do Gemini, o mesmo caminho roda com arte falsa
(`ADAPTADORES=ensaio`), o que já deixa ele testar o loop inteiro no celular.

## Módulos

```
src/modelos/tipos.ts            logo_variant na DirecaoVisual (feito); aresta awaiting_prototype_review → brief_confirmed; aviso na RevisaoPendente; EstadoConversa
src/adaptadores/tipos.ts        ajuste na legenda do Redator (feito); Violacao exportado
src/controle/api.ts             PacoteContexto estendido, SaidaTarefa, revisoesAbertas, executarEntregas no ControlePlano, conversa
src/controle/tarefas.ts         chave de tarefa com contador de visitas; concluir roteia por SaidaTarefa
src/controle/revisoes.ts        abrirRevisao sai de aprovacoes.ts para cá, e assim tarefas.ts não cria ciclo de import
src/controle/aprovacoes.ts      validarCallback; aceitar e recusar todas no protótipo decidem o próximo estado
src/controle/idempotencia.ts    executarUmaVez com política repetirSeFalhou, janela e teto
src/controle/conversas.ts       estado da conversa por chat (tabela conversas)
src/controle/migracoes.ts       migração 003: apaga as 5 tabelas do v1, cria conversas
src/controle/entregas.ts        nome do arquivo com tema, formato e versão (US-5)
src/workers/laco.ts             um laço por papel: reivindicar, heartbeat, executar, concluir ou falhar
src/workers/executores.ts       tabela TipoTarefa → executor
src/workers/designer.ts         modoDoDesigner(contexto) e a produção de mestre + preview
src/workers/apresentador.ts     apresenta revisões abertas no Telegram, idempotente por rodada
src/adaptadores/deepseek.ts     DiretorCriativo e Redator reais
src/adaptadores/gemini.ts       Designer (Nano Banana 2) e DiretorDeArte (gemini-3.6-flash) reais
src/adaptadores/telegram.ts     PortaTelegram real
src/adaptadores/linear.ts       PortaLinear real
src/adaptadores/index.ts        perfis fake, ensaio e real
src/telegram/conversa.ts        máquina de estado da conversa e tratamento do update
src/server.ts                   só HTTP: /health e /webhooks/telegram; sobe workers e reconciliador
scripts/verificar/ponta-a-ponta.ts  o loop inteiro com fakes, dirigido por updates sintéticos
```

Sai da árvore no mesmo commit em que o webhook passa a falar com o plano de controle:
`src/brain`, `src/art`, `src/caption`, `src/publish`, `src/db`, `src/instagram`,
`src/scheduler`, `src/linear`, `src/telegram/api.ts`, `scripts/spike-arte.ts`,
`styles/map.json` e a rota `/media/:id`. `brand/calendario.md` fica: é conteúdo de
marca, e o agendamento é v1.1.

## Contexto da tarefa

O worker precisa saber o que já existe no fluxo para decidir o que fazer, e essa
decisão tem que ser função do banco, nunca da memória do processo. Por isso o
`PacoteContexto` passa a carregar os resumos dos artefatos e das decisões. Bytes
continuam saindo por `lerArtefato`.

```ts
export interface ResumoArtefato {
  readonly id: VersaoId;
  readonly papel: NovoArtefato["papel"];
  readonly formato: Formato | null;
  readonly rodada: number;
  readonly linhagemId: string;
  readonly versao: number;
  readonly sha256: string;
  readonly mediaTipo: string;
  readonly derivadaDe: VersaoId | null;
  readonly meta: Record<string, unknown> | null;
}

export interface ResumoDecisao {
  readonly stage: Estagio;
  readonly rodada: number;
  readonly decision: Decisao;
  readonly opcao: VersaoId | null;
  readonly notas: string | null;
}

export interface PacoteContexto {
  readonly fluxoId: FluxoId;
  readonly tipo: TipoFluxo;
  readonly estado: EstadoQualquer;
  readonly rodada: number;
  readonly chatId: number;
  readonly marca: ContextoMarca;
  readonly pedido: Pedido;
  readonly artefatos: readonly ResumoArtefato[];  // do fluxo inteiro, em ordem de criação
  readonly decisoes: readonly ResumoDecisao[];    // em ordem de decisão
}
```

`TarefaAtribuida` ganha `visita: number`, a contagem de tarefas do mesmo tipo e
rodada no fluxo, esta incluída. É o mesmo `n` da chave de tarefa, e é o que limita
o laço de QA.

## Saída tipada e roteamento no concluir

O worker nunca chama `transicionar`. Ele devolve um desfecho tipado e o plano de
controle escolhe a aresta, na mesma transação que fecha a tarefa.

```ts
export type SaidaTarefa =
  | { readonly tipo: "seguir"; readonly versoes: readonly VersaoId[]; readonly resumo?: string }
  | { readonly tipo: "revisar"; readonly stage: Estagio; readonly versoes: readonly VersaoId[]; readonly aviso?: string }
  | { readonly tipo: "voltar"; readonly versoes: readonly VersaoId[]; readonly motivo: string };
```

- `seguir` usa `ESTADO_APOS_CONCLUSAO[tipo]`, como hoje.
- `revisar` chama `abrirRevisao(fluxo, stage, versoes, aviso)` dentro da transação do
  `concluir`. O fluxo chega em `awaiting_*` sem tarefa viva, que é o invariante que
  `reinicio.ts` confere. `aviso` fica em `revisao_pendente` (campo novo, opcional) e
  é o que o apresentador mostra quando uma direção caiu no QA (US-2).
- `voltar` usa a tabela `ESTADO_DE_VOLTA`, indexada pelo estado atual do fluxo:
  `prototype_qa → prototypes_generating`, `package_qa → package_finalizing`,
  `copy_review → draft_generating`. Estado fora da tabela é `ArestaIlegal`.

## Chave de tarefa com contador de visitas

Hoje a chave é `fluxo:estado:rodada`. O laço de QA reprova e volta para
`prototypes_generating` dentro da mesma rodada, e a segunda visita ao mesmo estado
não consegue inserir a tarefa porque a chave já existe, concluída. O fluxo pararia
em silêncio.

A chave passa a ser `fluxo:estado:rodada:n`, onde `n` é a contagem de tarefas do
mesmo tipo e rodada no fluxo. É determinística a partir do banco, então dois
reconciliadores concorrentes calculam a mesma chave e só um insere. A checagem de
"tarefa viva" passa a incluir `revisao_manual`, senão o contador daria volta ao
teto de tentativas.

O teto do laço de QA é do executor, não do reconciliador, e conta visitas, não
pareceres: `visita >= TETO_QA (3)` fecha o laço. Contar pareceres não serve porque
`publicarArtefato` deduplica por conteúdo; um refino que devolve os mesmos bytes
devolve a mesma versão, que já tem parecer, e a contagem nunca andaria. Ao fechar,
a linhagem reprovada sai da revisão e o `aviso` diz qual caiu e por quê.

## Aceite e recusa no protótipo

`prototype_approved` não tem tarefa e não é espera humana. `decidir()` faz dois
saltos no aceite, como já faz no ajuste:

- `format = stories` → `[prototype_approved, approved_for_manual_delivery]`. Não há
  legenda nem segunda peça; a finalização só muda codificação (PRD §4.3).
- `format = feed` ou `both` → `[prototype_approved, package_finalizing]`. A legenda
  é conteúdo visível novo e, no `both`, o Stories também. Os dois passam pela
  revisão de pacote.

`Recusar todas` hoje vai para `directions_ready`, que exige `design_prototipos`, e
o designer da rodada nova não acharia direção nenhuma. O estado que exige
`direcao_criativa` é `brief_confirmed`. Entra a aresta
`awaiting_prototype_review → brief_confirmed`, `recusar_todas` vai para lá com a
rodada incrementada, e a aresta para `directions_ready` sai da lista de
`awaiting_prototype_review`.

## Conjunto do pacote

Aceitar não incrementa a rodada, então em `package_qa` as três linhagens de
protótipo ainda são "da rodada". O pacote nunca é "toda a rodada". É
`conjuntoDoPacote(contexto)`, função pura usada por `finalizar_pacote`, pelo QA no
estágio de pacote e pelo apresentador:

- Feed: a linhagem da `opcao` do último aceite de `stage = prototype`, na versão mais
  nova.
- Stories: a versão mais nova entre os mestres `formato = stories` (só existe uma
  linhagem, derivada do Feed aceito). Só quando `format = both`.
- Legenda: o `copy` mais novo. Só quando o pacote inclui Feed.

## Modos do designer

`modoDoDesigner(contexto)` devolve uma união discriminada. É função pura do
contexto, então repetir a tarefa depois de uma queda converge para o mesmo trabalho
e só produz o que falta.

```ts
type ModoDesigner =
  | { modo: "produzir"; formato: Formato; gerar: readonly DirecaoVisual[]; refinar: readonly Alvo[]; ajustar?: { master: ResumoArtefato; direcao: DirecaoVisual; instrucao: string } }
  | { modo: "nada_a_fazer"; versoes: readonly VersaoId[] };
interface Alvo { master: ResumoArtefato; direcao: DirecaoVisual; violacoes: readonly Violacao[] }
```

Derivação, sempre sobre a rodada atual e sempre idempotente (queda depois de
publicar e antes de concluir não refaz chamada de modelo):

1. `direcaoDaRodada` = último artefato `direcao` com `rodada = atual`.
2. Sem `direcaoDaRodada` é rodada de ajuste. A decisão é a última
   `adjustment_requested` de `stage = prototype` com `rodada = atual - 1`; a
   `opcao` é o mestre base; a direção vem do `direction_id` no `meta` dele. Se já
   existe mestre nesta rodada com `derivadaDe = opcao` (ou descendente), o ajuste
   está feito: esse mestre entra em `refinar` se o último parecer dele reprovou,
   senão é `nada_a_fazer`. Se não existe, `ajustar` com as `notas`.
3. Com `direcaoDaRodada`: para cada direção, o último mestre da rodada com
   `meta.direction_id` igual. Sem mestre, entra em `gerar`. Com mestre cujo último
   parecer reprovou, entra em `refinar`. Nada em nenhum dos dois é `nada_a_fazer`.

Refinar é `designer.editar` com as violações do parecer como instrução, `derivadaDe`
o mestre reprovado, mesmo `refId`.

Cada peça produzida vira dois artefatos: `master` (PNG normalizado por
`normalizarMestre`, `formato`, `meta {direction_id, modelo, refId}`, `derivadaDe`
quando é refino ou ajuste) e `preview` (JPEG de `derivarPreview`, `derivadaDe` o
mestre). O formato é `stories` quando `pedido.format = stories`, senão `feed`.

## Executores

`EXECUTORES: Record<TipoTarefa, Executor>` é exaustivo: tipo novo sem executor não
compila.

```ts
interface Ambiente {
  readonly tarefa: TarefaAtribuida;
  readonly controle: ControlePlano;
  readonly adaptadores: Adaptadores;
  readonly logo: (variante: "cor" | "branco") => Buffer;
  readonly sinal: AbortSignal;   // dispara quando o heartbeat perde a lease
}
type Executor = (a: Ambiente) => Promise<SaidaTarefa | { tipo: "fechada" }>;
```

- `direcao_criativa`: `criativo.direcoes({pedido, marca, rodada, excluir})`, com
  `excluir` = todos os `direction_id` de artefatos `direcao` de rodadas anteriores.
  Publica um artefato `direcao` (JSON das três). `seguir`.
- `design_prototipos`: `modoDoDesigner`, depois `gerar` ou `editar` por alvo.
  `seguir` com os mestres atuais.
- `qa_visual`: `stage` é `prototype` em `prototype_qa` e `package` em `package_qa`.
  Candidatos: no protótipo, o último mestre de cada linhagem da rodada; no pacote,
  os mestres de `conjuntoDoPacote`. Alvo é candidato sem parecer; para cada alvo,
  `arte.revisar` e um artefato `qa` (JSON do veredito, `derivadaDe` o mestre,
  `meta {aprovada, stage, direction_id}`). Depois, olhando o último parecer de cada
  candidato: alguma linhagem reprovada e `visita < TETO_QA` → `voltar`; senão as
  reprovadas caem e as aprovadas seguem. Zero aprovada é `FalhaPermanente`. Caso
  contrário `revisar` com os mestres aprovados (mais o `copy` no pacote) e `aviso`
  nomeando o que caiu e a violação. Zero alvo com tudo aprovado é o caso de
  retentativa depois de queda e segue direto para `revisar`.
- `finalizar_pacote`: produz o que falta em `conjuntoDoPacote`: Stories por
  `designer.editar({base: feed, instrucao: recompor em 9:16 mantendo conceito, cores e
  elemento principal, formato: stories, refId})` quando `format = both`; legenda por
  `redator.legenda` quando o pacote inclui Feed. Com ajuste de pacote (última
  `adjustment_requested` de `stage = package`, `rodada = atual - 1`, e ainda sem
  versão nova do alvo nesta rodada), produz só o alvo da `opcao`: Feed (e rederiva o
  Stories), Stories, ou legenda com `anterior` e `ajuste`. `seguir` com as versões
  do pacote.
- `entrega`: manda a prévia aprovada como foto e a legenda como mensagem copiável
  (as duas idempotentes e repetíveis), chama `controle.executarEntregas` e manda
  "pronto para publicar". `executarEntregas` manda como documento só os mestres; a
  legenda nunca vai como `.txt` no Instagram. Devolve `fechada`, porque
  `executarEntregas` já fecha a tarefa e transiciona. Se o fluxo não chegou em
  `delivered`, falha permanente.
- `arquivar_linear`: issue, anexos e comentário com histórico, cada um sob
  `executarUmaVez` estrito. Mensagem com o link. `seguir`.
- `redacao_angulos`, `redacao_artigo`, `revisao_copy`: falha permanente "Fase 3".

Falha: `FalhaPermanente` e `EfeitoIndeterminado` vão para `revisao_manual`
(repetir um efeito indeterminado só lança de novo); qualquer outro erro é
transitória e respeita `max_tentativas`. O laço avisa o chat do fluxo na primeira
falha e na última, dizendo se vai tentar de novo (US-9). Três avisos por tarefa em
incidente de rede é ruído.

## Apresentar revisões

Mandar o álbum é efeito externo e não cabe na transação do `concluir`. Quem
apresenta é o `apresentador`, num laço só (o mesmo tick do reconciliador, nunca um
por papel): para cada fluxo em `awaiting_*`, chave `fluxo:stage:rodada:apresentacao`
sob `executarUmaVez` com `repetirSeFalhou`. A política repete quando a chave tem
`erro` gravado, ou quando está reservada sem resultado há mais de 10 minutos (o
processo caiu no meio; álbum em voo não conta). Teto de 5 tentativas por chave,
coluna `tentativas` em `idempotency_keys`; passou do teto, o apresentador loga e
para de insistir. Álbum duplicado é tolerável; álbum nunca enviado não é. É o
oposto da entrega, onde duplicar é o erro e a chave fica indeterminada.

Conteúdo por estágio (PRD §4.7):

- `prototype`: brief curto; álbum das prévias; mensagem com `vN`, território e
  justificativa curta; teclado `Aceitar v1..vN` / `Ajustar v1..vN` / `Recusar todas`,
  `Cancelar`. Com uma versão só (depois de ajuste), `Aceitar` e `Ajustar`.
- `package`: álbum com Feed e Stories; legenda numa mensagem só dela; teclado
  `Aceitar pacote` / `Ajustar Feed`, `Ajustar Stories`, `Ajustar legenda` (a `opcao`
  é a versão alvo) / `Recusar`, `Cancelar`. `Recusar` aqui é `encerrar`.

## Conversa no Telegram

O que acontece antes de existir fluxo, e o texto do ajuste depois do botão, moram
numa máquina de estado por chat, gravada na tabela `conversas`.

```ts
type EstadoConversa =
  | { etapa: "ociosa" }
  | { etapa: "formato"; tema: string }
  | { etapa: "confirmacao"; fluxoId: FluxoId }
  | { etapa: "instrucao"; data: string };   // callback de ajustar já validado
```

Botões de conversa usam o codec `c|<acao>|<arg>`: `c|f|feed`, `c|f|stories`,
`c|f|both`, `c|ok|<fluxo>`, `c|no|<fluxo>`. Botões de aprovação continuam em `a|`.

A máquina é total: toda combinação de etapa e evento tem uma linha, e a tabela
mora numa estrutura, não em `if` espalhado. Eventos: texto, comando (`/start`,
`/status`, `/cancelar`), `c|f`, `c|ok`, `c|no`, `a|` (ajustar), `a|` (outras).

- Fluxo ativo do chat é o último não terminal. Fluxo parado em `requested` (o
  Ricardo nunca confirmou) não conta como ativo: um tema novo cancela ele e começa
  de novo.
- Texto em `ociosa` com fluxo ativo → diz em que etapa está e oferece `/cancelar`.
  Sem fluxo ativo → o texto é o tema; vai para `formato` e pergunta o formato.
- Texto em `formato` → tema novo, pergunta de novo. Texto em `confirmacao` → repete
  o brief. Texto em `instrucao` → `aoCallback` com `notas`, `ociosa`.
- `c|f|*` em `formato` → `criarFluxo`, `confirmacao`, brief com `Confirmar` e
  `Cancelar`. `c|f|*` em qualquer outra etapa → ignora com aviso curto.
- `c|ok` e `c|no` só valem em `confirmacao` e para o mesmo `fluxoId`; `c|ok` →
  `confirmarBrief`, `c|no` → `cancelar`; os dois → `ociosa`.
- `a|` com `ajustar` → `validarCallback`; ok → `instrucao` e pede o texto. Qualquer
  outro `a|` → `aoCallback` e resposta em palavras simples; se estava em
  `instrucao`, o ajuste pendente morre e a etapa volta a `ociosa`.
- `/cancelar` cancela o fluxo ativo e limpa a etapa. `/status` não muda etapa.
  Qualquer data mostrada usa `America/Fortaleza`.

O aprovador vem de `APROVADOR_TELEGRAM_ID`; vazio é `0` e nada é aprovável. A
allowlist de chats continua fechando por padrão. Atualizações do mesmo chat rodam
em série (uma promessa por chat), para dois toques rápidos não lerem o mesmo estado.

## Perfis de adaptadores

| Perfil | Modelos | Telegram | Linear | Exige |
|---|---|---|---|---|
| `fake` | falsos | falso | falso | nada |
| `ensaio` | falsos | real | falso | `TELEGRAM_BOT_TOKEN` |
| `real` | DeepSeek e Gemini | real | real | `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `LINEAR_API_KEY`, `LINEAR_LABEL_ID` |

O erro nomeia a variável que falta. `ensaio` é o que vai para produção enquanto as
chaves não chegam.

## Adaptadores reais

- DeepSeek: `POST https://api.deepseek.com/chat/completions`, `model: deepseek-v4-pro`,
  `response_format: {type: "json_object"}`, `AbortSignal.timeout(120_000)`. A saída
  é dado externo: uma função `parse` por contrato narra o JSON para o tipo, e
  `direction_id` é atribuído por nós (`idCurto` do tema, rodada, índice e headline),
  nunca pelo modelo. Três direções exatas, territórios distintos, headline em
  português com até 6 palavras. Legenda: `#EMVidros` tem que ser a primeira hashtag;
  falhou, uma retentativa com o erro no prompt, depois erro transitório.
- Gemini designer: `interactions.create` com `model: gemini-3.1-flash-image`,
  `response_format {type: image, aspect_ratio, image_size: 2K}`, o logo oficial como
  imagem de entrada, `previous_interaction_id` no refino e no ajuste. O prompt sai
  dos campos da `DirecaoVisual`. `refId` é o id da interação. Os bytes voltam como
  vêm; `normalizarMestre` aceita PNG ou JPEG.
- Gemini diretor de arte: `gemini-3.6-flash`, rubrica de `src/art/review.ts` portada,
  headline literal da direção, JSON narrado para `Veredito`.
- Telegram: `sendMessage`, `sendMediaGroup`, `sendPhoto`, `sendDocument`, `getFile`,
  download em `https://api.telegram.org/file/bot<token>/<file_path>`,
  `answerCallbackQuery`. Texto puro por padrão.
- Linear: porta de `src/linear/index.ts` com `Buffer` no anexo.

## Migração 003

Apaga `conversations`, `posts`, `queue`, `media` e `calendar_sent`, logando a
contagem de cada uma, e cria `conversas (chat_id INTEGER PRIMARY KEY, estado_json
TEXT NOT NULL, atualizado_em)`. Também soma `tentativas INTEGER NOT NULL DEFAULT 0`
em `idempotency_keys`. Não há guarda contra linha no v1: o bot v1 escreve em
`conversations` a cada mensagem que processa, e um boot que trava por causa de uma
linha de conversa velha seria pior que perder a linha.

## Arnês

- `ponta-a-ponta.ts`: fakes, workers em processo e a camada de conversa dirigida por
  updates sintéticos. `both`: tema → formato → confirmar → três prévias com botões →
  `Ajustar v2` e texto → uma prévia nova → aceitar → pacote com legenda → aceitar →
  um documento por versão com hash conferido → issue no Linear com anexos →
  `archived`. Apresentar duas vezes não manda dois álbuns. `stories` pula o pacote.
  Tema com `__REPROVAR__` reprova três vezes, cai em `revisao_manual` e avisa.
- `fronteira.ts` perde as exceções do v1 e ganha a regra de que `api.telegram.org` e
  `api.linear.app` só aparecem em `src/adaptadores/`.
- Suítes existentes atualizadas para `SaidaTarefa`, a chave nova, o aceite com dois
  saltos e a migração 003.

## Fora da Fase 2

Blog inteiro (Fase 3). Orçamento por pedido (§4.12), que espera o benchmark.
Substituto do Ricardo. Retenção de artefatos. "Marcar como publicado".
