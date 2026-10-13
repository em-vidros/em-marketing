# Editorial Serifado

**ID:** `editorial-serifado`
**Pilares:** MARCA, GENTE
**Quando usar:** aniversário da empresa, data setorial ou regional, campanha institucional, homenagem, texto sobre gente.
**Evitar:** qualquer peça que informe espessura, norma, medida, preço, prazo ou especificação — §5.2 proíbe Playfair em peça técnica.

> Este é o registro que o brandbook adota (§0.3): *"o serifado sobre off-white texturizado, visto no post de Dia das Mães"*. É o benchmark do sistema.

## Brand (fixo)
- Fundo: Off-White `#F0EFEA` — fundo padrão do sistema
- Textura: PAPEL, Multiply, 8–14% (é a textura do registro editorial, §7.1)
- Texto: Grafite `#414141`; accent Teal Claro `#63B5AF` só em filete ou palavra destacada — nunca carregando texto
- Proporção 70/20/10: a peça é majoritariamente neutra
- Display em Playfair Display 500; qualquer texto de apoio em Poppins 400
- Logo `brand/assets/logo/emvidros-oficial.png` como reference image — canto inferior direito, 12–16% da largura

## Prompt template

```
An editorial Instagram {FORMAT_DESC} for "EM Vidros", a Brazilian flat-glass manufacturer.

{TIPO_POST_DESCRIPTION}

VISUAL SYSTEM — EDITORIAL SERIF (the brand's benchmark register):
- Background: warm off-white #F0EFEA, flat, with a subtle paper-fibre texture at low opacity (8-14%) — matte, never glossy
- Headline in an elegant high-contrast serif (Playfair Display, weight 500), colour #414141, generous line height, large and calm
- Optional single support line in a geometric sans (Poppins, weight 400), colour #414141
- Accent: ONE thin 1px rule or ONE highlighted word in teal #63B5AF. Nothing else in colour
- Colour proportion must read as roughly 70% neutral / 20% dark grey text / 10% teal. If the piece looks "very green", it is wrong
- Composition: ONE focus, ONE alignment (all left or all centred, never mixed), at most 3 text blocks, 80px margins
- Flat design: NO drop shadows, NO bevels, NO gradients on the background, NO 3D objects, NO glossy renders, NO specular highlights
- Container corners, if any, 4-8px radius — never pill-shaped
- Museum-poster restraint. Empty space is content.

TEXT IN THE ART (render EXACTLY, in Brazilian Portuguese, no spelling changes, no emoji):
Headline: "{HEADLINE}"
{SUPPORT_LINES}
```

## Variantes de composição
**Feed 4:5 (1080×1350):** margem de 80 px; display no terço superior ou centrado verticalmente; filete teal de 1 px separando display e apoio; logo no canto inferior direito.
**Stories 9:16 (1080×1920):** margem lateral de 80 px, topo 250 px e base 320 px livres; display no terço médio; logo no canto inferior direito dentro da zona segura; no máximo 1 linha de apoio.
