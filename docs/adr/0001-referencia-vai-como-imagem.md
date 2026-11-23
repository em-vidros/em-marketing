# A referência vai como imagem e a Biblioteca é a única fonte de estilo

Até novembro de 2026, uma referência subida na Biblioteca chegava ao modelo de imagem só como uma leitura de seis frases, escrita para não descrever o visual. Ela concorria com dois posts fixos de `brand/referencias-posts/` enviados como imagem e com um trio de estilos fixo por pilar. A imagem sempre ganhava, e a equipe via que subir uma referência não mudava nada. Decidimos que a própria imagem da referência vai para o modelo e guia paleta, composição, tipografia e acabamento. Os posts reais da @emvidros entram na Biblioteca como referências comuns, e cada uma das três variações parte de uma referência diferente. Isso substitui o trio por pilar.

## Opções consideradas

- Melhorar só a leitura em texto. Foi descartada porque texto perde para imagem no mesmo prompt, e a leitura foi escrita de propósito para esconder o visual.
- Manter as referências da casa fora da tela, ao lado das da Biblioteca. Foi descartada porque deixaria duas fontes de estilo, e a da equipe seguiria perdendo.

## Consequências

- Quem escolhe as referências escolhe o estilo. Sem escolha da pessoa, entram a mais recente e uma rotação que prefere o pilar do post.
- Os arquivos `styles/*.md` guardam só as regras comuns: formato, área do logo e proibições. Eles não definem mais a cara da arte.
- A referência traz texto e logo pintados, então o prompt continua proibindo copiar os dois.
