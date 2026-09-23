#!/usr/bin/env python3
"""把主公的原圖壓成畫面用的尺寸。

    python3 tools/build-avatars.py

── 來源（2026-09-23 起：整套重畫，見 docs/character-design.md）──
  ‧ `assets/portraits/<國>_lord.png`      半身像，1254×1254，透明背景
  ‧ `assets/portraits/war/<國>_{1,2,3}.png` 出征三格（已對齊、共用裁切框），透明背景
    由 `assets/portraits/prompts/anim_all.py` 從 Codex 畫的三格動作表切出來

── 輸出（assets/avatar/）──
  ‧ `<國>.webp`        96×96　 名牌旁的小頭貼（實際畫 22px，留給高 DPI）、選國卡片
  ‧ `<國>_bust.webp`   384×384 開場動畫「七雄列陣」
  ‧ `<國>_war1.webp`   512×512 出征第一格（蓄勢）
  ‧ `<國>_war2.webp`   512×512 出征第二格（出招）
  ‧ `<國>_big.webp`    512×512 出征第三格（進攻）—— 牌桌中央停住的那張，也是開場「對打」用的圖

  守將（電腦座位、斷線代打）同一套，檔名多一個 `_g`：
  ‧ `<國>_g.webp`                          96×96　名牌
  ‧ `<國>_g_war1.webp`／`_g_war2.webp`／`_g_big.webp`  512×512 出征三格
  來源：`assets/portraits/<國>_general.png`、`assets/portraits/gwar/<國>_{1,2,3}.png`

  打完勝仗的平靜姿勢（結算框：先播出征三格，再停在這張）：
  ‧ `<國>_calm.webp`／`<國>_g_calm.webp`  512×512
  來源：主公 `assets/portraits/<國>_lord_calm.png`（有的話，目前只有趙）或 `<國>_lord_act.png`（先前的單張動作圖）、
        守將 `assets/portraits/<國>_general_calm.png`

── 為什麼大圖是 512 不是 384 ──
開場動畫的對打畫面會把主公放到 min(51vh, 42vw)，大螢幕上約 500px；
牌桌中央最大 380px（layout.js 的 lord.maxW）。384 在這兩處都會被放大而糊掉。

── ⚠️ 一定要保留透明度 ──
舊版的原圖是白底，這支腳本以前做 `convert('RGB')`；新圖是透明背景，
照舊轉 RGB 的話透明的地方會變成黑色，中央大圖放在牌桌上會是一塊黑方框。

舊的原圖（`assets/<國>_2.jpg`、`_3.png`）留著沒刪，但已經不再使用。
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    print('需要 Pillow：pip3 install Pillow', file=sys.stderr)
    sys.exit(1)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets', 'portraits')
OUT = os.path.join(ROOT, 'assets', 'avatar')

KINGDOMS = ['qi', 'chu', 'yan', 'han', 'wei', 'zhao', 'qin']
SMALL, BUST, BIG = 96, 384, 512


def square(img):
    """置中補成正方形（補透明，不裁切 —— 裁切會切掉劍氣、旗子）。"""
    w, h = img.size
    if w == h:
        return img
    side = max(w, h)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(img, ((side - w) // 2, (side - h) // 2))
    return out


def build(src, out_name, size):
    if not os.path.exists(src):
        return None
    img = square(Image.open(src).convert('RGBA')).resize((size, size), Image.LANCZOS)
    dst = os.path.join(OUT, out_name)
    # RGBA 存 WebP 會保留 alpha。品質 80／透明度 70：2026-09-23 放大兩倍比過，
    # 跟 86／100 看不出差別，檔案小三成（每格 90 → 59 KB）；74／60 劍氣就開始糊
    img.save(dst, 'WEBP', quality=80, alpha_quality=70, method=6)
    return os.path.getsize(dst)


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    missing = []
    for k in KINGDOMS:
        sizes = [
            build(os.path.join(SRC, f'{k}_lord.png'), f'{k}.webp', SMALL),
            build(os.path.join(SRC, f'{k}_lord.png'), f'{k}_bust.webp', BUST),
            build(os.path.join(SRC, 'war', f'{k}_1.png'), f'{k}_war1.webp', BIG),
            build(os.path.join(SRC, 'war', f'{k}_2.png'), f'{k}_war2.webp', BIG),
            build(os.path.join(SRC, 'war', f'{k}_3.png'), f'{k}_big.webp', BIG),
        ]
        # 守將
        sizes += [
            build(os.path.join(SRC, f'{k}_general.png'), f'{k}_g.webp', SMALL),
            build(os.path.join(SRC, 'gwar', f'{k}_1.png'), f'{k}_g_war1.webp', BIG),
            build(os.path.join(SRC, 'gwar', f'{k}_2.png'), f'{k}_g_war2.webp', BIG),
            build(os.path.join(SRC, 'gwar', f'{k}_3.png'), f'{k}_g_big.webp', BIG),
        ]
        sizes += [
            # 專門畫的平靜姿勢優先；沒有就沿用先前的單張動作圖。
            # 趙武靈王的單張動作圖是騎馬拉弓，跟出征第三格幾乎一樣、不算平靜，所以另外補畫了一張
            build(next((q for q in (os.path.join(SRC, f'{k}_lord_calm.png'), os.path.join(SRC, f'{k}_lord_act.png'))
                        if os.path.exists(q)), ''), f'{k}_calm.webp', BIG),
            build(os.path.join(SRC, f'{k}_general_calm.png'), f'{k}_g_calm.webp', BIG),
        ]
        if None in sizes:
            missing.append(k)
        total += sum(s or 0 for s in sizes)
        print(f'  {k:<5} 名牌 {(sizes[0] or 0)/1024:4.1f} KB　半身 {(sizes[1] or 0)/1024:5.1f} KB　'
              f'三格 {sum((s or 0) for s in sizes[2:5])/1024:6.1f} KB　'
              f'守將 {sum((s or 0) for s in sizes[5:9])/1024:6.1f} KB　'
              f'平靜 {sum((s or 0) for s in sizes[9:])/1024:5.1f} KB')
    print(f'\n合計 {total/1024:.0f} KB → assets/avatar/')
    if missing:
        print('⚠️ 缺圖：' + '、'.join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
