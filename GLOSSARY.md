# em-marketing

Fábrica de conteúdo da EM Vidros: a equipe pede uma peça em linguagem natural, os bots criam as artes e a legenda dentro da marca, e a pessoa ajusta, aprova e baixa.

## Bots

**Chefe**:
O bot que recebe todo pedido, divide em partes, entrega cada parte a um especialista ou a um bot criado e junta o resultado. Também cria, edita e remove bots criados quando alguém pede. Não cria posts nem escreve legenda, mas cria convite e arte de aniversário direto, porque o texto entra por código.
_Evite_: orquestrador, agente principal

**Especialista**:
Um dos bots de papel fixo (Post, Legenda, Agenda, Fotos, Reels) que executa uma parte do trabalho e também atende conversa direta.
_Evite_: subagente, worker

**Bot criado**:
Um bot de qualquer setor que alguém da equipe criou, pela tela ou pedindo ao Chefe, com prompt e regras próprios e as ferramentas livres. Atende conversa direta e recebe tarefas do Chefe.
_Evite_: bot customizado, agente

**Ferramentas livres**:
As ferramentas que todo bot criado recebe: pesquisa na web, leitura de página e as de marketing. Ele usa só as que servem ao papel e ao setor dele.
_Evite_: tools padrão, permissões

**Marca**:
O brandbook de conteúdo que entra no prompt de um bot quando está ligado. Nasce ligado só nos bots de Marketing.
_Evite_: contexto de marca, brand

**Setor**:
O grupo de um bot na barra lateral, como Marketing ou Comercial. Texto livre; os bots fixos começam em Marketing.
_Evite_: time, categoria

**Memória**:
O texto que um bot recebe em toda conversa, o mesmo para a equipe toda. Qualquer pessoa edita, e o próprio bot acrescenta notas quando alguém pede para ele lembrar.
_Evite_: contexto, histórico

**Conversa**:
Uma troca contínua entre uma pessoa e um bot. Cada bot tem uma conversa atual por pessoa, e a pessoa pode abrir uma nova a qualquer momento.
_Evite_: chat, thread, sessão

**Tarefa**:
Uma parte de um pedido que o Chefe entregou a um especialista ou a um bot criado, com a própria conversa e um status.
_Evite_: job, delegação

## Peças

**Arte**:
A peça visual pronta para publicar, formada por uma cena e pelas camadas editáveis por cima dela.
_Evite_: imagem, post, criativo

**Cena**:
A imagem que o modelo gera para o fundo de uma arte, sem texto e sem logo.
_Evite_: background, imagem gerada

**Camada**:
Um elemento editável da arte, como um texto ou o logo, que a pessoa muda no editor como no Canva.
_Evite_: layer, overlay

**Tipo de arte**:
Uma arte de estúdio com campos fixos, como o convite (título, evento, data, hora, local e observação) e o aniversário (nome, mensagem e foto). O modelo de imagem gera só a cena, e cada campo entra por código como camada, com o texto exatamente como a pessoa escreveu. Campo vazio não aparece na arte.
_Evite_: modelo, template, formulário

**Variação**:
Uma das três artes que um pedido gera para a pessoa escolher.
_Evite_: opção, versão

**Ajuste**:
Uma mudança que a pessoa pede numa arte já escolhida, como trocar o título, e que altera só aquela arte, sem gerar três novas. A pessoa pede à IA ou faz no editor, como preferir.
_Evite_: refação, nova geração

**Formato**:
O tamanho de publicação de uma arte: feed (1080×1350) ou story (1080×1920).
_Evite_: proporção, tamanho

**Biblioteca**:
A tela onde fica tudo o que foi gerado: toda variação de toda geração, inclusive as que ninguém escolheu, as versões story e as artes do estúdio. Cada imagem abre no editor ou é baixada dali. A mesma tela guarda as referências e as peças prontas.
_Evite_: galeria, tela de artes

**Pilar**:
A categoria editorial do brandbook (§12.1) que todo post declara: PROVA, AUTORIDADE, GENTE ou MARCA.
_Evite_: tema, categoria

**Público**:
Quem o post quer alcançar: vidraceiro, arquiteto ou consumidor. Arquiteto e consumidor são levados a uma vidraçaria parceira, nunca a falar com a EM Vidros.
_Evite_: persona, audiência

**Peça pronta**:
Uma imagem que a equipe sobe já finalizada, como um convite, para publicar como está, sem geração. O Chefe agenda e publica igual a uma arte, com o mesmo cartão de aprovação. Quem sobe escolhe entre referência e peça pronta, e uma nunca vira a outra. Ao receber, a IA lê o texto pintado, o tema e o pilar, e o Chefe acha a peça por essa leitura. A legenda sai do mesmo gerador dos posts.
_Evite_: imagem pronta, arte pronta, upload

## Referências

**Referência**:
Uma imagem que a equipe sobe ou marca para guiar o visual das artes: paleta, composição, tipografia e acabamento. O modelo de imagem vê a própria referência, não uma descrição dela, e nunca copia o texto ou o logo.
_Evite_: inspiração, modelo, template

**Leitura**:
O texto curto que descreve o que uma referência ensina, como o par de fontes, o tipo de ilustração e a composição. Um bot escreve e qualquer pessoa pode corrigir.
_Evite_: análise, descrição, prompt

**Imagem do pedido**:
Uma imagem que a pessoa cola, anexa ou solta no chat junto de um pedido. Guia só a próxima geração de artes e entra na Biblioteca de referências só quando alguém guarda.
_Evite_: anexo, upload, imagem colada

**Biblioteca de referências**:
O conjunto único de referências da empresa, compartilhado por todos. Começa com os posts reais da @emvidros e cresce com o que a equipe sobe ou marca.
_Evite_: galeria, moodboard

## Custo

**Custo**:
O valor em US$ de uma chamada às APIs de IA, pela tabela de preços do app, gravado no momento da chamada. O custo de um post soma tudo o que a conversa gastou enquanto ele estava em andamento.
_Evite_: gasto da OpenAI, fatura

**Crédito estimado**:
O último saldo que a equipe informou do painel da OpenAI, mais os depósitos depois dele, menos o custo medido desde então. A OpenAI não deixa o app ler o saldo de verdade; informar o saldo de novo corrige a diferença.
_Evite_: saldo real, crédito disponível
