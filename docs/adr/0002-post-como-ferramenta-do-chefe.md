# A criação de post é uma ferramenta do Chefe, sem delegar ao Post

Um pedido de post fazia o caminho Chefe, Post, Chefe, Post e Chefe: duas delegações e de seis a dez chamadas de modelo em volta da geração. Isso deixava o fluxo lento e cada etapa podia se perder. As regras que importam já não moravam no prompt do Post. As de texto ficam nos geradores de headline e de legenda, que carregam o brandbook como norma, e a ordem das etapas fica na máquina de estados do post. Decidimos que o Chefe chama `produzir_post`, que roda brief, headline e as três artes em código, escreve a legenda enquanto as imagens renderizam e não para para confirmar o brief. Depois da escolha, o Chefe chama a story direto.

## Opções consideradas

- Dar ao Chefe as ferramentas do Post, uma a uma. Foi descartada porque mantém o mesmo número de voltas de modelo e leva para o Chefe as regras de decisão do Post.
- Manter a delegação e só trocar o modelo do Post por um mais rápido. Foi descartada porque o tempo está nas voltas, não no tamanho do modelo.

## Consequências

- As regras de decisão que viviam no prompt do Post (foto real, estilo pedido e público) passam para o passo do brief dentro da ferramenta.
- O bot Post continua para quem conversa direto com ele. O Chefe não delega mais a criação de post a ele.
