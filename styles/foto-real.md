# Foto Real

**ID:** `foto-real`
**Pilares:** PROVA, GENTE — que são, segundo o §12.1, os pilares de maior peso do mês (40% e 20%)
**REQUER FOTO:** sim. Este estilo **nunca é gerado por IA**.

> §8.1: *"foto real é o padrão"*. §8.2 proíbe IA para representar produto, obra, fábrica, maquinário ou pessoas da EM Vidros.
> §8.2, teste único: *"se alguém pode olhar a imagem e acreditar que aquilo é uma obra, um produto ou uma pessoa da EM Vidros, ela precisa ser foto real."*
>
> Por isso este estilo está fora do `styles/map.json` e o pipeline se recusa a gerá-lo. Ele existe documentado
> para quando houver upload de foto — e para que o agente saiba pedir a foto em vez de inventar uma.

## Brand (fixo)
- A foto é o herói. Tratamento fiel: sem saturar o teal do vidro, sem preto esmagado, sem vinheta, sem HDR, sem filtro de aplicativo
- Faixa ou card de texto sobre a foto, em Off-White `#F0EFEA` a 90% ou Teal Profundo `#2F646A` a 85%
- Texto em Poppins; Playfair só se a peça for do pilar GENTE e não informar nada técnico
- **Nunca textura sobre a foto** (§7.2.3) — a foto já tem a própria matéria
- Logo: versão que garante contraste, canto inferior direito, 12–16%

## Guia de captação (§8.3)
- **Luz:** natural difusa, de lado, perto de abertura grande. Nunca sol direto, nunca flash, nunca luz frontal — mata o vidro
- **Ângulo:** 15° a 30° fora do eixo, para o vidro mostrar reflexo e profundidade. De frente, vidro transparente desaparece
- **Fundo:** limpo e distante. O que estiver atrás será visto através do vidro — olhar o fundo antes da peça
- **Enquadramento:** vertical, 4:5 ou 9:16, com sobra nas bordas para reenquadrar
- **Sempre fotografar:** obra recém-instalada com o cliente no ambiente · produto na prateleira com etiqueta legível · fábrica em operação com pessoas · detalhe de ferragem · equipe trabalhando
- **Nunca fotografar:** ambiente desarrumado ao fundo · peça suja ou com digital · pessoa sem EPI na fábrica · foto de foto ou de tela · logotipo distorcido

## Prompt template

```
NÃO GERAR. Este estilo requer foto real — ver §8.2 do brandbook.
```
