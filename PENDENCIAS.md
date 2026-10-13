# Pendências abertas

Decisões que precisam de um humano. Registradas com data para não virarem folclore — o mesmo espírito do capítulo 17 do brandbook.

Abertas em **2026-08-11**, no commit que reconciliou o `brand/` do repo com o brandbook canônico.

---

## 1. Dia das Mães — a regra exclui o benchmark

A peça de Dia das Mães é o **benchmark estético do brandbook inteiro** (§0.3: *"o registro que já funciona — e que este brandbook adota — é o serifado sobre off-white texturizado, visto no post de Dia das Mães"*) e está no banco de legendas do §10.4.

Mas a data não passa em nenhum dos três testes do §12.4: não é do setor, não é de cidade com unidade, não é da empresa. A regra, como escrita, a exclui — e por isso ela saiu de `src/domain/scheduler/calendar.ts`.

**Decisão:** abrir exceção nominal no §12.4, ou aceitar a saída.

## 2. O gancho de 8 palavras se contradiz

O §10.1 crava *"1 linha · máx. 8 palavras"*. Mas os exemplos marcados como **certos** no §10.2 e o banco de legendas do §10.4 têm 9 e 10 palavras:

- *"O temperado quebra em grãos. O comum, em lâminas."* — 9
- *"Box pronto para levar hoje, em 6 lojas."* — 9
- *"Chegou na prateleira: box em temperado 8 mm, tamanhos padronizados."* — 10

Por isso o validador trata isso como **aviso**, não erro (`src/domain/brand/validate.ts`). Se fosse erro, ele reprovaria os próprios exemplares da norma.

**Decisão:** afrouxar o §10.1 para "aproximadamente 8 palavras / uma linha", ou reescrever os exemplos.

## 3. Data religiosa: §12.2 e §12.4 discordam

O §12.2 diz que entra em MARCA a *"data cívica e religiosa relevante para a região"*. O §12.4 é mais estreito: o teste (b) é *"aniversário de cidade, padroeiro"*.

Páscoa e Sexta-feira Santa passam pelo §12.2 e reprovam no §12.4. Foram removidas seguindo o §12.4, que é a trava explícita.

**Decisão:** alinhar os dois parágrafos.

## 4. Aniversários de cidade faltando

Raposa-MA, Santa Inês-MA, Bacabal-MA e Ananindeua-PA têm unidade e portanto passam no teste (b) do §12.4. As datas **não foram confirmadas** e por isso não foram semeadas — inventar seria pior que faltar.

**Decisão:** confirmar as quatro datas e adicionar em `src/domain/scheduler/calendar.ts`.

## 5. O ano de fundação não fecha

Três fontes, três respostas:

| Fonte | Diz |
|---|---|
| Brandbook §1.1 | "fundada em 2014" |
| Brandbook §10.4 (banco de legendas) | "Onze anos de EM Vidros" |
| CNPJ 17.587.823 (matriz Raposa) | aberto em 15/02/2013 |

Em 2026, 2013 dá 13 anos e 2014 dá 12 — nenhum dá 11.

**Decisão:** cravar o ano antes do próximo post de aniversário.

## 6. Quantas unidades são

O brandbook §1.1 e o §9.4 dizem **seis filiais**. O levantamento do Google Business encontrou **oito perfis** (Angelim, Guajajaras, Imperatriz, Raposa, Teresina, Bacabal, Santa Inês, Ananindeua). O §9.4 manda escrever literalmente *"Seis filiais no Maranhão, Pará e Piauí"* como substituição de "somos referência" — se forem oito, essa frase modelo está errada.

Existem também **dois grupos de CNPJ**: 17.587.823 (matriz Raposa, 2013) e 50.839.549 (EM Vidros Imperatriz, 2023).

**Decisão:** definir o número e corrigir o §9.4, a bio do Instagram e o site.

## 7. O sistema automatiza o formato que o diagnóstico condena

O §0.1 mediu: feed estático engaja **0,18%** (14 likes em 7.860 seguidores) contra **12.129 views médias** de Reel. A decisão D1 é 60% do mês em vídeo vertical.

Este repositório produz **exclusivamente peça estática**. `status_do_mes` já reporta o buraco, mas não o resolve.

**Decisão:** ver a proposta F16 (apoio a Reel: pauta, roteiro, capa desenhada, legenda queimada) na conversa de escopo da agência.

## 8. Peso do Poppins e a serifada definitiva

Herdadas do §17 do brandbook, itens 8 e 9: o peso de display do Poppins (600 ou 700) não foi decidido, e Playfair Display foi cravada por estar no Canva e casar com o post benchmark, **sem ter sido comparada contra o display real daquele post**. A auditoria privada avisa explicitamente que a medição de haste não serve para decidir entre 600 e 700.

`brand/tokens.json` usa **600** e Playfair, seguindo o texto do brandbook.

## 9. Limiares do gate visual não foram calibrados

`src/domain/art/validate.ts` reprova arte por medição de cor. Os limiares em `LIMIARES`
— 3% de matiz fora da paleta vira erro, 25% de teal vira aviso, desvio de
luminância 18 acusa zona segura ocupada — foram deduzidos da paleta e testados
contra imagens sintéticas.

**Nenhuma arte real existe ainda**: o gate da F1 continua travado no billing do
modelo de imagem. Textura, grão e antialiasing de uma peça de verdade deslocam
esses números, e um gate que grita lobo é pior que gate nenhum.

**Decisão:** rever os limiares contra o primeiro lote real antes de tratar o
"erro" de paleta como bloqueio.

## 10. Achado de segurança fora de escopo

Registrado no PRD §4.7 e ainda aberto: um bot token do Telegram está em texto plano em `~/code/personal/pai/claude-ricardo/Scheduled/*/SKILL.md`. **Rotacionar.**
