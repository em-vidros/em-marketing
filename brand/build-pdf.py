#!/usr/bin/env python3
"""
Monta o PDF do BRANDBOOK.md.

Rota: Markdown -> HTML -> Chrome headless --print-to-pdf.
Chrome mantem o texto como texto (camada de texto real, pesquisavel), ao contrario
de qualquer caminho que passe por rasterizacao.

Uso:  python3 _build-pdf.py
"""
import html as ihtml
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
SRC = HERE / "BRANDBOOK.md"
OUT_HTML = HERE / "_brandbook-print.html"
OUT_PDF = HERE / "EM-Vidros-Brandbook.pdf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


# ---------------------------------------------------------------- inline

def inline(t: str) -> str:
    """Formatacao inline. Escapa HTML primeiro, depois reintroduz as tags nossas."""
    t = ihtml.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"~~([^~]+)~~", r"<s>\1</s>", t)
    t = re.sub(r"(?<![\*\w])\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    return t


def split_row(line: str):
    return [c.strip() for c in line.strip().strip("|").split("|")]


# ---------------------------------------------------------------- blocos

def convert(md: str) -> str:
    lines = md.split("\n")
    out, i = [], 0
    n = len(lines)

    while i < n:
        ln = lines[i]

        # bloco de codigo cercado
        if ln.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append("<pre><code>" + ihtml.escape("\n".join(buf)) + "</code></pre>")
            continue

        # regua
        if ln.strip() == "---":
            out.append('<hr>')
            i += 1
            continue

        # titulos
        m = re.match(r"^(#{1,4})\s+(.*)$", ln)
        if m:
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
            continue

        # tabela: linha com | seguida de separador |---|
        if ln.strip().startswith("|") and i + 1 < n and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            head = split_row(ln)
            i += 2
            body = []
            while i < n and lines[i].strip().startswith("|"):
                body.append(split_row(lines[i]))
                i += 1
            th = "".join(f"<th>{inline(c)}</th>" for c in head)
            trs = "".join(
                "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row) + "</tr>"
                for row in body
            )
            out.append(f'<div class="scroll"><table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>')
            continue

        # citacao (pode ter varias linhas)
        if ln.startswith(">"):
            buf = []
            while i < n and lines[i].startswith(">"):
                buf.append(lines[i].lstrip(">").strip())
                i += 1
            out.append("<blockquote>" + inline(" ".join(buf)) + "</blockquote>")
            continue

        # listas
        if re.match(r"^\s*[-*]\s+", ln) or re.match(r"^\s*\d+\.\s+", ln):
            ordered = bool(re.match(r"^\s*\d+\.\s+", ln))
            tag = "ol" if ordered else "ul"
            items = []
            while i < n and (re.match(r"^\s*[-*]\s+", lines[i]) or re.match(r"^\s*\d+\.\s+", lines[i])):
                txt = re.sub(r"^\s*(?:[-*]|\d+\.)\s+", "", lines[i])
                items.append(f"<li>{inline(txt)}</li>")
                i += 1
            out.append(f"<{tag}>" + "".join(items) + f"</{tag}>")
            continue

        # paragrafo
        if ln.strip():
            buf = [ln]
            i += 1
            while i < n and lines[i].strip() and not re.match(
                r"^(#{1,4}\s|>|\||```|---\s*$|\s*[-*]\s+|\s*\d+\.\s+)", lines[i]
            ):
                buf.append(lines[i])
                i += 1
            out.append("<p>" + inline(" ".join(b.strip() for b in buf)) + "</p>")
            continue

        i += 1

    return "\n".join(out)


CSS = """
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600&display=swap');

@page { size: A4; margin: 18mm 16mm 16mm; }

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: Poppins, "Century Gothic", ui-sans-serif, system-ui, sans-serif;
  font-size: 9.6pt;
  line-height: 1.62;          /* o brandbook exige >= 1,65 na arte; aqui e corpo impresso */
  color: #414141;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Capitulo comeca em pagina nova. O primeiro nao, para nao abrir com pagina vazia. */
h1 {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 25pt; font-weight: 500; line-height: 1.12;
  color: #2F646A; margin: 0 0 14pt;
  padding-bottom: 8pt; border-bottom: 2px solid #63B5AF;
  break-before: page; break-after: avoid;
}
h1:first-of-type { break-before: avoid; }

h2 { font-size: 13pt; font-weight: 600; letter-spacing: -.01em; color: #2F646A;
     margin: 20pt 0 8pt; break-after: avoid; }
h3 { font-size: 10.4pt; font-weight: 600; margin: 14pt 0 5pt; break-after: avoid; }
h4 { font-size: 9.6pt; font-weight: 600; margin: 12pt 0 4pt; break-after: avoid; }

p { margin: 0 0 9.5pt; orphans: 3; widows: 3; }

/* Sem fundo nem padding: um chip com caixa colorida no meio de um paragrafo faz o
   extrator de PDF interpretar cada chip como celula e transformar o paragrafo em
   linha de tabela. A distincao fica por fonte monoespacada e cor. */
code {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: .87em; color: #2F646A;
}
pre {
  background: #F0EFEA; border-left: 2.5pt solid #63B5AF;
  padding: 9pt 11pt; border-radius: 0 3pt 3pt 0;
  overflow: hidden; break-inside: avoid; margin: 0 0 10pt;
}
pre code { background: none; padding: 0; font-size: 7.6pt; line-height: 1.5; color: #414141; }

/* A extracao de PDF infere o cabecalho pelo PESO VISUAL, nao pela tag <th>.
   Cabecalho fraco (cinza claro, 7pt) faz o extrator eleger o paragrafo acima
   como cabecalho e descartar a linha real. Por isso o <th> aqui e escuro,
   maior que o corpo da tabela e com fundo — e a tabela ganha respiro em cima. */
/* Fronteira visual explicita: sem respiro e sem moldura, o extrator agrupa a prosa
   vizinha dentro da tabela e devolve linhas com paragrafos inteiros nas celulas. */
table { border-collapse: collapse; width: 100%; margin: 13pt 0 14pt; font-size: 8.5pt;
        border: .5pt solid #D8D5CE; }
/* Linhas altas o bastante para o extrator agrupar por LINHA e nao por coluna.
   Com padding apertado ele transpoe: junta todos os niveis numa celula e todos
   os tamanhos noutra, destruindo a correspondencia. */
th, td { text-align: left; padding: 7.5pt 8pt; border-bottom: .5pt solid #D8D5CE;
         vertical-align: top; line-height: 1.45; }
th { font-size: 9pt; font-weight: 600; color: #2F646A; background: #F0EFEA;
     border-bottom: 1pt solid #63B5AF; }
tr { break-inside: avoid; }

blockquote {
  margin: 0 0 10pt; padding: 8pt 12pt;
  background: #F0EFEA; border-left: 2.5pt solid #2F646A;
  border-radius: 0 3pt 3pt 0; break-inside: avoid;
}
blockquote p:last-child { margin-bottom: 0; }

ul, ol { margin: 0 0 9pt; padding-left: 15pt; }
li { margin-bottom: 2.5pt; }

hr { border: none; border-top: .5pt solid #D8D5CE; margin: 14pt 0; }
h1 + hr, hr + h1 { display: none; }

s { color: #8A8A8A; }
a { color: #2F646A; }

/* Capa */
.capa { break-after: page; padding-top: 58mm; text-align: left; }
.capa .marca { width: 62mm; margin-bottom: 22mm; }
.capa h1 { font-size: 42pt; border: none; padding: 0; margin: 0 0 6pt; break-before: avoid; }
.capa .sub { font-size: 13pt; color: #414141; font-weight: 300; margin-bottom: 26mm; }
.capa .meta { font-size: 8.4pt; color: #8A8A8A; line-height: 1.9;
              border-top: .5pt solid #D8D5CE; padding-top: 8pt; }
.capa .tag { font-family: 'Playfair Display', Georgia, serif; font-size: 17pt;
             color: #63B5AF; margin-bottom: 4mm; }
"""


def main():
    if not SRC.exists():
        sys.exit(f"nao encontrei {SRC}")

    md = SRC.read_text(encoding="utf-8")

    # A capa substitui o cabecalho solto do topo do arquivo.
    md = re.sub(r"\A# EM Vidros — Brandbook\s*\n+\*\*Direção 2026\*\*[^\n]*\n", "", md)

    logo = (HERE / "assets/logo/emvidros-oficial.svg").resolve().as_uri()

    capa = f"""<div class="capa">
  <img class="marca" src="{logo}" alt="EM Vidros">
  <div class="tag">Imagine EM Vidro</div>
  <h1>Brandbook</h1>
  <div class="sub">Direção 2026</div>
  <div class="meta">
    Versão 1.0 · agosto de 2026<br>
    Documento normativo · uso interno<br>
    Fonte da verdade: <code>BRANDBOOK.md</code>
  </div>
</div>"""

    doc = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>EM Vidros — Brandbook · Direção 2026</title>
<style>{CSS}</style></head>
<body>{capa}
{convert(md)}
</body></html>"""

    OUT_HTML.write_text(doc, encoding="utf-8")
    print(f"html: {OUT_HTML.name}")

    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
         "--virtual-time-budget=20000",          # espera as webfonts baixarem
         f"--print-to-pdf={OUT_PDF}", OUT_HTML.as_uri()],
        check=True, capture_output=True,
    )
    print(f"pdf:  {OUT_PDF.name}  ({OUT_PDF.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
