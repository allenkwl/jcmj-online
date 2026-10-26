#!/usr/bin/env python3
"""兩套立體牌身（豬肝紅、金黃）—— 2026-10-26
使用者：「另外三家的手牌……應該是立起來的」「整套牌一起畫，除了現在的豬肝紅，再另外畫一組金黃色」「我看過再進遊戲」。

  豬肝紅：躺著的 4 種沿用 assets/tiles3d（v1.95 定稿）；立著的 2 種是 Codex 新畫的
          （devtools/立體牌/sprites/原圖/v2/stand-maroon-1.png，用定稿的 4 張當參考圖鎖材質）
  金黃  ：豬肝紅那一套的紅色部分轉成金黃（形狀、厚度、光影完全一樣，只換顏色）

輸出 devtools/立體牌/sprites/v2/{maroon,gold}/{faceV,faceH,backV,backH,standV,standH,standHR}.{png,webp}
  standV  立著、牌背朝我們（對家的手牌）
  standH  立著、側面朝我們（左家的手牌）　standHR  同上左右翻過來（右家）
執行： python3 tools/build-tile-sets.py
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'devtools/立體牌/sprites/原圖/v2/stand-maroon-1.png')
OUT = os.path.join(ROOT, 'devtools/立體牌/sprites/v2')
W = 240                       # 直的牌寬（＝牌寬 26 mm），跟 assets/tiles3d 一樣


def crop_blob(a, c0, c1):
    """一塊的範圍：只算「這一列夠多不透明的點」的列 —— 上緣幾顆雜點不算"""
    sub = a[:, c0:c1 + 1, 3]
    rows = np.where((sub > 128).sum(1) > 20)[0]
    cols = np.where((sub[rows[0]:rows[-1] + 1] > 128).sum(0) > 20)[0]
    return rows[0], rows[-1], c0 + cols[0], c0 + cols[-1]


def clean(im):
    a = np.array(im)
    a[a[..., 3] < 24] = 0     # 半透明的毛邊雜訊歸零
    return Image.fromarray(a)


def standing():
    im = Image.open(SRC).convert('RGBA')
    a = np.array(im)
    opaque = (a[..., 3] > 128).any(0)
    cols = np.where(opaque)[0]
    gap = [i for i in range(1, len(cols)) if cols[i] - cols[i - 1] > 5][0]
    blobs = [(cols[0], cols[gap - 1]), (cols[gap], cols[-1])]
    out = {}
    (r0, r1, c0, c1) = crop_blob(a, *blobs[0])
    back = clean(im.crop((c0, r0, c1 + 1, r1 + 1)))
    k = W / back.width
    out['standV'] = back.resize((W, round(back.height * k)), Image.LANCZOS)
    return out


def sides(sv):
    """左右兩家：背對直立那張轉 90°（2026-10-26 使用者：「直立的牌寬度太窄（左右兩家用的牌）」——
       側面朝我們只看得到厚度，太窄。改成像對家那樣看到整面牌背，牌的頂端朝向那一家自己）"""
    return {'standH': sv.rotate(90, expand=True),      # 左家：頂端朝左
            'standHR': sv.rotate(-90, expand=True)}    # 右家：頂端朝右


def fit_to(im, ref):
    """Codex 重畫的圖：照不透明的範圍裁切，縮成跟豬肝紅那張一樣大（形狀一樣，牌桌上才不會換一種大小）"""
    a = np.array(im)
    a[a[..., 3] < 24] = 0
    m = a[..., 3] > 128
    rows = np.where(m.sum(1) > 10)[0]; cols = np.where(m.sum(0) > 10)[0]
    box = Image.fromarray(a).crop((cols[0], rows[0], cols[-1] + 1, rows[-1] + 1))
    return box.resize(ref.size, Image.LANCZOS)


def to_gold(im):
    """豬肝紅 → 金黃：只動「紅」的地方（色相在紅、夠飽和），象牙白與高光不動。
       亮度照原本的明暗重新對應（暗紅 → 深金、亮紅 → 亮金），光影保留"""
    a = np.array(im).astype(np.float32) / 255.0
    rgb = a[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    redness = np.clip((r - np.maximum(g, b)) / np.maximum(mx, 1e-6), 0, 1)   # 紅偏多少
    w = np.clip((s - 0.25) / 0.35, 0, 1) * np.clip(redness / 0.45, 0, 1)      # 0＝不動、1＝全換
    v = mx
    vn = np.clip((v - 0.10) / 0.55, 0, 1) ** 0.85                             # 原本的明暗 0..1（略提亮）
    gv = 0.30 + 0.70 * vn                                                     # 金：暗處深金、亮處淡金，對比拉開
    gs = 0.90 - 0.50 * vn ** 2                                                # 亮處飽和度降下來（金屬的高光）
    h = (34 + 14 * vn) / 360                                                  # 暗處偏橘（34°）、亮處偏黃（48°）
    hp = h * 6
    i = np.floor(hp).astype(int); f = hp - i
    p_ = gv * (1 - gs); q = gv * (1 - gs * f); t = gv * (1 - gs * (1 - f))
    # h 在 0–60° 之間只會落在 i=0（R 最大、G 往上、B 最小）
    gold = np.stack([gv, t, p_], -1)
    out = rgb * (1 - w[..., None]) + gold * w[..., None]
    res = np.concatenate([np.clip(out, 0, 1), a[..., 3:4]], -1)
    return Image.fromarray((res * 255).round().astype(np.uint8), 'RGBA')


def main():
    sets = {}
    maroon = {n: Image.open(os.path.join(ROOT, 'assets/tiles3d/%s.webp' % n)).convert('RGBA')
              for n in ['faceV', 'faceH', 'backV', 'backH']}
    maroon.update(standing())
    maroon.update(sides(maroon['standV']))
    sets['maroon'] = maroon
    # 金黃：Codex 照豬肝紅那張改畫成金屬金（原圖/v2/gold-<種>.png），裁成跟豬肝紅一樣大；沒有的才退回轉色
    gold = {}
    for n in ['faceV', 'faceH', 'backV', 'backH', 'standV']:
        g = os.path.join(ROOT, 'devtools/立體牌/sprites/原圖/v2/gold-%s.png' % n)
        gold[n] = fit_to(Image.open(g).convert('RGBA'), maroon[n]) if os.path.exists(g) else to_gold(maroon[n])
    gold.update(sides(gold['standV']))
    sets['gold'] = gold
    for name, imgs in sets.items():
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        for n, im in imgs.items():
            im.save(os.path.join(d, n + '.png'))
            im.save(os.path.join(d, n + '.webp'), quality=90, method=6)   # 遊戲的 MJTiles.setBodies 讀 .webp
            print(name, n, im.size)


if __name__ == '__main__':
    main()
