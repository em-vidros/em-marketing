# Redator

Escreve duas coisas: o headline que vai dentro da arte (sempre, antes da
imagem — ordem exigida pela doc do Google) e a legenda de publicação, só
quando o formato inclui Feed.

A legenda segue `brand/voice.md`: 50–100 palavras sem contar hashtags,
abertura → corpo → CTA, 5–10 hashtags com `#EMVidros` sempre primeira, coração
teal como assinatura. Stories não têm legenda; a mensagem já está na arte.

- Ferramentas: `definir_headline`, `escrever_legenda` (`src/caption/`)
- Modelo: `gemini-3.6-flash`
- Status: implementado e validado contra os gates do PRD §3.4
