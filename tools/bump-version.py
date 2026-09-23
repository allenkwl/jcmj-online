#!/usr/bin/env python3
"""改版：版號 +0.01、另存新檔、更新 latest.json。

    python3 tools/bump-version.py          ← v1.00 → v1.01
    python3 tools/bump-version.py --dry    ← 只說會做什麼

── 規則（2026-09-24 使用者定的，比照小球貓電鐵）──
  ‧ 遊戲本體的檔名帶版號：戰國麻將線上v1.00.html、v1.01.html……
  ‧ 每次改版 **+0.01 另存新檔**，舊版留著不刪（線上已發布過的版本不能消失）
  ‧ 改的永遠是**最新那一份**；latest.json 記著現在最新是哪一個檔
  ‧ 入口頁 index.html、對戰畫面編輯器、開發伺服器都讀 latest.json，不寫死版號

── 這支做的事 ──
  1. 讀 latest.json 找到目前最新版
  2. 複製成下一版的檔名
  3. 把新檔 <title> 裡的版號改掉（遊戲畫面左下角的 Ver 就是讀 <title>）
  4. latest.json 改指新檔

⚠️ 檔名不要用「戰國麻將列傳.html」—— 那會觸發舊兩人版的自動部署（見 CLAUDE.md）。
"""
import io
import json
import os
import re
import shutil
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PREFIX = '戰國麻將線上v'


def main():
    dry = '--dry' in sys.argv
    with io.open(os.path.join(ROOT, 'latest.json'), encoding='utf-8') as f:
        cur = json.load(f)['file']
    m = re.fullmatch(re.escape(PREFIX) + r'(\d+)\.(\d{2})\.html', cur)
    if not m:
        print(f'✗ latest.json 指的檔名看不懂：{cur}', file=sys.stderr)
        return 1
    major, minor = int(m.group(1)), int(m.group(2)) + 1
    if minor >= 100:
        major, minor = major + 1, 0
    old_v = f'{m.group(1)}.{m.group(2)}'
    new_v = f'{major}.{minor:02d}'
    new = f'{PREFIX}{new_v}.html'
    if os.path.exists(os.path.join(ROOT, new)):
        print(f'✗ {new} 已經存在，不覆蓋', file=sys.stderr)
        return 1

    with io.open(os.path.join(ROOT, cur), encoding='utf-8') as f:
        html = f.read()
    title_old = re.search(r'<title>[^<]*</title>', html)
    if not title_old or f'v{old_v}' not in title_old.group(0):
        print(f'✗ {cur} 的 <title> 裡找不到 v{old_v}，不敢動', file=sys.stderr)
        return 1
    title_new = title_old.group(0).replace(f'v{old_v}', f'v{new_v}')

    print(f'{cur}  →  {new}')
    print(f'  {title_old.group(0)}  →  {title_new}')
    if dry:
        return 0
    shutil.copy2(os.path.join(ROOT, cur), os.path.join(ROOT, new))
    with io.open(os.path.join(ROOT, new), 'w', encoding='utf-8') as f:
        f.write(html.replace(title_old.group(0), title_new, 1))
    with io.open(os.path.join(ROOT, 'latest.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps({'file': new}, ensure_ascii=False) + '\n')
    print('✓ latest.json 已改指新版。之後的修改請改在新檔上。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
