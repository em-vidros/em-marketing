# Plano de execução — agência multiagente

Spec: `docs/prd-agencia-multiagente.md`. Este arquivo só sequencia a entrega. Não
duplica requisito.

## Predicado de pronto da Fase 1

O PRD §5.1 "Fundação do MVP" define três provas. São elas que fecham a fase, e as
três rodam sem nenhuma chave de API.

1. Um fluxo simulado sobrevive a uma reinicialização em cada estado.
2. Uma aprovação vencida não aprova um artefato novo.
3. Executar a mesma entrega duas vezes cria exatamente um documento no Telegram.

## Por que a fundação vem antes dos agentes

O PRD §5.1 põe "Fundação do MVP" antes de "MVP Instagram". A ordem é dele, não
nossa. O modelo de domínio e as máquinas de estado são porta de mão única, e todo
worker se apoia neles. Trocar isso depois custa reescrever os quatro agentes.

Vale ainda uma segunda razão, específica do momento. Não há chave da DeepSeek e o
projeto Gemini está sem billing para o modelo de imagem (`.specs/project/STATE.md`
§ Bloqueios). A fundação é justamente a parte que se prova inteira sem rede. Os
workers, que precisam das chaves, entram depois, com o encaixe pronto.

## Fases

| Fase | Escopo | Prova |
|---|---|---|
| 1. Fundação | Domínio, máquinas de estado, plano de controle, filas com lease, artefatos imutáveis, aprovação versionada | Os três predicados acima |
| 2. MVP Instagram | Diretor criativo, redator, designer, diretor de arte; três direções; ajuste e recusa; PNG mestre | Benchmark de dez temas; pedido real do Ricardo pelo celular |
| 3. Fábrica visível | Site da fábrica no servidor, canvas infinito com as etapas, inspetor de etapa, atividade ao vivo, só leitura, aberto pela Tailscale | As quatro provas do PRD §5.1 "Fábrica visível" |
| 4. MVP blog | Três ângulos, artigo, revisão, entrega `.md` e `.txt` | Benchmark de dez temas de blog |

## Por que a fábrica visível vem antes do blog

Decidido em 15/09/2026. O produto passou a ser a fábrica de conteúdo da agência
interna, e a fábrica precisa ser vista trabalhando (PRD §1.2 e US-10). O gate da
Fase 2 continua preso em coisa de fora do código, a chave da DeepSeek, o billing do
Gemini e o Telegram ID do Ricardo. O blog depende da mesma chave. O site não. Ele
lê o que o plano de controle já grava, então se prova inteiro no perfil `ensaio`,
sem chave de modelo. Desenho em `.specs/features/fabrica/DESIGN.md`.

Fases v1.1 em diante seguem o PRD §5.1 sem alteração.

## Decisões abertas que assumimos como default

O PRD §5.4 deixa seis decisões em aberto. Três tocam a Fase 1 e vão com um default
declarado, para não travar a entrega. Ricardo ou Henrique sobrescrevem quando
quiserem.

- **Aprovador.** Vem de variável de ambiente, não do código. Sem o ID configurado,
  nada é aprovável, e essa é a falha segura.
- **Retenção de artefato local.** Nenhuma limpeza automática na Fase 1. O
  reconciliador não apaga nada. Definir o prazo antes da Fase 2.
- **Diretor de arte multimodal.** Segue `gemini-3.6-flash`, que é o que o juiz
  atual já usa e está validado contra a rubrica do §3.4 do PRD antigo.

## Divergências encontradas no PRD

- **Fuso.** O código atual fixa `America/Sao_Paulo` (`src/brain/index.ts`), o PRD
  §4.10 diz `America/Fortaleza`. Os dois são UTC-3 sem horário de verão, então o
  instante não muda. `America/Fortaleza` é o certo para MA e PI, e o Pará é
  `America/Belem`, também UTC-3. Adotar `America/Fortaleza` e corrigir o código.
- **Entrega idempotente.** O §5.1 escreve "Executar a mesma entrega duas vezes cria
  um documento no Telegram". Lido como exatamente um, que é o que o §4.6 pede.
