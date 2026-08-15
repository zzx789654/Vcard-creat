#!/usr/bin/env python3
"""
make-icon.py — 產生 vCard QRCode 產生器的正式應用程式圖示。

設計（Card 造型 · 藍→靛藍，經使用者選定為版本 4）：
  圓角 App 磁磚 + 藍→靛藍對角漸層背景，中央一張白色名片，
  名片左側是 QR 方塊、右側是文字線條——最直白表達「電子名片 / vCard」。

輸出：
  assets/icon.png  1024x1024（跨平台 / fallback）
  assets/icon.ico  多尺寸（16/24/32/48/64/128/256，供 Windows 打包）

以 4x 超取樣繪製後縮小，取得平滑邊緣。純標準庫 + Pillow，無外部素材。
候選版本的比較請見 scripts/make-icon-variants.py。
執行：python3 scripts/make-icon.py
"""

import os
from PIL import Image, ImageDraw

SS = 4                      # supersampling factor
OUT = 1024                  # final base size
S = OUT * SS                # working canvas size

WHITE = (255, 255, 255, 255)

# 漸層兩端色（藍 -> 靛藍）
C0 = (37, 99, 235)          # #2563EB blue-600
C1 = (79, 70, 229)          # #4F46E5 indigo-600


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def diagonal_gradient(size, c0, c1):
    """左上 c0 -> 右下 c1 的對角漸層。"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    maxd = (size - 1) * 2 or 1
    for y in range(size):
        for x in range(size):
            px[x, y] = lerp(c0, c1, (x + y) / maxd)
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def finder(d, cx, cy, e, stroke, color):
    """QR 定位點（外框 + 中心方塊），置中於 (cx, cy)，外框邊長 e。"""
    half = e / 2
    d.rounded_rectangle([cx - half, cy - half, cx + half, cy + half],
                        radius=e * 0.28, outline=color, width=int(stroke))
    ic = e * 0.34
    d.rounded_rectangle([cx - ic / 2, cy - ic / 2, cx + ic / 2, cy + ic / 2],
                        radius=ic * 0.30, fill=color)


def build():
    # 背景磁磚（圓角 + 漸層）
    img = diagonal_gradient(S, C0, C1).convert("RGBA")
    img.putalpha(rounded_mask(S, int(S * 0.225)))

    # 前景層
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)

    # 白色名片卡
    m = S * 0.16
    d.rounded_rectangle([m, S * 0.25, S - m, S * 0.75], radius=S * 0.06, fill=WHITE)

    # 左側 QR 方塊（深色 C0）
    qx, qy = S * 0.25, S * 0.365
    qs = S * 0.26
    finder(d, qx + qs * 0.30, qy + qs * 0.30, qs * 0.55, S * 0.030, C0)
    step = qs * 0.22
    for (gx, gy) in [(0.72, 0.18), (0.90, 0.18), (0.72, 0.55),
                     (0.90, 0.90), (0.55, 0.90), (0.18, 0.90), (0.90, 0.55)]:
        bx, by = qx + qs * gx, qy + qs * gy
        d.rounded_rectangle([bx, by, bx + step, by + step], radius=step * 0.3, fill=C0)

    # 右側文字線條（第一行深色，其餘淺色調）
    lx, lw = S * 0.55, S * 0.28
    tint = lerp(C0, (255, 255, 255), 0.55)
    for i, (ly, frac) in enumerate([(0.39, 1.0), (0.50, 0.82), (0.61, 0.62)]):
        h = S * 0.038
        d.rounded_rectangle([lx, S * ly, lx + lw * frac, S * ly + h], radius=h * 0.5,
                            fill=C0 if i == 0 else tint)

    out = Image.alpha_composite(img, fg).resize((OUT, OUT), Image.LANCZOS)

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets = os.path.join(root, "assets")
    os.makedirs(assets, exist_ok=True)

    png_path = os.path.join(assets, "icon.png")
    ico_path = os.path.join(assets, "icon.ico")
    out.save(png_path)
    out.save(ico_path,
             sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("wrote", png_path)
    print("wrote", ico_path)


if __name__ == "__main__":
    build()
