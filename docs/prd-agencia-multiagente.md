# PRD: Agência multiagente de marketing da EM Vidros

**Produto:** `em-marketing`
**Data:** 25/08/2026
**Status:** Rascunho para revisão
**Responsável pela aprovação:** Ricardo, gerente de marketing
**Escopo:** Instagram estático e copywriting para o blog

Este PRD amplia o produto descrito em `docs/prd.md`. O PRD atual continua como
registro da primeira versão do bot. Este documento passa a ser a fonte de verdade
para a separação dos agentes e para os novos fluxos de aprovação.

## 1. Executive Summary

### 1.1 Problem Statement

O `em-marketing` já gera artes, legendas e registros. Porém, um único processo
decide o fluxo, chama os modelos, guarda o estado e executa as integrações. Os
papéis descritos em `agencia/` ainda não são agentes independentes.

Ricardo precisa pedir um tema, receber propostas visuais baseadas no brandbook e
julgar protótipos reais. Ele não deve escolher um estilo antes de ver o trabalho.
Nenhuma peça pode sair como aprovada sem uma decisão explícita dele.

O produto também precisa produzir artigos para o blog da EM Vidros. O texto deve
ser escrito de vidraceiros para vidraceiros, com linguagem simples, direta e
humanizada.

### 1.2 Proposed Solution

O produto terá um plano de controle durável e agentes separados por função. O
plano de controle será o único dono do estado. Cada agente receberá uma tarefa,
um pacote de contexto imutável e apenas as ferramentas necessárias.

O DeepSeek V4 Pro cuidará da direção criativa, do texto e, em versões futuras,
do código. O Gemini Nano Banana 2 cuidará da geração e da edição das imagens. Um
modelo multimodal separado fará o controle visual. Código determinístico cuidará
da aprovação, dos arquivos, do Linear e da entrega manual.

### 1.3 Success Criteria

| KPI | Meta nos primeiros 30 dias |
|---|---|
| Trabalhos concluídos sem aprovação válida do Ricardo | 0 |
| Tempo entre o pedido e a entrega dos três protótipos | até 5 minutos em 90% dos pedidos |
| Pedidos com uma opção aceita na primeira rodada | pelo menos 70% |
| Arquivos finais com dimensão, cor e hash corretos após download | 100% |
| Erros de grafia ou fatos inventados em peças aprovadas | 0 |
| Artigos aprovados sem reescrita completa | pelo menos 70% |

### 1.4 Decisões de produto

- Ricardo informa o tema, o formato e qualquer restrição comercial.
- O agente escolhe e explica três direções visuais com base no brandbook.
- Cada direção produz um protótipo distinto.
- Ricardo aceita uma opção, pede ajustes ou recusa todas.
- A versão aprovada nunca é recriada do zero.
- A publicação no Instagram e no blog continua manual na primeira versão.
- O Telegram entrega a imagem final como documento para preservar os bytes.
- A automação futura usará um painel de calendário dentro do Telegram.

## 2. User Experience & Functionality

### 2.1 Personas

| Persona | Papel | Necessidade |
|---|---|---|
| Ricardo | Gerente de marketing e aprovador | Pedir, comparar, corrigir, aprovar e baixar o material pelo celular |
| Time de marketing | Solicitante autorizado | Acompanhar pedidos e usar materiais aprovados |
| Henrique | Mantenedor | Ver falhas, custos, tentativas e histórico sem abrir o banco manualmente |

Ricardo é o único aprovador na primeira versão. Um substituto só pode aprovar
quando um administrador registrar uma delegação com início e fim.

### 2.2 Fluxo do Instagram

1. Ricardo envia o tema e escolhe `Feed`, `Stories` ou `Ambos`.
2. O diretor criativo lê a versão atual do brandbook, dos tokens e dos estilos.
3. O diretor criativo cria três direções visuais distintas.
4. O redator define o headline e o apoio de cada direção.
5. O designer gera três protótipos com o Nano Banana 2.
6. O diretor de arte revisa marca, texto, composição, logo e zonas seguras.
7. Ricardo recebe os protótipos no Telegram.
8. Ricardo aceita uma opção, pede ajustes ou recusa todas.
9. O sistema preserva a opção aceita e produz os arquivos finais.
10. Ricardo baixa o arquivo sem perda causada pelo Telegram.
11. O sistema arquiva o trabalho no Linear.
12. Ricardo publica manualmente no Instagram.

No formato `Ambos`, o sistema gera primeiro três protótipos de Feed. Depois da
escolha, o designer adapta o conceito para Stories. Ricardo recebe o Feed e o
Stories juntos antes de aprovar o pacote final.

### 2.3 Fluxo do blog

1. Ricardo informa o tema do artigo.
2. O redator consulta o brandbook, o guia de voz e as fontes fornecidas.
3. O redator propõe três combinações de título e ângulo.
4. Ricardo escolhe uma combinação ou pede novas opções.
5. O redator cria o artigo completo.
6. Um revisor verifica clareza, gramática, fatos, tom e chamada para ação.
7. Ricardo aceita, pede ajustes ou recusa o texto.
8. O sistema entrega o artigo aprovado em Markdown e texto simples.
9. O sistema arquiva o artigo e o histórico de revisão no Linear.
10. Ricardo publica manualmente no blog.

### 2.4 Histórias de usuário e critérios de aceite

#### US-1: Pedir conteúdo para Instagram

> Como Ricardo, quero informar um tema e um formato para receber propostas prontas
> sem precisar escolher o estilo visual antes.

Critérios de aceite:

- O bot aceita uma mensagem livre em português.
- O bot exige `Feed`, `Stories` ou `Ambos` antes de gerar imagens.
- O bot confirma tema, objetivo e formato antes de gastar créditos de imagem.
- O bot usa o brandbook vigente na data do pedido.
- O bot não pede que Ricardo escolha paleta, tipografia ou território visual.

#### US-2: Receber três direções visuais

> Como Ricardo, quero comparar três caminhos visuais para escolher com base no que
> vejo, não em uma descrição abstrata.

Critérios de aceite:

- O sistema gera exatamente três protótipos por rodada.
- Cada protótipo representa uma direção visual distinta.
- Cada direção registra composição, paleta, tipografia, elemento principal,
  headline, uso do logo e justificativa.
- As três direções respeitam `brand/BRANDBOOK.md` e `brand/tokens.json`.
- O sistema envia os três protótipos em um álbum do Telegram.
- O sistema identifica as opções como `v1`, `v2` e `v3`.
- O sistema só envia um protótipo depois que ele passa pelo controle visual.
- Se uma direção não passar após o limite de tentativas, o sistema informa a
  falha e não substitui a direção silenciosamente.

#### US-3: Revisar um protótipo

> Como Ricardo, quero aceitar, ajustar ou recusar os protótipos para manter o
> controle da comunicação da marca.

Critérios de aceite:

- O Telegram mostra os botões `Aceitar`, `Pedir ajustes` e `Recusar todas`.
- Somente o Telegram ID de Ricardo ou de um substituto ativo executa essas ações.
- `Aceitar` registra a versão exata do protótipo e encerra as outras opções.
- `Pedir ajustes` solicita uma instrução em linguagem natural.
- O designer edita a opção indicada e preserva os elementos não citados.
- A versão ajustada recebe um novo número e volta para aprovação.
- `Recusar todas` encerra as três direções atuais.
- Depois de uma recusa, o agente cria três direções novas. Ele não repete os
  mesmos prompts com outra semente.
- Uma decisão enviada para uma versão antiga é recusada como aprovação vencida.

#### US-4: Aprovar Feed e Stories em conjunto

> Como Ricardo, quero ver Feed e Stories do mesmo conceito antes de aprovar o
> pacote para manter as duas peças consistentes.

Critérios de aceite:

- O Feed aprovado orienta a adaptação para Stories.
- O Stories usa o mesmo conceito, as mesmas cores e o mesmo elemento principal.
- O designer recompõe o Stories em 9:16. O sistema não usa apenas um recorte.
- Ricardo recebe Feed, Stories e legenda do Feed na revisão final.
- Qualquer mudança feita depois dessa revisão exige nova aprovação.

#### US-5: Baixar a imagem final sem perda na transferência

> Como Ricardo, quero baixar o arquivo final sem compressão do Telegram para
> publicar a imagem com a melhor qualidade disponível.

Critérios de aceite:

- O bot envia uma prévia como foto para facilitar a revisão no celular.
- Depois da aprovação, o bot envia o arquivo mestre com `sendDocument`.
- O mestre usa PNG, sRGB e compressão sem perda.
- O Feed mede exatamente 1080 por 1350 pixels.
- O Stories mede exatamente 1080 por 1920 pixels.
- O sistema também pode entregar um JPEG pronto para Instagram. Esse JPEG não
  substitui o mestre PNG.
- O SHA-256 do documento baixado é igual ao SHA-256 do artefato armazenado.
- O nome do arquivo contém o trabalho, o formato e a versão aprovada.
- O sistema não envia o mestre final com `sendPhoto`.

O Instagram pode recomprimir a imagem durante a publicação. O produto garante
que o Telegram não degrade o arquivo entregue a Ricardo.

#### US-6: Gerar o texto do Instagram

> Como Ricardo, quero receber a legenda do Feed junto da arte para publicar o
> conteúdo sem reescrever o texto.

Critérios de aceite:

- O redator gera a legenda somente quando o pacote inclui Feed.
- Stories não recebem legenda de publicação.
- A legenda segue `brand/voice.md`.
- `#EMVidros` é a primeira hashtag.
- O texto usa português simples, direto e humanizado.
- A legenda não inventa preço, estoque, filial, certificação ou especificação.
- Ricardo pode pedir ajuste apenas na legenda sem invalidar a imagem.
- Uma mudança no headline da imagem invalida a aprovação visual.

#### US-7: Gerar o texto do blog

> Como Ricardo, quero transformar um tema em um artigo útil para vidraceiros para
> manter o blog ativo com conteúdo que o público entende.

Critérios de aceite:

- O redator propõe três títulos com ângulos diferentes antes do artigo completo.
- O artigo padrão contém entre 700 e 1.200 palavras.
- Ricardo pode pedir outro tamanho no brief.
- O texto fala de vidraceiros para vidraceiros.
- O texto usa frases claras, exemplos práticos e termos do trabalho real.
- O texto evita linguagem corporativa, frases genéricas e exageros comerciais.
- O artigo contém título, introdução, seções, conclusão e chamada para ação.
- O pacote inclui título SEO, descrição SEO, slug sugerido e texto alternativo
  para a imagem de capa, quando houver imagem.
- Toda afirmação técnica vem do brandbook, do catálogo aprovado ou de uma fonte
  anexada ao brief.
- O redator marca como pendência qualquer dado que não tenha fonte.
- O sistema entrega o artigo aprovado como `.md` e `.txt`.
- O sistema nunca publica o artigo no CMS na primeira versão.

#### US-8: Arquivar e entregar o trabalho aprovado

> Como Ricardo, quero encontrar o trabalho aprovado e seu histórico para saber o
> que foi usado e por que uma versão foi escolhida.

Critérios de aceite:

- O Linear recebe o tema, o brief, as direções, a decisão e os arquivos finais.
- O histórico registra ajustes e recusas sem apagar versões anteriores.
- O bot informa que o material está pronto para publicação manual.
- O bot nunca afirma que publicou no Instagram ou no blog.
- A entrega manual funciona sem credenciais da Meta ou do CMS.

#### US-9: Recuperar falhas

> Como Ricardo, quero receber um aviso quando uma etapa falhar para não esperar por
> um trabalho que parou em silêncio.

Critérios de aceite:

- O bot informa qual etapa falhou e se o sistema tentará novamente.
- Uma tarefa interrompida volta para a fila quando o prazo da execução expira.
- Repetir uma tarefa não duplica artefatos aprovados, issues ou entregas.
- O botão `Cancelar` encerra tarefas que ainda não foram aprovadas.
- O sistema nunca aprova um trabalho por tempo decorrido.

### 2.5 Fora do escopo

Estes itens ficam fora da primeira versão:

- Publicação automática no Instagram.
- Publicação automática no CMS do blog.
- Carrossel, Reels, vídeo e áudio.
- Landing pages, calculadoras e outros trabalhos do Devbot.
- Animações e protótipos de motion.
- Operação automática no Figma.
- Respostas a comentários ou mensagens diretas.
- Métricas, atribuição comercial e otimização automática.
- Aprovação por vários níveis ou comitês.
- Aplicativo web completo.
- Conteúdo para outras marcas.

## 3. AI System Requirements

### 3.1 Agentes e componentes

| Componente | Modelo | Responsabilidade | Pode publicar |
|---|---|---|---|
| Diretor criativo | `deepseek-v4-pro` | Transformar tema e marca em direções visuais | Não |
| Redator | `deepseek-v4-pro` | Headline, legenda, títulos e artigos | Não |
| Designer visual | `gemini-3.1-flash-image` | Gerar e editar imagens | Não |
| Diretor de arte | Modelo multimodal separado | Revisar marca, texto, logo e composição | Não |
| Plano de controle | Sem LLM | Controlar estado, tarefas, aprovações e orçamento | Não |
| Operações | Sem LLM | Entregar arquivos e arquivar no Linear | Não |

O Nano Banana 2 não controla ferramentas. O worker de design recebe um contrato
validado, chama o modelo e devolve artefatos. O plano de controle decide a próxima
etapa.

O DeepSeek V4 Pro deve usar Chat Completions ou a interface compatível com
Anthropic. A Responses API do DeepSeek ainda não aceita V4 Pro na data deste PRD.

Referências:

- DeepSeek models and pricing: <https://api-docs.deepseek.com/quick_start/pricing>
- DeepSeek tool calls: <https://api-docs.deepseek.com/guides/tool_calls>
- Nano Banana 2: <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image>
- Gemini image generation: <https://ai.google.dev/gemini-api/docs/image-generation>

### 3.2 Ferramentas permitidas

| Agente | Ferramentas |
|---|---|
| Diretor criativo | Ler brandbook, tokens, estilos, calendário e brief |
| Redator | Ler guia de voz, catálogo aprovado, fontes e versões anteriores |
| Designer visual | Ler referências de marca, chamar Nano Banana 2 e enviar artefatos |
| Diretor de arte | Ler imagem, tokens, headline, formato e rubrica de qualidade |
| Operações | Telegram, Linear e armazenamento de artefatos |

Cada worker recebe apenas essas ferramentas. O designer não recebe credenciais do
Linear. O redator não recebe acesso ao armazenamento interno. Operações não recebe
permissão para alterar conteúdo aprovado.

### 3.3 Contratos centrais

#### Pedido criativo

| Campo | Requisito |
|---|---|
| `request_id` | Identificador único |
| `requested_by` | Telegram ID autorizado |
| `kind` | `instagram` ou `blog` |
| `theme` | Tema informado por Ricardo |
| `format` | `feed`, `stories`, `both` ou `blog` |
| `objective` | Objetivo comercial ou editorial |
| `constraints` | Datas, filiais, produtos e proibições |
| `brand_version` | Versão imutável do contexto de marca |

#### Direção visual

| Campo | Requisito |
|---|---|
| `direction_id` | Identificador único da direção |
| `territory` | Território visual do brandbook |
| `composition` | Estrutura da peça |
| `palette` | Tokens de cor permitidos |
| `typography` | Hierarquia tipográfica |
| `main_element` | Elemento visual principal |
| `headline` | Texto literal da arte |
| `support_text` | Texto de apoio opcional |
| `logo_rule` | Variante e posição do logo |
| `rationale` | Relação entre tema, público e direção |
| `prohibited_elements` | Elementos que o designer não pode adicionar |

#### Decisão de revisão

| Campo | Requisito |
|---|---|
| `decision_id` | Identificador único |
| `reviewer_id` | Telegram ID de Ricardo ou substituto ativo |
| `stage` | `prototype`, `package` ou `copy` |
| `artifact_version_ids` | Versões que a decisão cobre |
| `decision` | `accepted`, `adjustment_requested` ou `rejected` |
| `notes` | Pedido de ajuste ou motivo da recusa |
| `decided_at` | Instante da decisão |

Uma aprovação cobre somente as versões listadas em `artifact_version_ids`.

### 3.4 Requisitos de prompt e memória

- O brandbook, os tokens e o guia de voz entram como uma versão identificada.
- O agente recebe apenas o contexto necessário para a tarefa atual.
- Cada agente tem memória própria de exemplos e feedback aprovado.
- Os agentes não editam uma memória coletiva.
- Uma correção de Ricardo só vira referência depois que ele aprovar a nova versão.
- O sistema registra o modelo, a versão do prompt e a versão da marca em cada
  artefato.
- Dados de um pedido não entram no contexto de outro pedido sem uma referência
  explícita.

### 3.5 Estratégia de avaliação

#### Benchmark de imagem

O benchmark usa pelo menos dez temas reais. O conjunto deve cobrir produto,
educação, data comemorativa, profissão, promoção e bastidor.

Verificações automáticas:

- Dimensão exata.
- PNG mestre válido e sRGB.
- Hash preservado no download.
- Teal dominante dentro da família definida em `tokens.json`.
- Logo oficial presente e não redesenhado.
- Headline idêntico ao texto aprovado.
- Zero erro ortográfico.
- Zonas seguras de Stories respeitadas.
- Três direções visualmente diferentes.

Verificações humanas de Ricardo:

- A peça combina com o tema.
- A peça parece produzida pela EM Vidros.
- A mensagem é entendida em tela de celular.
- Pelo menos uma opção pode ser usada sem recomeçar o trabalho.

Critério de liberação:

- Pelo menos oito dos dez temas têm uma opção aceita sem nova direção.
- Todos os arquivos passam nas verificações técnicas.
- Nenhum protótipo de teste é publicado.

#### Blog benchmark

O benchmark usa pelo menos dez temas úteis para vidraceiros. Os temas devem
incluir instalação, segurança, escolha de produto, manutenção, atendimento e
gestão do trabalho.

Verificações automáticas:

- Tamanho dentro do brief.
- Título, introdução, seções, conclusão e chamada para ação presentes.
- Título SEO, descrição SEO e slug presentes.
- Nenhum dado marcado como pendente aparece como fato.
- Zero erro ortográfico.

Verificações humanas de Ricardo:

- O texto parece escrito por alguém que conhece a rotina do vidraceiro.
- A linguagem é simples, direta e humana.
- O artigo ensina algo que o leitor pode usar.
- O texto não soa genérico nem corporativo.
- O CTA combina com o tema.

Critério de liberação:

- Pelo menos oito dos dez artigos passam sem reescrita completa.
- Nenhum artigo contém uma afirmação técnica sem fonte aprovada.

## 4. Technical Specifications

### 4.1 Visão geral da arquitetura

```text
Telegram
   |
   v
Control Plane
   |-- State machine and event log
   |-- Durable task queue
   |-- Approval service
   |-- Artifact service
   |
   +--> Worker de direção criativa --> DeepSeek V4 Pro
   +--> Worker de redação ---------> DeepSeek V4 Pro
   +--> Worker de design ----------> Nano Banana 2
   +--> Worker de revisão visual --> Modelo multimodal
   +--> Worker de operações -------> Telegram e Linear
```

O primeiro lançamento mantém Bun e Elysia. O SQLite continua como banco enquanto
o sistema rodar em um servidor. Somente o plano de controle abre o SQLite. Os
workers usam a API interna de controle e nunca montam o arquivo do banco.

O serviço de artefatos controla o volume durável. Os workers enviam novas versões
pela API de controle e não compartilham caminhos graváveis. Se os workers forem
distribuídos entre servidores, o serviço pode migrar para object storage sem
alterar os contratos dos agentes.

Os workers não chamam uns aos outros. Toda colaboração ocorre por tarefas e
eventos validados pelo plano de controle.

### 4.2 Componentes

#### Plano de controle

- Receives validated Telegram events.
- Creates workflows and tasks.
- Builds an immutable context package for each task.
- Enforces state transitions.
- Validates approvals.
- Applies budgets and retry limits.
- Exposes status to Telegram.

#### Execução dos workers

- Runs one agent role per process or container.
- Claims one leased task at a time.
- Sends heartbeats while the task is active.
- Returns structured output or a typed failure.
- Cannot change workflow state directly.

#### Serviço de artefatos

- Stores masters, previews, copy, metadata and hashes.
- Never overwrites an approved version.
- Creates derived previews without changing the master.
- Delivers approved masters through Telegram documents.

#### Serviço de aprovação

- Resolves the reviewer role from Telegram ID.
- Rejects callbacks for old versions.
- Records decisions as append-only events.
- Invalidates approval when covered content changes.
- Never approves by timeout.

### 4.3 Máquina de estados do Instagram

```text
requested
brief_confirmed
directions_ready
prototypes_generating
prototype_qa
awaiting_prototype_review
adjustment_requested
prototype_approved
package_finalizing
package_qa
awaiting_package_review
approved_for_manual_delivery
delivered
archived
rejected
cancelled
failed
```

`awaiting_package_review` applies when `format=both` or when finalization changes
visible content. A single-format prototype can move from `prototype_approved` to
`approved_for_manual_delivery` when finalization changes only encoding and
metadata.

### 4.4 Máquina de estados do blog

```text
requested
brief_confirmed
angles_ready
awaiting_angle_selection
draft_generating
copy_review
awaiting_copy_review
adjustment_requested
copy_approved
delivered
archived
rejected
cancelled
failed
```

### 4.5 Modelo de dados

| Entity | Purpose |
|---|---|
| `projects` | Identidade e configuração da EM Vidros |
| `brand_versions` | Snapshot do brandbook, tokens, voz e estilos |
| `requests` | Pedido original de Ricardo |
| `workflow_runs` | Execução completa de um pedido |
| `tasks` | Trabalho pertencente a um agente |
| `task_attempts` | Tentativas, custo, tempo e falhas |
| `visual_directions` | Três propostas estruturadas por rodada |
| `artifacts` | Arquivo ou texto imutável |
| `artifact_versions` | Linhagem de ajustes e derivações |
| `reviews` | Parecer automático ou humano |
| `approvals` | Decisão de Ricardo sobre versões exatas |
| `deliveries` | Downloads, arquivo no Linear e publicação futura |
| `events` | Histórico append-only do fluxo |
| `delegations` | Substituição temporária do aprovador |

### 4.6 Execução durável

- Cada tarefa recebe uma chave de idempotência.
- O worker recebe uma lease com prazo e heartbeat.
- Uma lease vencida devolve a tarefa para a fila.
- O reconciliador procura tarefas presas e entregas incompletas.
- Uma tarefa respeita limites de tentativas, duração e custo.
- Uma falha permanente vai para uma fila de revisão manual.
- Repetir `sendDocument` não cria outra entrega quando a anterior já foi
  confirmada pelo Telegram.
- Repetir o arquivo no Linear não cria outro anexo com a mesma chave.

### 4.7 Experiência no Telegram

#### Revisão dos protótipos

O bot envia:

1. Um brief curto.
2. As três prévias em um álbum.
3. Uma mensagem com os nomes das direções e justificativas curtas.
4. Botões para cada opção.
5. Botões para ajuste, recusa e cancelamento.

O callback contém o fluxo, a etapa e a versão do artefato. O plano de controle
recusa o callback quando qualquer parte não corresponde mais à revisão atual.

#### Download final

O bot envia:

1. A prévia aprovada.
2. O PNG mestre como documento do Telegram.
3. O JPEG preparado para o Instagram, quando configurado.
4. A legenda do Feed em uma mensagem separada e copiável.
5. O link do Linear.

Para o blog, o bot envia uma prévia legível e os arquivos `.md` e `.txt`.

### 4.8 Integrações

| Integração | Primeira versão | Futuro |
|---|---|---|
| Telegram Bot API | Pedido, aprovação e entrega | Mini App de agendamento |
| DeepSeek API | Direção e texto | Devbot e análise |
| Gemini API | Geração e revisão visual | Imagens de entrada para motion |
| Linear API | Arquivo e histórico | Planejamento de campanhas |
| Instagram Graph API | Desativada | Agendamento e publicação automáticos |
| CMS do blog | Desativado | Rascunho ou publicação automáticos |
| Figma | Desativado | Agente de produção |

### 4.9 Publicação manual

O primeiro lançamento não exige credenciais da Meta ou do CMS. Ricardo baixa o
mestre aprovado e publica. O bot registra `delivered`, não `published`.

Se Ricardo quiser registrar a publicação manual, ele pode pressionar `Marcar
como publicado`. A ação guarda a data e a URL opcional do Instagram. Ela não
entra em contato com o Instagram.

### 4.10 Agendamento automático futuro

A publicação automática no Instagram entra depois que o fluxo manual estiver
estável.

O teclado de botões do Telegram não oferece um calendário completo. A versão
futura abrirá um artefato de agendamento incorporado como Telegram Mini App.

O fluxo de agendamento funcionará assim:

1. Ricardo aprova o pacote final.
2. O bot mostra `Baixar`, `Publicar manualmente` e `Agendar`.
3. `Agendar` abre o artefato de calendário dentro do Telegram.
4. O artefato recebe o `workflow_id` e os `artifact_version_ids` aprovados.
5. Ricardo escolhe data e hora em `America/Fortaleza`.
6. O artefato mostra Feed, Stories, legenda e horário interpretado.
7. Ricardo confirma em `Agendar publicação`.
8. O plano de controle cria um agendamento idempotente para as versões aprovadas.
9. No horário marcado, o publicador cria o contêiner de mídia no Instagram.
10. O publicador espera o processamento, publica e registra os IDs do Instagram.
11. O bot informa a Ricardo o sucesso ou a falha exata.
12. Se a publicação falhar, os arquivos continuam disponíveis para postagem
    manual.

Alterar um artefato depois do agendamento cancela o horário. Ricardo deve aprovar
e agendar a nova versão.

O artefato de calendário deve permitir:

- Feed e Stories no mesmo horário.
- Feed e Stories em horários diferentes.
- Cancelamento antes da execução.
- Confirmação no fuso horário da EM Vidros.
- Lista de agendamentos pendentes.
- Alternativa manual para cada item.

### 4.11 Segurança e privacidade

- O webhook do Telegram valida o segredo antes de interpretar o evento.
- Uma lista de acesso limita o uso a Telegram IDs conhecidos.
- Somente Ricardo ou um substituto ativo aprova conteúdo.
- Cada worker tem credenciais separadas.
- O publicador será o único componente com credenciais da Meta.
- O publicador do blog será o único componente com credenciais do CMS.
- Textos externos e URLs são entradas não confiáveis.
- O plano de controle valida toda saída de agente contra um schema.
- Os logs ocultam tokens, bytes de imagem e dados privados do Telegram.
- URLs para download de artefatos são opacas e expiram.
- O prazo de retenção dos artefatos locais deve ser definido antes da
  implementação.
- O Linear mantém o registro de negócio depois da limpeza local.

### 4.12 Observabilidade e controle de custo

O plano de controle registra estes valores para cada tarefa:

- Papel do agente.
- Modelo e versão do modelo.
- Versão do prompt.
- Versão da marca.
- Tokens de entrada e saída.
- Quantidade e resolução das imagens.
- Latência.
- Quantidade de tentativas.
- Custo estimado e real.
- Resultado da revisão.
- Decisão de Ricardo.

O primeiro benchmark definirá o orçamento padrão por pedido. O produto deve
parar antes de ultrapassar o orçamento e perguntar a Ricardo se pode continuar.

## 5. Risks & Roadmap

### 5.1 Entregas por fase

#### Fundação do MVP

Escopo:

- Modelo de domínio e máquinas de estado.
- Plano de controle como único escritor.
- Leases duráveis para as tarefas.
- Versões imutáveis dos artefatos.
- Aprovação vinculada ao Telegram ID de Ricardo.

Comprovação:

- Um fluxo simulado sobrevive a uma reinicialização em cada estado.
- Uma aprovação vencida não aprova um artefato novo.
- Executar a mesma entrega duas vezes cria um documento no Telegram.

#### MVP Instagram

Escopo:

- Diretor criativo, redator, designer e revisor visual independentes.
- Três direções visuais.
- Feed, Stories e `Ambos`.
- Ciclos de ajuste e recusa.
- PNG mestre sem perda por `sendDocument`.
- Entrega manual e arquivo no Linear.

Comprovação:

- O benchmark de dez temas de imagem passa.
- Ricardo conclui um pedido real pelo celular.
- O hash do download corresponde ao mestre armazenado.

#### MVP blog

Escopo:

- Três propostas de título e ângulo.
- Geração do artigo completo.
- Revisão factual e de voz.
- Ciclos de ajuste e recusa.
- Entrega em Markdown e texto simples.
- Publicação manual.

Comprovação:

- O benchmark de dez temas de blog passa.
- Ricardo aprova e baixa um artigo real.

#### v1.1 Agendamento automático no Instagram

Escopo:

- Artefato de calendário em Telegram Mini App.
- Publicador pela Instagram Graph API.
- Horários separados para Feed e Stories.
- Cancelamento, novas tentativas e alternativa manual.

Comprovação:

- Uma postagem de teste é publicada até dois minutos do horário escolhido.
- Uma publicação automática com falha mantém os arquivos manuais disponíveis.

#### v1.2 Devbot

Escopo:

- Landing pages de campanha.
- Calculadoras e ferramentas interativas para vidraceiros.
- Ambiente isolado de prévia.
- Nenhum deploy em produção sem uma aprovação separada.

Exemplos:

- Calculadora de medidas e orçamento inicial.
- Landing page de promoção.
- Regulamento de sorteio.
- Página de produto com captação de contato.

#### v1.3 Motion

Escopo:

- Reels e vídeos promocionais curtos.
- Playground de animação com arquivos reais aprovados.
- Controles de duração, easing, distância e escala.
- Aprovação humana antes do vídeo final.

#### v1.4 Agente de produção

Escopo:

- Produção no Figma com componentes e coordenadas exatos.
- Carrosséis.
- Cards de WhatsApp.
- Cartazes e materiais de loja.
- Kits de campanha criados a partir de uma direção aprovada.

#### v2 Métricas e publicação

Escopo:

- Integração com o CMS do blog.
- Dados de desempenho do Instagram.
- Links, QR codes e atribuição de campanhas.
- Localização por filial.
- Uso do desempenho aprovado como referência para direções futuras.

O sistema não altera o brandbook automaticamente com base em desempenho. Ricardo
deve aprovar qualquer nova regra de marca.

### 5.2 Riscos técnicos

| Risco | Impacto | Mitigação |
|---|---|---|
| Nano Banana altera a composição durante um ajuste | Ricardo recebe uma peça diferente | Usar a imagem aprovada como referência e pedir uma edição localizada |
| O modelo redesenha o logo | Violação da marca | Usar o logo oficial como referência e bloquear o QA reprovado |
| Telegram comprime a imagem | Menor qualidade de publicação | Entregar o mestre com `sendDocument` e conferir o SHA-256 |
| O artigo inventa fatos de produto | Informação pública incorreta | Exigir fontes aprovadas e marcar dados ausentes como pendência |
| Dois workers atualizam o mesmo trabalho | Estado duplicado ou inválido | Manter o plano de controle como único escritor e usar leases |
| Um processo para depois de uma entrega externa | Entrega duplicada após reinício | Usar chaves de idempotência e reconciliar recibos do provedor |
| Ajustes repetidos aumentam o custo dos modelos | Esgotamento dos créditos | Aplicar orçamento por pedido e perguntar antes de continuar |
| DeepSeek ou Gemini altera a API | Workers quebrados | Manter adaptadores atrás de contratos estáveis |
| Ricardo fica indisponível | Trabalho pendente | Permitir substituto temporário e nunca aprovar automaticamente |
| A Meta recusa a publicação automática | Horário perdido | Manter o arquivo manual e avisar Ricardo imediatamente |

### 5.3 Dependências

- Chave da API da DeepSeek com créditos.
- Projeto da API do Gemini com cobrança ativa para Nano Banana 2.
- Token do bot do Telegram e webhook.
- Telegram ID de Ricardo.
- Chave da API do Linear e etiqueta `Instagram Post`.
- Volume durável para banco e artefatos.
- Fontes aprovadas para afirmações técnicas do blog.

### 5.4 Decisões abertas antes da implementação

- Definir o prazo de retenção dos artefatos locais.
- Confirmar o CMS do blog e o formato esperado para envio.
- Escolher o modelo multimodal usado como diretor de arte.
- Definir os primeiros dez briefs de imagem e dez briefs de blog.
- Definir o teto de custo padrão depois do benchmark.
- Nomear o substituto autorizado de Ricardo.

### 5.5 Regra de liberação

A primeira versão só está pronta quando Ricardo consegue pedir um pacote do
Instagram e um artigo de blog, revisar ambos pelo celular, pedir um ajuste,
aprovar a versão correta e baixar os arquivos finais sem ajuda de um
desenvolvedor.
