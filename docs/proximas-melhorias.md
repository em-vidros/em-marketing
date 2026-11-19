# Próximas melhorias

Levantamento de novembro de 2026, feito depois da rodada que trouxe bots criados pela equipe, feriados no calendário, Biblioteca com todas as imagens e a barra de conversas instantânea. A ordem é a que eu seguiria: primeiro o que evita perda de trabalho entre colegas, depois o que poupa cliques no dia a dia.

## Multiplayer

Hoje o app é multiusuário, mas não é multiplayer. Cada pessoa vê as próprias conversas, e o que é da equipe (pautas, artes, fila, datas, bots) só se atualiza quando alguém recarrega ou quando o polling de 60 segundos do calendário passa. Duas pessoas no mesmo item não sabem uma da outra.

### 1. Conversa compartilhada com a equipe

A conversa é a unidade de trabalho, e ela é privada: `conversas.user_id` filtra tudo. Quando a Ana monta um post com o Chefe e quer que o Ricardo dê a palavra final, ele não tem como abrir.

Proposta. Um botão "Compartilhar com a equipe" no menu da conversa grava `conversas.visibilidade = 'equipe'`. A barra ganha a seção "Da equipe" com as conversas compartilhadas por outras pessoas. Quem abre pode ler e continuar a conversa, e cada mensagem mostra o autor. A trava de turno no banco, que entrou nesta rodada, já impede duas pessoas de mandarem mensagem ao mesmo tempo.

### 2. Quem está vendo agora

Uma tabela `presenca (usuario, alvo, visto_em)` atualizada a cada 15 segundos pela tela aberta. A arte, a conversa compartilhada e a pauta mostram os avatares de quem está nelas. Isso combina com o aviso de conflito do editor de arte, que entrou nesta rodada: a pessoa vê que o colega está editando antes de perder a edição, e não só depois.

### 3. Atualização ao vivo em vez de polling

A barra relê as conversas no fim de cada turno, o calendário a cada 60 segundos e a atividade a cada 15. Com o Neon Realtime (ou SSE simples saindo do servidor), uma pauta criada pela Ana aparece no calendário do Ricardo no mesmo segundo, e o selo de "trabalhando" dos bots acompanha o que acontece de fato. Começaria pelo calendário, que é a tela mais compartilhada.

### 4. Pedir aprovação a um colega

O cartão de aprovação de publicar e agendar é sempre respondido por quem pediu. Para a EM Vidros, faz sentido a analista montar e a gerência aprovar. Proposta: no cartão, a opção "Pedir aprovação a..." com a lista da equipe. A pessoa escolhida recebe um aviso na barra e aprova pelo mesmo cartão, que já é assinado pelo servidor.

### 5. Comentários na arte e na pauta

Um fio de comentários por arte e por pauta, com menção a colegas. Hoje o feedback sobre uma arte vai pelo WhatsApp, fora do app, e se perde da peça.

### 6. Rastro do que a equipe fez

Os campos de autor já existem (`criada_por`, `autor` nas versões dos bots, `por` nas chaves). Falta mostrar. A tela de Atividade pode ganhar a aba "Equipe" com o que cada pessoa criou, apagou e publicou. Isso importa porque qualquer login apaga a arte ou o agendamento de um colega; o Desfazer cobre o erro na hora, mas não responde "quem tirou o post de sexta da fila?".

## Bots

### 7. O Chefe delegar aos bots criados pela equipe

Os bots novos conversam direto com as pessoas, mas o Chefe só delega aos cinco especialistas fixos, porque cada delegação é uma tool `delegar_<id>` gerada no código. Gerar essas tools a partir da tabela `bots` deixaria o Chefe chamar, por exemplo, um bot "Vendas" para escrever a oferta de um post.

### 8. Memória com revisão

O bot agora anota na própria memória com a tool `lembrar`. Vale mostrar na conversa um aviso discreto quando ele anota ("Lembrei: a unidade de Bacabal abre aos sábados"), com um botão para desfazer. Sem isso, uma anotação errada fica valendo até alguém abrir a configuração do bot.

### 9. Testar o prompt antes de salvar

Na aba Configuração, um painel "Testar" que manda uma mensagem ao bot com o prompt ainda não salvo, sem criar conversa. Hoje quem mexe no prompt salva, abre uma conversa, testa e volta.

## Biblioteca e artes

### 10. Busca e filtros

A Biblioteca passa a guardar todas as imagens geradas, e em poucos meses serão centenas. Filtro por pilar, formato, bot que gerou, pessoa e período, mais busca pelo tema do brief, que já está salvo em `posts.brief`.

### 11. Marcar como referência direto da Biblioteca

O glossário diz que a biblioteca de referências cresce com as artes aprovadas que alguém marca. Falta o botão "Usar como referência" em cada imagem gerada, que hoje só existe para imagens enviadas.

## Bugs conhecidos que ficaram para depois

- O painel de tarefa faz duas leituras ao abrir (`PainelTarefa.tsx`, `useEffect(recarregar, ...)` na montagem). Não quebra nada, só gasta um pedido.
- Mudar ou apagar uma data que repete todo ano atualiza na hora só o ano que está na tela. Os outros anos corrigem na próxima leitura.
- Uma variação gerada antes desta rodada e sobrescrita por uma regeneração continua perdida. A Biblioteca guarda tudo daqui para a frente.
