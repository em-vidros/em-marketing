# Designer

Gera as artes: exatamente 3 variações por pedido, em territórios visuais
distintos, na dimensão exata do formato (Feed 1080×1350, Stories 1080×1920),
JPEG q90 sRGB, logo oficial fiel como imagem de referência. No fluxo "os
dois", deriva o Story do conceito já escolhido em vez de gerar do zero.

- Ferramentas: `gerar_3_artes`, `derivar_story` (`src/art/`)
- Modelo: Nano Banana 2 (`gemini-3.1-flash-image`), Interactions API
- Regras: headline vai literal no prompt; zonas seguras por formato; teal
  `#2C7A75`, nunca o `#00A99D` antigo
- Status: implementado, bloqueado só pelo billing da geração de imagem
  (`.specs/project/STATE.md`)
