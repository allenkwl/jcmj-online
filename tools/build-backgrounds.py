#!/usr/bin/env python3
"""把七國的戰爭場景圖做成牌桌背景（黑化版）。

    python3 tools/build-backgrounds.py [--preview]

來源：`assets/<國>.jpg`（1536×1024，舊版的 `KINGDOM_BGS`）
輸出：`assets/table/<國>.webp`

── 為什麼要黑化 ──
原圖是 Q 版的戰爭場景，色彩很飽和、細節很多。直接鋪在牌桌下面會
跟牌搶注意力 —— 麻將的牌面本來就是高對比的白底黑字紅字，
背景一亮就讀不動了。

所以壓三件事：
  ‧ 亮度降到約三成　　讓牌浮出來
  ‧ 降飽和　　　　　　免得紅色旌旗跟紅中、綠旗跟發撞色
  ‧ 壓一層墨綠　　　　接回牌桌的氈面色（--felt #0d3b2e）
再加暗角，把視線收回中央。

尺寸降到 1280 寬就夠 —— 它被壓到很暗，再高的解析度看不出來，
但檔案會大三倍。實測每張約 40–60 KB（原圖約 500 KB）。
"""
import os
import sys

try:
    from PIL import Image, ImageEnhance
except ImportError:
    print('需要 Pillow：pip3 install Pillow', file=sys.stderr)
    sys.exit(1)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ASSETS = os.path.join(ROOT, 'assets')
OUT = os.path.join(ASSETS, 'table')

KINGDOMS = ['qi', 'chu', 'yan', 'han', 'wei', 'zhao', 'qin']
WIDTH = 1280

# 標題／選國畫面：那兩張圖本身就是重點，不像牌桌背景要退到後面，
# 所以只縮尺寸與換 WebP，亮度飽和都不動（只輕輕壓一點暗角）。
SCREENS = {'title-bg-img': 'title', 'sel-bg-img': 'select'}

BRIGHTNESS = 0.30     # 亮度剩三成
SATURATION = 0.55     # 降飽和
FELT = (13, 59, 46)   # --felt，壓上去把色溫拉回牌桌
FELT_MIX = 0.42
VIGNETTE = 0.55       # 暗角強度


def vignette(img, strength):
    """用徑向漸層壓暗四周，把視線收回中央。"""
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    px = mask.load()
    cx, cy = w / 2.0, h / 2.0
    maxd = (cx ** 2 + cy ** 2) ** 0.5
    # 逐列算就夠（左右對稱），比逐點快很多
    for y in range(h):
        dy = (y - cy) ** 2
        row = []
        for x in range(w):
            d = ((x - cx) ** 2 + dy) ** 0.5 / maxd
            v = 1.0 - strength * max(0.0, (d - 0.35) / 0.65) ** 1.6
            row.append(int(max(0.0, min(1.0, v)) * 255))
        for x in range(w):
            px[x, y] = row[x]
    black = Image.new('RGB', (w, h), (0, 0, 0))
    return Image.composite(img, black, mask)


def build(src, dst):
    img = Image.open(src).convert('RGB')
    h = int(img.height * WIDTH / img.width)
    img = img.resize((WIDTH, h), Image.LANCZOS)

    img = ImageEnhance.Color(img).enhance(SATURATION)
    img = ImageEnhance.Brightness(img).enhance(BRIGHTNESS)

    felt = Image.new('RGB', img.size, FELT)
    img = Image.blend(img, felt, FELT_MIX)

    img = vignette(img, VIGNETTE)
    img.save(dst, 'WEBP', quality=80, method=6)
    return os.path.getsize(dst)


def build_screen(src, dst):
    """標題／選國用：只縮尺寸、輕暗角，不壓亮度 —— 那兩張圖是主角。"""
    img = Image.open(src).convert('RGB')
    h = int(img.height * WIDTH / img.width)
    img = img.resize((WIDTH, h), Image.LANCZOS)
    img = ImageEnhance.Brightness(img).enhance(0.82)
    img = vignette(img, 0.35)
    img.save(dst, 'WEBP', quality=82, method=6)
    return os.path.getsize(dst)


def main():
    if not os.path.isdir(ASSETS):
        print('找不到 assets/，先跑 tools/extract-assets.py', file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)
    total = 0

    for src_name, out_name in SCREENS.items():
        src = os.path.join(ASSETS, src_name + '.jpg')
        if not os.path.exists(src):
            print(f'  ⚠️ 缺 {src_name}.jpg')
            continue
        n = build_screen(src, os.path.join(OUT, f'{out_name}.webp'))
        total += n
        print(f'  {out_name:<6} {n/1024:6.1f} KB  （畫面背景）')

    for k in KINGDOMS:
        src = os.path.join(ASSETS, f'{k}.jpg')
        if not os.path.exists(src):
            print(f'  ⚠️ 缺 {k}.jpg')
            continue
        n = build(src, os.path.join(OUT, f'{k}.webp'))
        total += n
        print(f'  {k:<6} {n/1024:6.1f} KB')
    print(f'\n合計 {total/1024:.0f} KB → assets/table/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
