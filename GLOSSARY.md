# em-marketing

Fábrica de conteúdo da EM Vidros: a equipe pede uma peça em linguagem natural, os bots criam as artes e a legenda dentro da marca, e a pessoa ajusta, aprova e baixa.

## Bots

**Chefe**:
O bot que recebe todo pedido, divide em partes, entrega cada parte a um especialista e junta o resultado. Não cria arte nem escreve legenda.
_Evite_: orquestrador, agente principal

**Especialista**:
Um dos bots de papel fixo (Post, Legenda, Agenda, Fotos, Reels) que executa uma parte do trabalho e também atende conversa direta.
_Evite_: subagente, worker

**Bot criado**:
Um bot que alguém da equipe criou pela tela, com prompt, regras e ferramentas próprios. Só atende conversa direta: o Chefe não delega a ele.
_Evite_: bot customizado, agente

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
Uma parte de um pedido que o Chefe entregou a um especialista, com a própria conversa e um status.
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

**Variação**:
Uma das três artes que um pedido gera para a pessoa escolher.
_Evite_: opção, versão

**Formato**:
O tamanho de publicação de uma arte: feed (1080×1350) ou story (1080×1920).
_Evite_: proporção, tamanho

**Pilar**:
A categoria editorial do brandbook (§12.1) que todo post declara: PROVA, AUTORIDADE, GENTE ou MARCA.
_Evite_: tema, categoria

## Referências

**Referência**:
Uma arte da EM Vidros que a equipe considera bem pensada e que ensina aos bots os princípios a seguir, nunca o visual a copiar.
_Evite_: inspiração, modelo, template

**Leitura**:
O texto curto que descreve os princípios de uma referência, como o par de fontes, o tipo de ilustração e a composição. Um bot escreve e qualquer pessoa pode corrigir.
_Evite_: análise, descrição, prompt

**Biblioteca de referências**:
O conjunto único de referências da empresa, compartilhado por todos, que cresce com as artes aprovadas que alguém marca como referência.
_Evite_: galeria, moodboard
