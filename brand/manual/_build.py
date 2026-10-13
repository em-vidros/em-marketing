#!/usr/bin/env python3
"""
Monta o PDF do Manual de Identidade Visual.

Rota: index.html -> Chrome headless --print-to-pdf. Chrome mantem o texto como
texto (camada real, pesquisavel); qualquer caminho que passe por rasterizacao
devolveria um PDF de imagens, que nenhum agente e nenhuma busca consegue ler.

Uso:
    python3 _build.py            # so o PDF
    python3 _build.py --render   # PDF + PNG de cada pagina em _render/
"""
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
SRC = HERE / "index.html"
OUT = HERE.parent / "EM-Vidros-Manual-Identidade-Visual.pdf"
RENDER = HERE / "_render"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def build():
    if not SRC.exists():
        sys.exit(f"nao encontrei {SRC}")

    subprocess.run(
        [
            CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
            # As paginas carregam os SVG do logotipo e os PNG de textura por
            # caminho relativo; sem isto o Chrome bloqueia file:// -> file://.
            "--allow-file-access-from-files",
            # Espera as webfonts do Google baixarem antes de imprimir. Sem isso
            # o PDF sai com fallback e a metrica inteira muda.
            "--virtual-time-budget=25000",
            f"--print-to-pdf={OUT}", SRC.as_uri(),
        ],
        check=True, capture_output=True,
    )
    print(f"pdf: {OUT.name}  ({OUT.stat().st_size // 1024} KB)")


def render():
    """Rasteriza cada pagina para revisao visual. Nao entra na entrega."""
    if RENDER.exists():
        shutil.rmtree(RENDER)
    RENDER.mkdir()
    subprocess.run(
        ["pdftoppm", "-png", "-r", "110", str(OUT), str(RENDER / "p")],
        check=True,
    )
    n = len(list(RENDER.glob("*.png")))
    print(f"render: {n} paginas em {RENDER.name}/")


if __name__ == "__main__":
    build()
    if "--render" in sys.argv:
        render()
