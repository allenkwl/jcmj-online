#!/usr/bin/env python3
"""擇國而立的背景：七位主公站成一排，合成到一張沒有人物的戰國場景上。

    python3 tools/build-select-bg.py [--preview]

來源（Codex 生的，提示詞在 assets/portraits/prompts/）：
  assets/portraits/prompts/select_bg.png          場景（不含人物）
  assets/portraits/prompts/<國>_lord_stand.png    七位主公的全身站姿（透明背景，各附自己的半身像當參考）
輸出：assets/table/select_lords.webp

── 為什麼分開畫再合成（2026-09-25）──
  ‧ 一張圖裡畫七個人要附七張參考圖，臉會互相混掉（田忌被畫成齊威王那次的教訓）。
    分開畫時每個人只附**他自己的**半身像，才是「同一個人換動作」。
  ‧ 位置要能控制：臉得落在卡片蓋不到的那一帶（見下面 FACE_Y），左到右照卡片順序
    齊楚燕韓魏趙秦，每位主公站在自己那張卡片的上方。
  ‧ 開場動畫第二幕（七雄列陣）用的是舊的 select.webp，上面已經疊了七個圓頭像，所以不動它。

── 版面（背景是 3:2，畫面用 background: center/cover）──
  ‧ 電腦（4:3、16:10）：高度撐滿、左右各裁掉約 5%，卡片在畫面 80% 以下 → 人物放中段
  ‧ 手機橫放（約 2.16:1）：寬度撐滿、上下裁掉；卡片蓋住畫面 36%～77%，
    所以手機的背景改成 background-position: center 85%（見主程式 #sel-screen 的 CSS），
    臉要在圖的 41%～48% 高度之間才不被蓋到 → FACE_Y 取 0.44
"""
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print('需要 Pillow：pip3 install Pillow', file=sys.stderr)
    sys.exit(1)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets', 'portraits', 'prompts')
OUT = os.path.join(ROOT, 'assets', 'table', 'select_lords.webp')

ORDER = ['qi', 'chu', 'yan', 'han', 'wei', 'zhao', 'qin']   # 跟選國卡片同一個順序
W, H = 1536, 1024
FIG_H = 0.35      # 每位主公（裁掉透明邊之後）的高度，佔整張圖的比例
FACE_Y = 0.44     # 臉的中心要落在的高度（頭約佔身高一半 → 臉心約在頭頂往下 1/4 身高）
# 場景裡七面國色旗的位置（量 select_bg.png 的旗面顏色得來，黑旗目測），每位主公站在自己的旗前。
# 往中間收 8%：電腦 4:3 左右各裁掉約 5.5%，最外側兩位不收的話會被切掉半個人
BANNERS = [0.102, 0.243, 0.370, 0.514, 0.656, 0.807, 0.927]
PULL_IN = 0.92


def trim(im):
    bb = im.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
    return im.crop(bb) if bb else im


def cover(im, w, h):
    """等比放大到蓋滿 w×h，置中裁切。"""
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def main():
    bg = Image.open(os.path.join(SRC, 'select_bg.png')).convert('RGBA')
    bg = cover(bg, W, H)

    fh = round(H * FIG_H)
    top = round(H * FACE_Y - fh * 0.25)          # 頭頂
    feet = top + fh
    xs = [0.5 + (b - 0.5) * PULL_IN for b in BANNERS]

    shadows = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    figs = []
    for k, cx in zip(ORDER, xs):
        im = trim(Image.open(os.path.join(SRC, k + '_lord_stand.png')).convert('RGBA'))
        s = fh / im.height
        im = im.resize((round(im.width * s), fh), Image.LANCZOS)
        x = round(W * cx - im.width / 2)
        figs.append((im, x))
        # 腳下的影子：扁橢圓、模糊，讓人站在地上而不是浮著
        d = ImageDraw.Draw(shadows)
        sw = im.width * 0.62
        d.ellipse((W * cx - sw / 2, feet - fh * 0.035, W * cx + sw / 2, feet + fh * 0.035), fill=(20, 10, 0, 120))
    shadows = shadows.filter(ImageFilter.GaussianBlur(6))
    bg = Image.alpha_composite(bg, shadows)
    # 由左往右畫：右邊的蓋在左邊上面。試過「由外往內」，結果趙武靈王的貂尾蓋住秦王的肩膀
    for im, x in figs:
        bg.alpha_composite(im, (x, top))

    out = bg.convert('RGB')
    out.save(OUT, 'WEBP', quality=86, method=6)
    print(f'→ {os.path.relpath(OUT, ROOT)}  {out.size[0]}×{out.size[1]}  {os.path.getsize(OUT) // 1024} KB'
          f'  （人物高 {fh}px，頭頂 {top / H:.0%}，腳底 {feet / H:.0%}）')
    if '--preview' in sys.argv:
        out.save(os.path.join(SRC, 'select_preview.png'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
