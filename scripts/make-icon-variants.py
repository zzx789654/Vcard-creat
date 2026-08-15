#!/usr/bin/env python3
"""
make-icon-variants.py — 產生多個候選圖示版本 + 一張對照表，供挑選。

版本涵蓋不同配色與造型：
  Quad  ：四宮格（3 個 QR 定位點 + 聯絡人剪影）
  Card  ：名片卡片（QR 方塊 + 文字線條）
  Scan  ：純 QR 圖樣（定位點 + 資料模組）

輸出：
  assets/variants/v1..v6.png（各 512）
  assets/variants/contact-sheet.png（3x2 對照表，含標籤）

執行：python3 scripts/make-icon-variants.py
"""

import os
from PIL import Image, ImageDraw, ImageFont

SS = 4
OUT = 512
S = OUT * SS
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def diagonal_gradient(size, c0, c1):
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


def tile(c0, c1):
    t = diagonal_gradient(S, c0, c1).convert("RGBA")
    t.putalpha(rounded_mask(S, int(S * 0.225)))
    return t


def finder(d, cx, cy, e, stroke, color):
    half = e / 2
    d.rounded_rectangle([cx - half, cy - half, cx + half, cy + half],
                        radius=e * 0.28, outline=color, width=int(stroke))
    ic = e * 0.34
    d.rounded_rectangle([cx - ic / 2, cy - ic / 2, cx + ic / 2, cy + ic / 2],
                        radius=ic * 0.30, fill=color)


def person(d, cx, cy, w, color):
    hr = w * 0.26
    hcy = cy - w * 0.30
    d.ellipse([cx - hr, hcy - hr, cx + hr, hcy + hr], fill=color)
    bw, bh = w * 0.92, w * 0.78
    top = cy - w * 0.02
    d.rounded_rectangle([cx - bw / 2, top, cx + bw / 2, top + bh], radius=bw * 0.5, fill=color)


# ---------- 造型 ----------

def comp_quad(c0, c1):
    img = tile(c0, c1)
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)
    e = S * 0.26
    lo, hi = S * 0.255, S * 0.745
    finder(d, lo, lo, e, S * 0.052, WHITE)
    finder(d, hi, lo, e, S * 0.052, WHITE)
    finder(d, lo, hi, e, S * 0.052, WHITE)
    person(d, hi, hi + S * 0.02, e * 0.86, WHITE)
    return Image.alpha_composite(img, fg)


def comp_card(c0, c1):
    img = tile(c0, c1)
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)
    # 白色名片卡
    m = S * 0.18
    card = [m, S * 0.26, S - m, S * 0.74]
    d.rounded_rectangle(card, radius=S * 0.06, fill=WHITE)
    # 左側 QR 方塊（用深色 c0）
    qx, qy = S * 0.27, S * 0.38
    qs = S * 0.24
    # 3x3 finder 風格
    finder(d, qx + qs * 0.30, qy + qs * 0.30, qs * 0.55, S * 0.028, c0)
    # 幾個資料模組
    step = qs * 0.22
    for (gx, gy) in [(0.72, 0.18), (0.90, 0.18), (0.72, 0.55), (0.90, 0.90), (0.55, 0.90), (0.18, 0.90)]:
        bx, by = qx + qs * gx, qy + qs * gy
        d.rounded_rectangle([bx, by, bx + step, by + step], radius=step * 0.3, fill=c0)
    # 右側文字線條
    lx = S * 0.56
    lw = S * 0.26
    tint = lerp(c0, (255, 255, 255), 0.55)
    for i, (ly, frac) in enumerate([(0.40, 1.0), (0.50, 0.8), (0.60, 0.62)]):
        h = S * 0.035
        d.rounded_rectangle([lx, S * ly, lx + lw * frac, S * ly + h], radius=h * 0.5,
                            fill=c0 if i == 0 else tint)
    return Image.alpha_composite(img, fg)


def comp_scan(c0, c1):
    img = tile(c0, c1)
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)
    e = S * 0.24
    lo, hi = S * 0.245, S * 0.755
    finder(d, lo, lo, e, S * 0.05, WHITE)
    finder(d, hi, lo, e, S * 0.05, WHITE)
    finder(d, lo, hi, e, S * 0.05, WHITE)
    # 資料模組（固定圖樣，非隨機，維持整齊）
    u = S * 0.072
    grid = [
        (0.50, 0.20), (0.50, 0.34), (0.62, 0.50), (0.50, 0.62),
        (0.20, 0.50), (0.34, 0.50), (0.50, 0.50),
        (0.68, 0.68), (0.82, 0.68), (0.68, 0.82), (0.82, 0.82), (0.75, 0.75),
        (0.68, 0.20), (0.82, 0.34),
    ]
    for (gx, gy) in grid:
        bx, by = S * gx - u / 2, S * gy - u / 2
        d.rounded_rectangle([bx, by, bx + u, by + u], radius=u * 0.28, fill=WHITE)
    return Image.alpha_composite(img, fg)


# ---------- 版本清單（造型 + 配色）----------
VARIANTS = [
    ("Quad · Indigo-Cyan", comp_quad, (79, 70, 229), (6, 182, 212)),
    ("Quad · Emerald-Teal", comp_quad, (16, 185, 129), (13, 148, 136)),
    ("Quad · Violet-Pink", comp_quad, (124, 58, 237), (236, 72, 153)),
    ("Card · Blue-Indigo", comp_card, (37, 99, 235), (79, 70, 229)),
    ("Scan · Amber-Orange", comp_scan, (245, 158, 11), (239, 68, 68)),
    ("Scan · Slate-Cyan", comp_scan, (30, 41, 59), (8, 145, 178)),
]


def build():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(root, "assets", "variants")
    os.makedirs(outdir, exist_ok=True)

    icons = []
    for i, (label, comp, c0, c1) in enumerate(VARIANTS, 1):
        img = comp(c0, c1).resize((OUT, OUT), Image.LANCZOS)
        p = os.path.join(outdir, f"v{i}.png")
        img.save(p)
        icons.append((label, img))
        print("wrote", p)

    # 對照表 3x2
    cell, pad, labelh = 300, 34, 46
    cols, rows = 3, 2
    W = cols * cell + (cols + 1) * pad
    H = rows * (cell + labelh) + (rows + 1) * pad
    sheet = Image.new("RGB", (W, H), (240, 240, 243))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=22)
    except TypeError:
        font = ImageFont.load_default()

    for idx, (label, img) in enumerate(icons):
        r, c = divmod(idx, cols)
        x = pad + c * (cell + pad)
        y = pad + r * (cell + labelh + pad)
        thumb = img.resize((cell, cell), Image.LANCZOS)
        sheet.paste(thumb, (x, y), thumb)
        text = f"{idx + 1}. {label}"
        tb = d.textbbox((0, 0), text, font=font)
        tw = tb[2] - tb[0]
        d.text((x + (cell - tw) / 2, y + cell + 12), text, fill=(30, 30, 40), font=font)

    sp = os.path.join(outdir, "contact-sheet.png")
    sheet.save(sp)
    print("wrote", sp)


if __name__ == "__main__":
    build()
