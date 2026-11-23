# em-marketing

A fábrica de conteúdo da EM Vidros. O vocabulário do domínio está em [GLOSSARY.md](GLOSSARY.md), e as decisões difíceis de desfazer estão em [docs/adr/](docs/adr/). Use os termos do glossário no código, na interface e nos commits.

Estas regras são padrões. Se uma delas atrapalhar a tarefa, diga qual e espere o Henrique aprovar antes de quebrá-la.

## Dinheiro e dados reais

- Toda geração de imagem gasta crédito pré-pago da OpenAI. Nos testes, use `estudioDeTeste()` de `test/estudio.ts`, cuja IA nunca chama a OpenAI. Chame o modelo de verdade só quando a mudança depender do resultado dele, uma vez, em qualidade `medium`.
- `bun test` roda num PGlite na memória. Aponte `TESTE_DATABASE_URL` só para um banco descartável, nunca para o Neon de produção.

## Verificar

- Enquanto trabalha, rode `bun test <arquivos>`. Antes de commitar, rode `bun run check`.
- Mudança que a pessoa vê na tela precisa de uma passada no app rodando: abra a tela, percorra o fluxo e corrija o que ficar estranho antes de entregar.
- Antes de dar uma tela como pronta, confira as entradas que se aplicam e diga quais conferiu: conversa com o Chefe, conversa direta com o especialista, Biblioteca, editor do estúdio e calendário. Toda entrada tem saída: o que se cria se apaga ou se desfaz, e o desfazer aparece na tela.
- Uma capacidade nova vira uma função de domínio. A tool do bot, a rota da API e o MCP chamam essa mesma função, sem repetir a lógica em cada um.

## Commits e PRs

- Abra PR só quando o Henrique pedir. Um pedido vira um PR.
- Título no formato `tipo(escopo): resultado em português simples`, como `fix(biblioteca): a referência subida chega ao modelo de imagem`. Os tipos são `feat`, `fix`, `perf`, `refactor`, `docs`, `test` e `chore`.
- O corpo diz o problema em uma ou duas frases e depois como foi resolvido.
- PR que muda tela leva imagens de antes e depois. Mudança de movimento leva um vídeo curto. Suba as imagens no GitHub e deixe-as fora do repositório.
- Plano, pesquisa e rascunho de agente ficam fora do repositório.

## Código

- A complexidade fica na borda: rotas, clientes da OpenAI e do Instagram, leitura de arquivo. O domínio fica em funções puras, e a interface só desenha.
- Deixe o TypeScript inferir os tipos e use `unknown` com validação na borda.
- Escreva comentário só para uma restrição, uma esquisitice externa ou uma invariante, em até 4 linhas.
- Use `useEffect` só para sincronizar com algo fora do React. Calcule no render e aja no handler.
- Animação roda uma vez e para, sem repintar a tela em loop.

## Interface

- Componentes de chat e de agente vêm primeiro do registry `@beautifui` (`bunx shadcn add @beautifui/<nome>`): `approval-card`, `tool-chips`, `task-rows`, `prompt-bar`, `chat-composer`, `thinking-state`, `streaming-text`, `loading-state` e `context-cards`. O catálogo completo está em `https://www.beautifului.dev/r/registry.json`.
- Os componentes em `@/shadcn/ui` definem a própria aparência. Componha com eles em vez de sobrescrever as classes.
- Todo texto visível segue o tom do brandbook: português do Brasil, frases curtas, sem ponto de exclamação.
