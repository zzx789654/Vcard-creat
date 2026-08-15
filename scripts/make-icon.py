#!/usr/bin/env python3
"""
make-icon.py — 產生 vCard QRCode 產生器的應用程式圖示。

設計概念（切合專案主題）：
  圓角 App 磁磚 + 靛藍→青色對角漸層背景，白色前景結合兩個意象——
  「QR 定位點（三個角落的 finder pattern）」表達 QRCode，
  「聯絡人剪影」表達 vCard 名片。小尺寸下仍可辨識。

輸出：
  assets/icon.png  1024x1024（跨平台 / fallback）
  assets/icon.ico  多尺寸（16/24/32/48/64/128/256，供 Windows 打包）

以 4x 超取樣繪製後縮小，取得平滑邊緣。純標準庫 + Pillow，無外部素材。
執行：python3 scripts/make-icon.py
"""

import os
from PIL import Image, ImageDraw

SS = 4                      # supersampling factor
OUT = 1024                  # final base size
S = OUT * SS                # working canvas size

WHITE = (255, 255, 255, 255)

# 漸層兩端色（靛藍 -> 青）
C0 = (79, 70, 229)          # #4F46E5 indigo-600
C1 = (6, 182, 212)          # #06B6D4 cyan-500


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def diagonal_gradient(size, c0, c1):
    """左上 c0 -> 右下 c1 的對角漸層。"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    maxd = (size - 1) * 2 or 1
    # 逐列填色，用行列和當作對角進度，效率足夠且平滑
    for y in range(size):
        for x in range(size):
            px[x, y] = lerp(c0, c1, (x + y) / maxd)
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def finder(draw, cx, cy, e, stroke, white=WHITE):
    """畫一個 QR 定位點（外框 + 中心方塊），置中於 (cx, cy)，外框邊長 e。"""
    half = e / 2
    outer = [cx - half, cy - half, cx + half, cy + half]
    ro = e * 0.28
    # 外框（描邊）
    draw.rounded_rectangle(outer, radius=ro, outline=white, width=int(stroke))
    # 中心實心方塊
    ic = e * 0.34
    ih = ic / 2
    draw.rounded_rectangle(
        [cx - ih, cy - ih, cx + ih, cy + ih],
        radius=ic * 0.30, fill=white,
    )


def person(draw, cx, cy, w, white=WHITE):
    """簡潔聯絡人剪影（頭 + 肩），置中於 (cx, cy)，肩寬約 w。"""
    head_r = w * 0.26
    head_cy = cy - w * 0.30
    draw.ellipse(
        [cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r],
        fill=white,
    )
    # 肩膀：底部被裁掉的圓角膠囊，形成半身剪影
    bw = w * 0.92
    bh = w * 0.78
    top = cy - w * 0.02
    draw.rounded_rectangle(
        [cx - bw / 2, top, cx + bw / 2, top + bh],
        radius=bw * 0.5, fill=white,
    )


def build():
    # 背景磁磚（圓角 + 漸層）
    tile = diagonal_gradient(S, C0, C1).convert("RGBA")
    radius = int(S * 0.225)             # 類 Windows/macOS 圓角比例
    tile.putalpha(rounded_mask(S, radius))

    # 前景層（白色 QR 定位點 + 聯絡人）
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)

    e = S * 0.26                        # finder 外框邊長
    stroke = S * 0.052                  # 外框粗細
    lo = S * 0.255                      # 左/上 finder 中心
    hi = S * 0.745                      # 右/下 finder 中心

    finder(d, lo, lo, e, stroke)        # 左上
    finder(d, hi, lo, e, stroke)        # 右上
    finder(d, lo, hi, e, stroke)        # 左下

    person(d, hi, hi + S * 0.02, e * 0.86)   # 右下：聯絡人

    out = Image.alpha_composite(tile, fg)
    out = out.resize((OUT, OUT), Image.LANCZOS)

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets = os.path.join(root, "assets")
    os.makedirs(assets, exist_ok=True)

    png_path = os.path.join(assets, "icon.png")
    ico_path = os.path.join(assets, "icon.ico")
    out.save(png_path)
    out.save(
        ico_path,
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote", png_path)
    print("wrote", ico_path)


if __name__ == "__main__":
    build()
