#!/usr/bin/env python3
"""兩套立體牌身 v3：整套一起畫（2026-10-26）
使用者：「我說的是牌本身的寬，不是指厚度……先理解，不要改」→「可能要整套重畫，上次不是只重畫部分的牌造成畫風不同？」→ 照建議做。
  1. Codex 一次畫豬肝紅 6 種（同一張圖、同一個鏡頭、同一組燈光）：原圖/v3/six-2.png
  2. 每一張用顏色找出「頂面」與「前緣／側面」的分界，兩段各自整塊縮放到真牌比例（不逐行 —— 會留階梯紋）：
     ‧ 頂面是梯形（前大後小）→ 先用 QUAD 拉正成長方形
     ‧ 同一個鏡頭：水平面一律壓縮 0.78，垂直面照躺著那張的前緣換算
  3. 金黃：6 張排成一張送 Codex 一次改成金屬金（同一次，金色調才一致），再切回來縮成跟豬肝紅一樣大
輸出 devtools/立體牌/sprites/v3/{maroon,gold}/{faceV,faceH,backV,backH,standV,standH,standHR}.{png,webp}
  standV 立著、牌背朝我們（對家）　standH 立著、側面朝我們（左家）　standHR 左右翻過來（右家）
執行： python3 tools/build-tile-sets-v3.py [maroon|gold|all]
"""
import os, sys
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'devtools/立體牌/sprites/原圖/v3')
OUT = os.path.join(ROOT, 'devtools/立體牌/sprites/v3')
NAMES = [['faceV', 'backV', 'standV'], ['faceH', 'backH', 'standH']]

# ── 目標尺寸（像素）── 直的那一組：240＝牌寬 26 mm（9.23 px/mm）；橫的那一組：240＝牌長 35 mm（6.86 px/mm）
#    水平面壓縮 0.78；垂直面：躺著的直牌前緣 90 px＝厚度 20 mm（4.5 px/mm），橫牌前緣 67 px（3.35 px/mm）
V, H = 240 / 26, 240 / 35
TARGET = {
    'faceV':  (240, [round(0.78 * 35 * V), 90]),           # 頂面（牌長）＋前緣（厚度）
    'backV':  (240, [round(0.78 * 35 * V), 90]),
    'faceH':  (240, [round(0.78 * 26 * H), 67]),           # 頂面（牌寬）＋前緣
    'backH':  (240, [round(0.78 * 26 * H), 67]),
    'standV': (240, [round(0.78 * 20 * V), round(35 * 4.5)]),      # 頂端（厚度）＋牌背（牌高）
    'standH': (round(20 * H), [round(0.78 * 26 * H), round(35 * 3.35)]),   # 寬＝厚度；頂端（牌寬）＋側面（牌高）
}


def runs(mask, minlen=30):
    r, s = [], None
    for i, v in enumerate(mask):
        if v and s is None: s = i
        if not v and s is not None: r.append((s, i - 1)); s = None
    if s is not None: r.append((s, len(mask) - 1))
    return [x for x in r if x[1] - x[0] > minlen]


def blobs(path):
    """切出 6 張（兩列、各三張），回傳 {名字: RGBA 陣列}（裁到不透明的範圍）"""
    a = np.array(Image.open(path).convert('RGBA'))
    a[a[..., 3] < 24] = 0
    op = a[..., 3] > 128
    out = {}
    for ri, (r0, r1) in enumerate(runs(op.any(1))):
        for ci, (c0, c1) in enumerate(runs(op[r0:r1 + 1].any(0))):
            sub = a[r0:r1 + 1, c0:c1 + 1]
            m = sub[..., 3] > 128
            rr = np.where(m.sum(1) > 5)[0]; cc = np.where(m.sum(0) > 5)[0]
            out[NAMES[ri][ci]] = sub[rr[0]:rr[-1] + 1, cc[0]:cc[-1] + 1].copy()
    return out


def color_rows(sub):
    """每一列是象牙白（I）、豬肝紅（M）還是混的（.）—— 看中間 60% 的寬"""
    m = sub[..., 3] > 128
    rgb = sub[..., :3].astype(float)
    ivory = (rgb.min(-1) > 150) & m
    maroon = (rgb[..., 0] > rgb[..., 2] + 40) & (rgb[..., 1] < 140) & m
    w = sub.shape[1]; mid = slice(int(w * 0.2), int(w * 0.8))
    iv, ma = ivory[:, mid].mean(1), maroon[:, mid].mean(1)
    return np.array([1 if i > 0.6 else 2 if j > 0.6 else 0 for i, j in zip(iv, ma)])


def segs_of(cls, minlen=3):
    out = []
    for i, c in enumerate(cls):
        if out and out[-1][0] == c and out[-1][2] == i - 1: out[-1][2] = i
        else: out.append([c, i, i])
    return [s for s in out if s[2] - s[1] > minlen]


def split_row(name, sub):
    """頂面（或頂端）在第幾列結束 —— 照顏色：
       faceV/faceH：頂面象牙白、前緣上半象牙白下半豬肝紅（各半）→ 前緣＝豬肝紅那段的兩倍
       backV/backH：前緣上半豬肝紅、下半象牙白 → 前緣＝象牙白那段的兩倍
       standV：頂端遠半象牙白、近半豬肝紅（各半）→ 頂端＝象牙白那段的兩倍
       standH：頂端與側面都是左白右紅，中間有一條沒有顏色的分界（高光）→ 找最上面那段混色區塊的結尾"""
    h = sub.shape[0]
    s = segs_of(color_rows(sub))
    if name.startswith('face'):
        m = [x for x in s if x[0] == 2][-1]; return h - 2 * (m[2] - m[1] + 1)
    if name.startswith('back'):
        ms = [x for x in s if x[0] == 2]
        if len(ms) >= 2: return ms[1][1]        # 頂面與前緣之間那條高光把豬肝紅切成兩段：用那條線（比推算準）
        i = [x for x in s if x[0] == 1][-1]; return h - 2 * (i[2] - i[1] + 1)
    if name == 'standV':
        i = [x for x in s if x[0] == 1][0]; return 2 * (i[2] - i[1] + 1)
    # standH：混色（0）的第一段的結尾（下一段從分界後開始）
    z = [x for x in s if x[0] == 0]
    return z[0][2] + 1


def edges_at(m, y):
    xs = np.where(m[y])[0]
    return (xs[0], xs[-1]) if len(xs) else (0, m.shape[1] - 1)


def straighten(region, out_w, out_h):
    """梯形（遠窄近寬）→ 長方形：量區段上下各往內 12% 那兩列的左右邊，線性外插到上下緣，QUAD 一次拉正"""
    m = region[..., 3] > 128
    h = region.shape[0]
    ya, yb = int(h * 0.12), int(h * 0.88)
    (la, ra), (lb, rb) = edges_at(m, ya), edges_at(m, yb)
    k = lambda p, q, y: p + (q - p) * (y - ya) / max(1, (yb - ya))
    tl, tr = k(la, lb, 0), k(ra, rb, 0)
    bl, br = k(la, lb, h), k(ra, rb, h)
    im = Image.fromarray(region)
    # QUAD：來源四角（左上、左下、右下、右上）
    return im.transform((out_w, out_h), Image.QUAD, (tl, 0, bl, h, br, h, tr, 0), Image.BICUBIC)


def build(name, sub):
    W, (th, bh) = TARGET[name]
    y = split_row(name, sub)
    top, bot = sub[:y], sub[y:]
    top_im = straighten(top, W, th)
    m = bot[..., 3] > 128
    cc = np.where(m.any(0))[0]
    bot_im = Image.fromarray(bot[:, cc[0]:cc[-1] + 1]).resize((W, bh), Image.LANCZOS)
    out = Image.new('RGBA', (W, th + bh), (0, 0, 0, 0))
    out.alpha_composite(top_im, (0, 0))
    out.alpha_composite(bot_im, (0, th))
    return out, y


def even_split(im):
    """側立牌：左邊象牙白、右邊豬肝紅（金）要各半。Codex 畫的色塊只佔約三分之一 →
       找出象牙白那幾欄到哪裡為止，左右兩塊各自整塊縮放成一半寬（不逐行）"""
    a = np.array(im).astype(float)
    h, w = a.shape[:2]
    rgb = a[int(h * 0.1):int(h * 0.9), :, :3]
    sat = rgb.max(-1) - rgb.min(-1)
    ivory = ((rgb.min(-1) > 150) & (sat < 45)).mean(0)          # 每一欄有多少象牙白
    # 從左邊數起第一段連續的象牙白（右邊緣的亮面高光也會被當成象牙白，不能取最後一欄）
    start = int(np.argmax(ivory > 0.5))
    cut = start + int(np.argmax(ivory[start:] <= 0.5)) if (ivory[start:] <= 0.5).any() else w // 2
    left = im.crop((0, 0, cut, h)).resize((w // 2, h), Image.LANCZOS)
    right = im.crop((cut, 0, w, h)).resize((w - w // 2, h), Image.LANCZOS)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.alpha_composite(left, (0, 0)); out.alpha_composite(right, (w // 2, 0))
    print('  側立牌：象牙白原本', cut, '/', w, '→ 各半')
    return out


def save(setname, imgs):
    d = os.path.join(OUT, setname)
    os.makedirs(d, exist_ok=True)
    imgs = dict(imgs)
    imgs['standH'] = even_split(imgs['standH'])
    imgs['standHR'] = imgs['standH'].transpose(Image.FLIP_LEFT_RIGHT)
    for n, im in imgs.items():
        im.save(os.path.join(d, n + '.png'))
        im.save(os.path.join(d, n + '.webp'), quality=90, method=6)
        print(setname, n, im.size)


def maroon():
    subs = blobs(os.path.join(RAW, 'six-2.png'))
    res = {}
    for n, sub in subs.items():
        res[n], y = build(n, sub)
        print('  切在第', y, '列 /', sub.shape[0], n)
    save('maroon', res)
    # 送 Codex 改金的那一張：6 張排成兩列（同原圖的排法），透明底、間隔 60
    rows = [[res[n] for n in r] for r in NAMES]
    gap = 60
    Wd = max(sum(i.width for i in r) + gap * (len(r) + 1) for r in rows)
    Hd = sum(max(i.height for i in r) for r in rows) + gap * 3
    sheet = Image.new('RGBA', (Wd, Hd), (0, 0, 0, 0)); yy = gap
    for r in rows:
        xx = gap
        for i in r: sheet.alpha_composite(i, (xx, yy)); xx += i.width + gap
        yy += max(i.height for i in r) + gap
    sheet.save(os.path.join(RAW, 'maroon-sheet.png'))


def gold():
    src = os.path.join(RAW, 'gold-sheet.png')
    subs = blobs(src)
    ref = {n: Image.open(os.path.join(OUT, 'maroon', n + '.png')) for r in NAMES for n in r}
    save('gold', {n: Image.fromarray(sub).resize(ref[n].size, Image.LANCZOS) for n, sub in subs.items()})


if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if which in ('maroon', 'all'): maroon()
    if which in ('gold', 'all') and os.path.exists(os.path.join(RAW, 'gold-sheet.png')): gold()
