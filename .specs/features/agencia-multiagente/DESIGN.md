# Design congelado — Fase 1 (Fundação)

Spec: `docs/prd-agencia-multiagente.md` §4 e §5.1. Este arquivo é o contrato que a
implementação segue. Saiu de duas explorações independentes que convergiram no
essencial; onde divergiram, a escolha está registrada em `decisoes.tsv`.

## Módulos

```
src/modelos/tipos.ts           ids marcados, estados, TRANSICOES_*, TAREFA_DO_ESTADO
src/controle/db.ts             único import de bun:sqlite em toda a árvore
src/controle/migracoes.ts      migrações ordenadas por PRAGMA user_version
src/controle/fluxos.ts         criarFluxo, transicionar (CAS + evento na mesma transação)
src/controle/tarefas.ts        fila com lease e época
src/controle/artefatos.ts      versões imutáveis endereçadas por conteúdo
src/controle/aprovacoes.ts     codec de callback_data, decidir()
src/controle/idempotencia.ts   executarUmaVez()
src/controle/entregas.ts       deliveries com chave única
src/controle/reconciliador.ts  reconciliar() no boot e a cada 30 s
src/controle/api.ts            ControlePlano (workers) e EntradaTelegram (webhook)
src/adaptadores/tipos.ts       contratos dos 4 papéis de modelo, PortaTelegram, PortaLinear
src/adaptadores/imagem.ts      normalização sharp, determinística, sem modelo
src/adaptadores/fake.ts        fakes offline determinísticos
src/adaptadores/index.ts       carregarAdaptadores()
scripts/verificar/*.ts         arnês dos três predicados + fronteira
```

Nada de `src/` é apagado na Fase 1. `src/brain`, `src/art`, `src/caption`,
`src/publish`, `src/scheduler`, `src/instagram` e `src/server.ts` continuam
servindo o bot v1 e caem juntos no primeiro commit da Fase 2, quando o fluxo novo
atende a mesma conversa. Uma fase de convivência com fim marcado, sem ponte nos
dois sentidos.

## Banco

Um arquivo só, `data/em-marketing.db`, o mesmo de hoje. O `CREATE TABLE IF NOT
EXISTS` no boot é um sistema de migração que só sabe somar tabela, então sai e
entra `PRAGMA user_version`.

- **Migração 001** adota as cinco tabelas que já existem, verbatim, incluindo
  `calendar_sent`. Contra o arquivo de produção é no-op.
- **Migração 002** cria as oito tabelas novas.

Não há backfill porque não há dado. Conferido em 25/08/2026 numa cópia read-only
do arquivo de produção: `conversations`, `posts`, `queue`, `media` e
`calendar_sent` com zero linha, `user_version = 0`. Bate com o `STATE.md`, que
registra allowlist vazia e `setWebhook` nunca rodado.

## Entidades

Oito, não as catorze do PRD §4.5.

Ficam: `brand_versions`, `workflow_runs`, `tasks`, `artifact_versions`,
`approvals`, `deliveries`, `idempotency_keys`, `events`.

Saem, com motivo:

- `projects`. Uma empresa, uma marca. É constante de configuração, não tabela.
- `requests`. Um pedido gera exatamente um fluxo. Os campos do §3.3 viram
  `workflow_runs.pedido_json`, com os nomes do PRD preservados dentro do JSON.
- `artifacts`. Pai cujo único conteúdo é identidade. Vira `linhagem_id` mais
  `versao` na própria `artifact_versions`, o que também elimina o estado ilegal
  "artefato sem nenhuma versão".
- `task_attempts`. Tentativa é evento. `tasks.tentativas` mais linhas de `events`
  respondem tudo que o §4.12 pergunta. Volta a ser tabela quando houver custo real
  para agregar, o que exige chave de API.
- `visual_directions` e `reviews`. São saída dos workers, que são Fase 2. Quando
  chegarem, são linha de `artifact_versions` com `papel='direcao'` e `papel='qa'`.
  Congelar o schema antes do prompt que o produz é migração garantida.
- `delegations`. O §5.4 admite que o substituto do Ricardo não foi nomeado.

Entra uma que o PRD esqueceu: `idempotency_keys`, exigida pelo §4.6 e ausente do
§4.5.

## Máquinas de estado

Uma tabela `workflow_runs`, dois alfabetos. Duas tabelas dobrariam toda chave
estrangeira, toda consulta do reconciliador e todo join de evento sem ganhar
segurança, porque a diferença entre as máquinas é só o conjunto de arestas legais.

A representação é **tabela de transição**, não união discriminada. Estado aqui não
carrega payload próprio, que mora em `tasks` e `artifact_versions`, então a união
seria dezessete variantes vazias. O que precisa de tipo são as arestas, e é a
aresta que a tabela torna legível, diffável e enumerável. O arnês itera a tabela,
e é por isso que "sobrevive a uma reinicialização em cada estado" vira mecânico em
vez de virar lista mantida na mão.

`transicionar()` é a única função em qualquer lugar que escreve
`workflow_runs.estado`. Ela valida a aresta contra a tabela, faz
`UPDATE ... WHERE id = ? AND estado = ? AND versao = ?` e grava o evento, tudo numa
transação. Zero linhas alteradas significa que outro escritor passou na frente, e
aí é erro, nunca retry cego.

Duas ambiguidades do PRD resolvidas aqui, e as duas merecem confirmação do Ricardo:

- **`rejected` contra "Recusar todas".** O §4.3 lista `rejected` junto de
  `cancelled` e `failed`, o que lê como terminal. A US-3 diz que depois de uma
  recusa o agente cria três direções novas, o que lê como volta ao mesmo fluxo. As
  duas não podem valer. Resolvido como dois verbos: recusar todas vai para
  `directions_ready` com a rodada incrementada, e `rejected` é o encerrar de vez.
- **`adjustment_requested`.** É o único estado que não se descreve sozinho, porque
  o sucessor depende de o ajuste ter vindo da revisão do protótipo ou da do pacote.
  Resolvido lendo `approvals.stage`, que fica gravado.

## Reinício

A regra que sustenta tudo: **o estado do fluxo declara qual tarefa precisa
existir**, em `TAREFA_DO_ESTADO`. Nada fica só na memória.

`reconciliar()` roda no boot e a cada 30 s, nesta ordem. Expira lease vencida.
Promove tarefa sem tentativa restante para `revisao_manual` e emite evento. Para
cada fluxo não terminal, consulta `TAREFA_DO_ESTADO[estado]` e, se a tarefa exigida
não está viva, insere. A chave de idempotência `fluxo:estado:rodada` é única, então
essa inserção é no-op quando a tarefa já existe, e rodar o reconciliador de novo
não muda nada.

Estado fora do mapa é estado de espera humana. Para esses, segurança no reinício é
a ausência de trabalho: a linha já é durável e o próximo callback retoma. O
reconciliador não tem nenhuma aresta que entre ou saia de `awaiting_*`, e é assim
que "nunca aprova por tempo decorrido" fica estrutural em vez de prometido.

## Lease com época

Reivindicar é uma instrução SQL só, atômica, que já devolve a época nova. Bater,
concluir e falhar carregam `WHERE id = ? AND lease_epoca = ? AND estado =
'reivindicada'`.

A época é o truque. Um worker zumbi que travou além do lease encontra a época
incrementada por quem reivindicou depois, então o `concluir` dele altera zero
linhas e ele descobre que perdeu. Sem a época, um worker lento conclui tarefa que
outro já está rodando, e os dois escrevem artefato.

## Artefatos

Endereçados por conteúdo em `ARTIFACTS_DIR/<sha[0:2]>/<sha>.<ext>`, escritos com
flag `wx`. Se o arquivo existe, os bytes já estão lá e a escrita é pulada, o que
torna guardar o mesmo conteúdo duas vezes de graça em vez de corrida.

Imutabilidade em três camadas: modo 0444 no arquivo, gatilho `BEFORE UPDATE` e
`BEFORE DELETE` no SQLite, e `UNIQUE(linhagem_id, versao)` para número de versão
não ser reusado. `derivada_de` carrega a linhagem de ajuste (US-3) e de derivação
(US-4, o Stories que sai do Feed aprovado).

PNG mestre, preview JPEG e texto são um modelo só, sem caso especial. Texto é
`Buffer` UTF-8 e ganha o mesmo hash de conteúdo.

**US-5 contra a API real.** `sendDocument` devolve `result.document.file_id`.
Chamar `getFile`, baixar de
`https://api.telegram.org/file/bot<token>/<file_path>`, hashear e comparar com
`artifact_versions.sha256`, gravando em `deliveries.hash_conferido`. O teto de
download de bot é 20 MB e um PNG 1080×1350 fica muito abaixo. Esse ida e volta é a
única coisa que prova de fato que o Telegram não mexeu nos bytes, e por isso mora
no caminho de entrega, não num script avulso. Na Fase 1 a porta fake implementa
`sendDocument`, `getFile` e `baixarArquivo` em memória, então o código de
comparação roda de verdade offline e só o salto de rede fica sem prova.

## Aprovação

O teto de `callback_data` é 64 bytes, então os ids são 12 chars em base32
Crockford, não UUID.

```
a|<fluxo12>|<st>|<ac>|<opcao12>

st   p=prototype  k=package  c=copy
ac   a=aceitar  j=ajustar  r=recusar todas  x=cancelar  e=encerrar
```

Pior caso 31 bytes. Sem HMAC: ninguém forja callback de um teclado que nunca
recebeu, e a autorização é a checagem do revisor, que é mais forte que assinatura.

O callback carrega o mínimo que identifica a decisão. O conjunto exato coberto,
que o §3.3 exige, é resolvido no servidor a partir de
`workflow_runs.revisao_pendente`, gravado quando a revisão abriu, e copiado para
`approvals.artifact_version_ids` no ato. Assim o teto de 64 bytes nunca limita
quantos artefatos uma aprovação cobre.

`decidir()` roda cinco checagens numa transação e não escreve nada se qualquer uma
falhar. O revisor tem que ser `APROVADOR_TELEGRAM_ID`, comparado contra
`callback_query.from.id`, não contra o chat. O `src/server.ts` de hoje só checa o
chat, o que deixaria qualquer um de um grupo permitido aprovar. Essa distinção é
estrutural.

A checagem de vencida é a rodada: pedir ajuste ou recusar incrementa
`workflow_runs.rodada` e reescreve `revisao_pendente`, então botão de álbum antigo
fica uma rodada atrás e é recusado. `UNIQUE(workflow_id, stage, rodada)` faz duplo
toque no mesmo botão virar no-op em vez de duas decisões.

## Costura offline

`src/adaptadores/` é o único diretório da árvore com permissão de importar
`@google/genai` ou de dar `fetch` em host de modelo, e isso é conferido por script,
não lembrado. Estende a propriedade que o `STATE.md` credita por ter sobrevivido ao
bloqueio de billing: hoje o limite é uma função, depois disto é um diretório, e
agora é checado.

Os fakes são determinísticos, semeados por hash da entrada, então o mesmo brief
sempre gera os mesmos artefatos e o arnês é reproduzível. O designer fake devolve
**PNG de verdade** na dimensão exata que o Nano Banana 2 emite, 1856×2304 no feed e
1536×2752 no stories, montado com `sharp` a partir de tela teal dos
`brand/tokens.json`, camada SVG com o headline e o logo oficial composto. É o truque
que o `STATE.md` já validou em 05/08/2026, promovido de script avulso para estrutura
permanente. A consequência é o que importa: o caminho determinístico inteiro roda
sem rede.

Chave nova entra em `src/adaptadores/`, num arquivo, e nada mais muda.

## Arnês

`bun run verificar` roda tudo contra banco temporário com `ADAPTADORES=fake` e
entra no CI antes do build do Docker.

- `reinicio.ts` (predicado 1). Itera as chaves das duas tabelas de transição, então
  estado novo sem prova de reinício quebra o build. Para cada estado, um processo
  filho leva o fluxo até lá e leva **SIGKILL**, não saída limpa, para a recuperação
  do WAL ser real. Um segundo processo sobe contra o mesmo arquivo e confere quatro
  coisas: o estado não mudou, o conjunto de tarefas bate com `TAREFA_DO_ESTADO` sem
  duplicata, rodar o reconciliador de novo não muda nada, e o fluxo ainda avança uma
  aresta legal.
- `aprovacao-vencida.ts` (predicado 2). Também cobre callback de id não autorizado,
  duplo toque virando uma linha só, e relógio adiantado 30 dias sem aprovar nada.
- `entrega-unica.ts` (predicado 3). Mais o ida e volta de hash da US-5 e o caso de
  SIGKILL entre o envio e o recibo, que tem que virar `indeterminada` com aviso ao
  Ricardo e zero reenvio automático.
- `fronteira.ts`. Falha se `bun:sqlite` aparecer fora de `src/controle/db.ts`, se
  `@google/genai` aparecer fora de `src/adaptadores/`, ou se existir `UPDATE` em
  `events`, `approvals` ou `artifact_versions`.

## Fora da Fase 1

O §4.10 inteiro, que é conteúdo de v1.1 morando em documento de v1. O botão
"Marcar como publicado" do §4.9. A memória por agente do §3.4, que é subsistema sem
store, sem recuperação e sem limite de tamanho. As URLs opacas que expiram do
§4.11, que descrevem um canal que não existe nesta versão, já que tudo sai como
documento do Telegram.
