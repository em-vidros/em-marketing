#!/usr/bin/env python3
"""
Monta os cards auto-contidos do brandbook.

Cada fonte vive em cards/src/<nome>.html e contem apenas:
    <!-- @dsCard group="Grupo" title="Titulo" -->
    ...corpo html...

Este script embute _base.css inline e escreve cards/<nome>.html.
Rodar sempre que editar um fragmento:  python3 _build.py
"""
import pathlib, re, sys

HERE = pathlib.Path(__file__).parent
CSS = (HERE / "_base.css").read_text(encoding="utf-8")

# O @import de fonte precisa ficar no topo do <style>, entao o separamos do resto.
# Casar a LINHA inteira: a URL do Google Fonts tem ";" nos pesos (wght@300;400;...),
# entao um padrao do tipo [^;]+ truncaria o import e quebraria o CSS seguinte.
imports = "\n".join(re.findall(r"^@import .*$", CSS, re.M))
body_css = re.sub(r"^@import .*\n", "", CSS, flags=re.M)

# O painel do Claude Design rotula o card pelo NOME DO ARQUIVO; um atributo
# name="..." no marcador nao e honrado (testado em 05/08/2026). Por isso os
# arquivos usam nomes ja legiveis, com prefixo numerico para manter a ordem.
TPL = """<!-- @dsCard group="{group}" -->
<meta charset="utf-8">
<title>{title} — EM Vidros</title>
<style>
{imports}
{css}
</style>
<div class="wrap">
{body}
</div>
"""


def build():
    src = HERE / "src"
    if not src.is_dir():
        sys.exit("cards/src/ nao encontrado")
    n = 0
    for f in sorted(src.glob("*.html")):
        raw = f.read_text(encoding="utf-8")
        m = re.match(r"\s*<!--\s*@dsCard\s+(.*?)-->\s*", raw, re.S)
        if not m:
            sys.exit(f"{f.name}: falta o cabecalho <!-- @dsCard group=... title=... -->")
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        body = raw[m.end():].strip()
        out = TPL.format(
            group=attrs.get("group", "Geral"),
            title=attrs.get("title", f.stem),
            imports=imports,
            css=body_css.strip(),
            body=body,
        )
        (HERE / f.name).write_text(out, encoding="utf-8")
        print(f"  {f.name}  [{attrs.get('group')}]")
        n += 1
    print(f"{n} cards montados")


if __name__ == "__main__":
    build()
