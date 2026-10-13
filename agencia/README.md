# Agência

O em-marketing visto como agência interna da EM Vidros: três times, cada um
com agentes próprios, todos atendendo projetos. Agente aqui é um papel com
escopo, ferramenta e canal. Hoje quase tudo vive num bot só
(`@em_marketing_bot`) e os papéis correspondem às tools do cérebro
(`src/brain/`). Quando um papel ganhar processo ou código próprio, já tem
casa.

| Time | Escopo | Projetos hoje |
|---|---|---|
| [Marketing](marketing/) | criação: arte, texto, marca | posts do Instagram @emvidros |
| [Operações](operacoes/) | publicação, agenda, registro, infra | scheduler, CI/CD, Linear |
| [Vendas](vendas/) | campanhas de receita | Mês do Vidraceiro, sorteios (via fluxo do marketing) |

## Como a agência trabalha

Do pedido no Telegram ao arquivo no Linear:

```
social media (brief) → designer (3 artes) → redator (legenda, só Feed)
→ aprovação no Telegram → arquivista (Linear) → publicador (Instagram)
```

Cada etapa tem um agente descrito na pasta do seu time.

## Para criar um agente

1. Escolha o time e crie `agentes/<nome>.md` dentro dele
2. Descreva papel, ferramenta (tool do cérebro, módulo ou bot futuro),
   projetos atendidos e canal
3. Só marque `Status: implementado` quando existir tool ou módulo
   correspondente no código

Regra de fronteira: esta pasta organiza, não duplica. Brandbook em `brand/`,
requisitos em `docs/prd.md`, estado do projeto em `.specs/`.
