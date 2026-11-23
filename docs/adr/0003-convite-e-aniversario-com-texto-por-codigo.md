# Convite e aniversário saem do estúdio com o texto por código

Um convite com nome de evento, data, hora e endereço, ou a arte de aniversário de um colaborador, dependia do modelo de imagem pintar cada palavra, e ele errava letra, número e endereço. Decidimos que esses dois tipos nascem no estúdio de camadas: o modelo gera só a cena, e cada campo vira uma camada de texto com as palavras da pessoa, no brandbook, com o logo na área da marca. O planejador da cena recebe só o tema, nunca nome, data nem endereço.

## Opções consideradas

- Pedir o texto ao modelo de imagem com um prompt mais rígido. Foi descartada porque nenhum prompt garante a grafia, e um convite com a data errada não se corrige com "tentar de novo".
- Montar o convite com a rota de peça pronta, subindo uma imagem feita fora. Foi descartada porque tira o convite do editor e deixa a equipe sem ajuste de texto.

## Consequências

- A criação passa por uma função de domínio, `criarArteComCampos`, que a tool do Chefe e do Post e a rota `POST /api/artes` chamam. O MCP não ganha a capacidade porque é só de leitura.
- O Chefe cria convite e aniversário direto, sem delegar ao Post e sem escolha entre três variações. Uma delegação não mostra o cartão da arte na conversa.
- Apagar uma arte devolve a linha inteira, e `POST /api/artes/:id/restaurar` a recoloca. Uma arte agendada ou publicada não se apaga.
