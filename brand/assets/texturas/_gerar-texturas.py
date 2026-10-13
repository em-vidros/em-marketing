#!/usr/bin/env python3
"""
Gera os tres overlays de textura da EM Vidros, sem dependencia externa.

Todos saem em cinza neutro 128 com ruido em volta: aplicados em modo de mesclagem
Overlay ou Soft Light, o cinza 128 e neutro, entao a textura so adiciona variacao
e nunca escurece nem clareia a peca no geral.

Uso:  python3 _gerar-texturas.py
"""
import zlib, struct, random, math

W = H = 1080


def write_png(path, pixels, greyscale_alpha=False):
    """pixels: lista de linhas, cada linha uma bytearray ja no formato certo."""
    ctype = 4 if greyscale_alpha else 0
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, ctype, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)


def grao(seed=20260805, forca=26):
    """GRAO — ruido de filme fino, alta frequencia, isotropico."""
    rnd = random.Random(seed)
    rows = []
    for _ in range(H):
        row = bytearray()
        for _ in range(W):
            v = 128 + int(rnd.gauss(0, forca))
            row.append(max(0, min(255, v)))
        rows.append(row)
    return rows


def jateado(seed=20260806):
    """JATEADO — vidro fosco/acidato: ruido de baixa frequencia interpolado."""
    rnd = random.Random(seed)
    cell = 24                      # tamanho da celula antes da interpolacao
    gw, gh = W // cell + 2, H // cell + 2
    grid = [[rnd.gauss(0, 20) for _ in range(gw)] for _ in range(gh)]

    def smooth(t):                 # curva de suavizacao (smootherstep)
        return t * t * t * (t * (t * 6 - 15) + 10)

    rows = []
    for y in range(H):
        gy, fy = divmod(y, cell)
        fy = smooth(fy / cell)
        row = bytearray()
        for x in range(W):
            gx, fx = divmod(x, cell)
            fx = smooth(fx / cell)
            a = grid[gy][gx] * (1 - fx) + grid[gy][gx + 1] * fx
            b = grid[gy + 1][gx] * (1 - fx) + grid[gy + 1][gx + 1] * fx
            v = 128 + (a * (1 - fy) + b * fy)
            v += rnd.gauss(0, 5)   # micro-grao por cima, para nao ficar plastico
            row.append(max(0, min(255, int(v))))
        rows.append(row)
    return rows


def papel(seed=20260807):
    """PAPEL/CIMENTO — fibra: ruido com alongamento horizontal + manchas largas."""
    rnd = random.Random(seed)
    # manchas largas
    cell = 90
    gw, gh = W // cell + 2, H // cell + 2
    grid = [[rnd.gauss(0, 11) for _ in range(gw)] for _ in range(gh)]
    rows = []
    for y in range(H):
        gy, fy = divmod(y, cell)
        fy = fy / cell
        row = bytearray()
        f = 0.0
        for x in range(W):
            gx, fx = divmod(x, cell)
            fx = fx / cell
            a = grid[gy][gx] * (1 - fx) + grid[gy][gx + 1] * fx
            b = grid[gy + 1][gx] * (1 - fx) + grid[gy + 1][gx + 1] * fx
            mancha = a * (1 - fy) + b * fy
            # fibra horizontal: cada pixel se correlaciona com o anterior da MESMA
            # linha, alongando o ruido no eixo x. Correlacionar com a linha de cima
            # produziria estrias verticais, que leem como veludo cotele, nao papel.
            f = 0.55 * f + 0.45 * rnd.gauss(0, 13)
            v = 128 + mancha + f * 1.8
            row.append(max(0, min(255, int(v))))
        rows.append(row)
    return rows


if __name__ == "__main__":
    for nome, fn in (("grao", grao), ("jateado", jateado), ("papel", papel)):
        write_png(f"emv-textura-{nome}.png", fn())
        print(f"emv-textura-{nome}.png  {W}x{H}")
