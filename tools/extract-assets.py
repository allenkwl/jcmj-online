#!/usr/bin/env python3
"""把舊版單檔裡的 base64 圖片抽成獨立檔案。

    python3 tools/extract-assets.py

來源：`~/Documents/DILA/麻將戰國列傳/戰國麻將列傳.html`（只讀，絕不寫入）
輸出：`assets/` 底下的圖檔 + `assets/manifest.json`

── 為什麼要抽出來 ──
舊版 12.3 MB 裡有 11.1 MB 是 base64 圖。四人線上版四個人都要載完才能開局，
行動網路上會很痛（PLAN 階段四第 20 項）。抽成獨立檔之後：
  ‧ 瀏覽器可以快取、可以平行下載、可以延後載入背景圖
  ‧ 主檔回到幾百 KB，改一次版面不用等半天

── 一個發現 ──
**牌面圖其實很小**（27 個 B64_ 變數，每張 4–8 KB，合計約 200 KB），
11 MB 全是背景圖（標題、選國、七國君主、勝利、敗亡）。
所以牌面可以照常內嵌或立刻載入，背景才需要延後。

── 另一個發現 ──
舊版一律寫 `data:image/png;base64,`，但資料開頭是 `/9j/` —— 那是 **JPEG**。
瀏覽器會自己嗅探所以看不出問題。這裡依實際位元組決定副檔名。
"""
import base64
import io
import json
import os
import re
import sys

SRC = os.path.expanduser('~/Documents/DILA/麻將戰國列傳/戰國麻將列傳.html')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')

# 至少這麼長才當成圖片，免得把短字串誤判
MIN_LEN = 400


def sniff(data: bytes) -> str:
    if data[:3] == b'\xff\xd8\xff':
        return 'jpg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    if data[:5] == b'<?xml' or data[:4] == b'<svg':
        return 'svg'
    return 'bin'


def clean_name(s: str) -> str:
    s = re.sub(r'^B64_', '', s)
    s = re.sub(r'[^0-9A-Za-z一-鿿_-]', '_', s)
    return s.strip('_').lower() or 'asset'


def find_name(line: str, col: int) -> str:
    """從 base64 出現的位置往前找，猜這張圖叫什麼。"""
    before = line[:col]
    # const B64_TONG1 = "...."        → tong1
    m = re.findall(r'\b(B64_[A-Za-z0-9_一-鿿]+)\s*=\s*["\']?$', before)
    if m:
        return clean_name(m[-1])
    # qin: "data:..."  /  'qin': "data:..."
    m = re.findall(r'["\']?([A-Za-z0-9_一-鿿]+)["\']?\s*:\s*["\']?$', before)
    if m and len(m[-1]) <= 24:
        return clean_name(m[-1])
    # id="vic-bg-qin" … url(data:…)   → 取最後一個 id
    m = re.findall(r'id\s*=\s*["\']([^"\']+)["\']', before)
    if m:
        return clean_name(m[-1])
    return ''


def main():
    if not os.path.exists(SRC):
        print(f'找不到來源：{SRC}', file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)

    # 兩種形狀：完整的 data URI，或裸的 base64（舊版的 B64_* 變數是裸的）
    data_uri = re.compile(r'data:(image/[a-z.+-]+);base64,([A-Za-z0-9+/=]{%d,})' % MIN_LEN)
    bare = re.compile(r'\bB64_[A-Za-z0-9_一-鿿]+\s*=\s*["\']([A-Za-z0-9+/=]{%d,})' % MIN_LEN)

    manifest = {}
    used = set()
    total = 0
    n = 0

    with io.open(SRC, encoding='utf-8') as f:
        for lineno, line in enumerate(f, 1):
            hits = [(m.start(), m.group(2), m.group(1)) for m in data_uri.finditer(line)]
            hits += [(m.start(1), m.group(1), None) for m in bare.finditer(line)]
            for col, b64, declared in sorted(hits):
                try:
                    raw = base64.b64decode(b64, validate=False)
                except Exception:
                    continue
                if len(raw) < 200:
                    continue
                name = find_name(line, col) or f'asset_l{lineno}'
                base = name
                k = 2
                while name in used:
                    name = f'{base}_{k}'
                    k += 1
                used.add(name)

                ext = sniff(raw)
                fn = f'{name}.{ext}'
                with open(os.path.join(OUT, fn), 'wb') as out:
                    out.write(raw)
                manifest[name] = {
                    'file': fn,
                    'bytes': len(raw),
                    'line': lineno,
                    'declaredType': declared,      # 舊版宣告的（常常是錯的）
                    'actualType': ext,
                }
                total += len(raw)
                n += 1

    with io.open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2, sort_keys=True)

    # 同一份資料再寫成一支 .js。
    # 為什麼要兩份：`fetch()` 在 file:// 底下會被 CORS 擋，
    # 那是整個專案**唯一**需要伺服器的理由。寫成 script 就沒這個限制，
    # 直接雙擊 mj4.html 也能跑。.json 留著給工具與 /api 用。
    with io.open(os.path.join(OUT, 'manifest.js'), 'w', encoding='utf-8') as f:
        f.write('/* 由 tools/extract-assets.py 產生，不要手改。\n'
                '   跟 manifest.json 是同一份資料 —— 這一份是給瀏覽器直接 <script> 載的，\n'
                '   因為 fetch() 在 file:// 底下會被 CORS 擋。 */\n')
        f.write('window.MJ_ASSET_MANIFEST = ')
        json.dump(manifest, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write(';\n')

    print(f'抽出 {n} 個資產，合計 {total / 1024 / 1024:.2f} MB → assets/')
    mism = [k for k, v in manifest.items()
            if v['declaredType'] and not v['declaredType'].endswith(v['actualType'])]
    if mism:
        print(f'⚠️ {len(mism)} 個的宣告型別與實際位元組不符（舊版都寫 png，其實是 jpg）')
    big = sorted(manifest.items(), key=lambda kv: -kv[1]['bytes'])[:8]
    print('\n最大的幾個：')
    for k, v in big:
        print(f'  {k:<24} {v["bytes"]/1024:8.0f} KB  {v["actualType"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
