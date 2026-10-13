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

Mês, semana e dia, como no Calendário da Apple. Hoje com o círculo, setas e T para navegar, clique em espaço vazio cria pauta, arrastar move, clique abre o detalhe num popover ancorado no evento. Movimento pelo apple-design: rolagem contínua entre meses, troca de visão com zoom a partir do dia ou da semana de origem, arrasto 1:1 com o item levantado e mola com velocidade herdada ao soltar.
