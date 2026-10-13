# Calendário (pedido de 2026-10-13)

O Henrique pediu uma visão de calendário igual ao Calendário da Apple, para ver o que quer postar e programar postagens, com as animações da Apple.

## Forma dos dados

```ts
type Dia = `${number}-${number}-${number}`;            // AAAA-MM-DD em America/Sao_Paulo

// O que o calendário mostra. Cada tipo vem de uma fonte e tem as próprias regras de edição.
type ItemCalendario =
  | { tipo: "pauta"; id: number; dia: Dia; hora: string | null; titulo: string; pilar: Pilar | null; nota: string; conversaId: string | null }
  | { tipo: "agendado"; filaId: number; postId: number; publicaEm: number; midia: "IMAGE" | "STORIES"; headline: string; pilar: Pilar; capa: string | null; status: "pending" | "publishing" | "failed" }
  | { tipo: "publicado"; publicacaoId: number; postId: number; publicadoEm: number; midia: "IMAGE" | "STORIES"; headline: string; pilar: Pilar; capa: string | null; link: string | null }
  | { tipo: "data"; dia: Dia; nome: string };          // datas do calendário editorial (scheduler/calendar.ts), só leitura
```

- Pauta é nova: a ideia do que postar num dia, antes de existir post. Tabela `pautas`, criada por quem está logado, visível para a equipe como a agenda e a Biblioteca;
- "Criar com o Chefe" numa pauta abre uma conversa com o Chefe já com o pedido escrito e liga a pauta à conversa;
- Arrastar um agendado muda o horário na fila, só enquanto está `pending`. Publicando, publicado ou falho não se arrasta;
- Agendar um post pronto direto do calendário é uma ação humana na tela e vale como aprovação, mas sempre passa por uma confirmação com data, hora e mídia antes de gravar;
- Publicado e datas do calendário editorial são só leitura;
- Toda mudança feita pelo calendário mostra o aviso de Desfazer da pilha única do app.

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
