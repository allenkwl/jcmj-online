#!/usr/bin/env python3
"""把固定不變的標題用 macOS 的「魏碑 TC」排好，做成圖片。

    python3 tools/build-titles.py

── 為什麼是圖片（2026-09-25 使用者定案：標題用魏碑，其餘用全套正體）──
  ‧ 魏碑是 macOS 內建字型：iPhone、Android、Windows 都沒有，網頁指定了也只有 Mac 看得到
  ‧ Apple 的字型不能當網頁字型放上網給大家下載
  → 固定的標題在這台 Mac 上排好、轉成圖片，每一台看到的都一樣。
    會變的字（玩家名字、國名、詔書內容）不能做成圖，那些用思源宋體 Black（--font-deco）。

── 輸出 ──
  assets/titles/<id>.webp   透明背景，金色漸層字＋兩層深褐擠出（照主標題原本的 text-shadow），
                            高度 = 字級 × 1.35 左右，給 CSS 用 height:1.2em 縮放
要加新標題：在 TITLES 加一行，重跑，HTML 裡用 <img class="ttl" src="assets/titles/<id>.webp" alt="原文">。
"""
import glob
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    print('需要 Pillow：pip3 install Pillow', file=sys.stderr)
    sys.exit(1)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'assets', 'titles')

# 魏碑 TC 是「可下載字型」，裝在 AssetsV2 底下，路徑的雜湊每台 Mac 不一樣，用找的
FONT = next(iter(sorted(glob.glob('/System/Library/AssetsV2/**/WeibeiTC-Bold.otf', recursive=True))), None) \
    or next(iter(glob.glob(os.path.expanduser('~/Library/Fonts/WeibeiTC-Bold.otf'))), None)

TITLES = [
    # id              原文                字距（em）
    ('main',          '戰國麻將列傳',      0.06),
    ('select',        '擇國而立',          0.18),
    ('worldmap',      '天下形勢',          0.25),
    ('fortune',       '發牌占卜',          0.12),
    ('online',        '連線對戰',          0.12),
    ('settings',      '設定',              0.3),
    ('help',          '遊戲說明',          0.12),
    ('leave',         '離開牌局',          0.12),
    ('enfeoff',       '分封領地',          0.3),
    ('unify',         '天下一統',          0.2),
    ('court',         '六國來朝',          0.3),
    ('congrats',      '恭喜主公',          0.22),
    ('intro-title',   '一桌　定江山',      0.08),
    ('intro-lineup',  '戰國七雄　列陣',    0.08),
    ('intro-battle',  '以牌為兵',          0.14),
    ('intro-conquer', '征服六國',          0.14),
]

SIZE = 160            # 字級（像素）。畫面上最大的主標題約 104px，兩倍解析度夠用
GOLD_TOP = (255, 236, 170)
GOLD_BOT = (201, 150, 58)
EXTRUDE = [((58, 32, 8), 6), ((90, 62, 18), 3)]   # 先畫深的、遠的，再畫淺的、近的（跟主標題的 text-shadow 一樣）


def render(text, spacing):
    font = ImageFont.truetype(FONT, SIZE)
    # 逐字排，字距用 em 算
    widths = [font.getbbox(ch)[2] - font.getbbox(ch)[0] if ch.strip() and ch != '　' else SIZE * 0.6 for ch in text]
    adv = [font.getlength(ch) for ch in text]
    gap = SIZE * spacing
    W = int(sum(adv) + gap * (len(text) - 1) + SIZE * 0.4)
    H = int(SIZE * 1.45)
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    x = SIZE * 0.2
    for ch, a in zip(text, adv):
        d.text((x, SIZE * 0.12), ch, font=font, fill=255)
        x += a + gap

    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # 立體擠出：把字形往右下偏移、塗深褐
    for color, off in EXTRUDE:
        for k in range(1, off + 1):
            layer = Image.new('RGBA', (W, H), color + (255,))
            shifted = Image.new('L', (W, H), 0)
            shifted.paste(mask, (k, k))
            img = Image.composite(layer, img, shifted)
    # 金色直向漸層的字面
    grad = Image.new('RGBA', (W, H))
    gd = ImageDraw.Draw(grad)
    top, bot = SIZE * 0.12, SIZE * 1.12
    for y in range(H):
        t = min(1, max(0, (y - top) / (bot - top)))
        c = tuple(int(GOLD_TOP[i] + (GOLD_BOT[i] - GOLD_TOP[i]) * t) for i in range(3))
        gd.line([(0, y), (W, y)], fill=c + (255,))
    img = Image.composite(grad, img, mask)
    # 裁掉多餘的透明邊（留一點給 CSS 的光暈）
    bbox = img.getbbox()
    if bbox:
        pad = 8
        img = img.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(W, bbox[2] + pad), min(H, bbox[3] + pad)))
    return img


def main():
    if not FONT:
        print('找不到魏碑 TC（WeibeiTC-Bold.otf）。到「字體簿」下載「魏碑-繁」之後再跑一次', file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for tid, text, spacing in TITLES:
        img = render(text, spacing)
        dst = os.path.join(OUT, tid + '.webp')
        img.save(dst, 'WEBP', quality=88, alpha_quality=90, method=6)
        total += os.path.getsize(dst)
        print(f'  {tid:<14} {text:<8} {img.size[0]}×{img.size[1]}  {os.path.getsize(dst) // 1024} KB')
    print(f'合計 {total // 1024} KB → assets/titles/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
