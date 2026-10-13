# Calendário editorial recorrente

Seeds do scheduler (US-7): o bot manda um brief pronto **3 dias antes** de cada data. Aceitar entra no fluxo normal a partir da escolha de formato; ignorar não faz nada.

A fonte de verdade executável é `src/scheduler/calendar.ts`. Esta tabela espelha o que está lá.

## A trava (§12.4)

> Uma data só entra se passar em um destes três testes: **(a)** é do setor; **(b)** é da região onde há unidade; **(c)** é da empresa.
> **"Data que não passa em nenhum dos três não vira post. Sem Dia do Sorvete, sem Dia do Abraço."**

Data comemorativa é no máximo **15% do mês** e vive inteira no pilar **MARCA** — que, pelo §10.3, **não leva CTA**.

## Datas semeadas

| Data | Ocasião | Teste | Por quê |
|---|---|---|---|
| 15/02 | Aniversário da EM Vidros | (c) empresa | abertura do CNPJ 17.587.823, matriz Raposa-MA |
| 23/04 | Dia do Serralheiro | (a) setor | público primário; nomeada no §12.4 |
| 01/05 | Início do Mês do Vidraceiro | (a) setor | campanha do setor para o público primário |
| 18/05 | Dia do Vidraceiro | (a) setor | público primário nº 1; nomeada no §12.4 |
| 16/07 | Aniversário de Imperatriz | (b) região | unidade e segunda fábrica em Imperatriz-MA |
| 16/08 | Aniversário de Teresina | (b) região | filial em Teresina-PI |
| 08/09 | Aniversário de São Luís | (b) região | duas filiais em São Luís-MA (Angelim e Guajajaras) |
| 15/12 | Dia do Arquiteto | (a) setor | arquiteto e projetista são público primário (§1.2) |

## Removidas — reprovam nos três testes

Estavam na versão anterior deste arquivo e no `FIXED[]` do scheduler, fazendo o sistema **gerar proativamente posts que a própria norma proíbe**:

| Data | Por que sai |
|---|---|
| 08/03 Dia das Mulheres | não é do setor, nem de cidade com unidade, nem da empresa |
| Sexta-feira Santa / Páscoa | idem |
| 21/04 Tiradentes | idem |
| 01/05 Dia do Trabalho | idem (o que fica em 01/05 é o Mês do Vidraceiro) |
| Janeiro Branco | idem |
| Dia das Mães | idem — **ver pendência abaixo** |

## Pendências

1. **Dia das Mães.** A peça de Dia das Mães é o benchmark estético do brandbook inteiro (§0.3) e aparece no banco de legendas. Mas a data não passa em nenhum dos três testes do §12.4. A regra, como está escrita, a exclui. Decisão do dono da marca: abrir exceção nominal no §12.4 ou aceitar a saída.
2. **Aniversários de cidade faltando.** Raposa-MA, Santa Inês-MA, Bacabal-MA e Ananindeua-PA têm unidade e portanto passam no teste (b), mas as datas não foram confirmadas e não foram semeadas. Confirmar e adicionar.
3. **Ano de fundação.** O §1.1 diz "fundada em 2014" e o banco de legendas do §10.4 diz "onze anos"; o CNPJ 17.587.823 foi aberto em 15/02/2013 e o repo anterior dizia "11 anos em 2026". As três contas não fecham. Resolver antes do próximo post de aniversário.
4. **Padroeiros.** O §12.4 aceita padroeiro de cidade com unidade no teste (b). Nenhum foi semeado.
