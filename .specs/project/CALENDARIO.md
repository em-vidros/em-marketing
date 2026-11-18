# Calendário (pedido de 2026-10-13)

O Henrique pediu uma visão de calendário igual ao Calendário da Apple, para ver o que quer postar e programar postagens, com as animações da Apple.

## Forma dos dados

Os tipos moram em `src/agent/calendario.ts` (`Dia`, `ItemCalendario` e cada membro) e `src/agent/fila.ts` (`Pronto`, `PedidoDeAgendamento`, `Reagendado`). `Fonte` mora em `src/db/index.ts`. A web importa com `import type`.

```ts
type Dia = `${number}-${number}-${number}`;            // AAAA-MM-DD em America/Sao_Paulo

// O que o calendário mostra. Cada tipo vem de uma fonte e tem as próprias regras de edição.
// De onde sai a publicação: um post do fluxo antigo ou uma arte do estúdio (src/v2).
type Fonte = { tipo: "post"; postId: number } | { tipo: "arte"; arteId: string };

type ItemCalendario =
  | { tipo: "pauta"; id: number; dia: Dia; hora: string | null; titulo: string; pilar: Pilar | null; nota: string; conversaId: string | null }
  | { tipo: "agendado"; filaId: number; fonte: Fonte; publicaEm: number; midia: "IMAGE" | "STORIES"; titulo: string; pilar: Pilar | null; capa: string | null; status: "pending" | "publishing" | "failed"; erro: string | null }
  | { tipo: "publicado"; publicacaoId: number; fonte: Fonte; publicadoEm: number; midia: "IMAGE" | "STORIES"; titulo: string; pilar: Pilar | null; capa: string | null; link: string | null }
  | { tipo: "data"; dia: Dia; nome: string };          // datas do calendário editorial (scheduler/calendar.ts), só leitura
```

`titulo` de post é o headline, ou "Post sem headline (id)" na peça de foto real; de arte é a primeira camada de texto, que é o título impresso nela, ou o pedido quando não há texto. `pilar` vem null em arte e em post sem pilar. A capa de uma arte agendada é o JPEG fixado na fila. `publicaEm` e `publicadoEm` são epoch ms. `conversaId` da pauta só vem para quem é dono da conversa, e só enquanto ela não foi apagada.

- Pauta é nova: a ideia do que postar num dia, antes de existir post. Tabela `pautas`, criada por quem está logado, visível para a equipe como a agenda e a Biblioteca;
- "Criar com o Chefe" numa pauta abre uma conversa com o Chefe já com o pedido escrito e liga a pauta à conversa. Repetir devolve a mesma conversa. A pauta é da equipe e a conversa é de uma pessoa: se outra pessoa clica, ela ganha uma conversa dela e a pauta passa a apontar para a nova;
- Arrastar um agendado muda o horário na fila, só enquanto está `pending` e só para um horário no futuro. Publicando, publicado ou falho não se arrasta. Um falho pode ser dispensado, e o Desfazer devolve ele a falho sem tentar de novo;
- Agendar direto do calendário é uma ação humana na tela e vale como aprovação, mas sempre passa por uma confirmação com data, hora, mídia e a legenda do feed antes de gravar. Post usa a mesma função do `agendar_publicacao` do Chefe (`agendarPost` em `src/agent/fila.ts`): peça escolhida, peça da mídia pedida, horário no futuro e nenhum outro agendamento ativo nem publicação do mesmo post na mesma mídia. Arte do estúdio vai para a mídia do formato (feed é IMAGE, story é STORIES), com a mesma regra de duplicado, e é renderizada em JPEG na hora de agendar: sai o que estava na tela, mesmo que a arte mude depois. A linha da fila guarda o caminho do JPEG e a legenda;
- Cancelar um agendado só vale para `pending`. Restaurar volta para `pending` enquanto o horário não passou, com as mesmas regras de agendar;
- Publicado e datas do calendário editorial são só leitura;
- Toda mudança feita pelo calendário mostra o aviso de Desfazer da pilha única do app.

## API

Todas pedem sessão (401 `{erro}` sem ela). Recusas vêm como `{erro}` em português: 400 para pedido inválido ou horário no passado, 404 para o que não existe, 409 para o estado atual que impede.

| Rota | Corpo | Resposta |
| --- | --- | --- |
| `GET /api/calendario?de=AAAA-MM-DD&ate=AAAA-MM-DD` | | `ItemCalendario[]`, até 62 dias, os dois inclusive, com os dias de São Paulo |
| `POST /api/pautas` | `{dia, titulo, hora?, pilar?, nota?}` | 201 `ItemPauta` |
| `PATCH /api/pautas/:id` | qualquer de `{dia, hora, titulo, pilar, nota}`; `hora` e `pilar` aceitam null | `ItemPauta` |
| `DELETE /api/pautas/:id` | | 204, apaga sem perder (some do calendário) |
| `POST /api/pautas/:id/restaurar` | | `ItemPauta` |
| `POST /api/pautas/:id/conversa` | | `{conversaId, pedido, vazia}`; a tela manda `pedido` como primeira mensagem só quando `vazia` |
| `GET /api/prontos` | | `Pronto[]`: `{fonte, titulo, capa, pilar, midias, legenda}`, artes primeiro, com as mídias que ainda dá para agendar |
| `POST /api/fila` | `{fonte, midia, publicaEm, legenda?}`; sem `legenda`, o feed de um post leva a do post; stories não aceitam legenda | 201 `ItemAgendado` |
| `PATCH /api/fila/:id` | `{publicaEm}` | `{item, anterior}`; desfazer é o mesmo PATCH com `anterior` |
| `DELETE /api/fila/:id` | | 204, status `cancelled`; vale para pendente e para falho |
| `POST /api/fila/:id/restaurar` | | `ItemAgendado` |

`queue.publish_at` continua no formato do SQLite, `AAAA-MM-DD HH:MM:SS` em UTC, porque o tick do scheduler compara o texto com `datetime('now')`. A API recebe e devolve epoch ms e converte na borda.

## Telas e movimento

Referência medida no Calendário do macOS 27 desta máquina: scratchpad/ref-cal/REFERENCIA-CALENDARIO.md. Quando o Mac e o iPad discordam, vale o Mac, porque o pedido é "igual ao Apple Calendar" e o site é usado no computador.

- Mês, semana e dia. O mês tem sempre 6 linhas e rola de forma contínua por semana, com encaixe por mola sem passar do ponto (damping 1, response perto de 0,3 s);
- Trocar de visão e avançar ou voltar é corte seco, como no Mac. Os eventos entram uns 50 ms depois da grade;
- Hoje com círculo vermelho, linha da hora atual vermelha só na coluna de hoje, pílula da hora na coluna de horas;
- Criar pauta com clique duplo ou arrastando num espaço vazio, como no Mac. Clique simples só seleciona ou tira a seleção;
- Arrastar move com encaixe de 15 minutos. O item levanta com escala 1,02 e sombra, segue o ponteiro 1:1 e assenta com mola que herda a velocidade;
- Detalhe num popover ancorado no evento, de escala 0,96 a 1 em 0,2 s a partir da seta;
- Teclas sem ⌘, porque o navegador já usa ⌘T, ⌘N e ⌘1 a ⌘9: T hoje, setas avançam e voltam, 1, 2 e 3 trocam a visão, ⌥ com as setas move o item selecionado 15 minutos ou um dia, Delete apaga pauta, Esc fecha;
- Com movimento reduzido, tudo vira fade de 150 ms.
