#!/usr/bin/env python3
"""從舊版單檔抽出音效（SFX）與程序化背景音樂（BGM），產生 `src/audio.js`。

    python3 tools/build-audio.py

跟 `build-rules-core.py` 同一個路數：**不要手改產出的 `src/audio.js`**，
要改請改這支產生器，這樣舊版更新時可以重跑。

── 為什麼可以整段搬 ──
這兩個區塊是全專案封裝得最乾淨的地方（PLAN：「唯二封裝是 SFX 和 BGM 兩個 IIFE」）。
實測：零個 `G.`、零個 `document.`，只有 4 處 `window.`（都是 AudioContext）。
也就是說它們不依賴遊戲狀態，也不依賴 DOM —— 換成四人版完全不用改。

而且**沒有任何音檔**：八個場景 + 七國專屬曲全部是 Web Audio 即時合成的，
所以搬過來一個位元組的資產都不用帶。
"""
import io
import os
import re
import sys

SRC = os.path.expanduser('~/Documents/DILA/麻將戰國列傳/戰國麻將列傳.html')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'src', 'audio.js')

HEADER = '''/* ═══════════════════════════════════════════════════════════════
   audio.js — 音效與程序化背景音樂
   ───────────────────────────────────────────────────────────────
   ⚠️ 這個檔由 `tools/build-audio.py` 從舊版單檔自動產生，**不要手改**。
      要改請改產生器，這樣舊版更新時可以重跑。

   SFX：{sfx_lines} 行　BGM：{bgm_lines} 行（來源 L{sfx_start}–{sfx_end} / L{bgm_start}–{bgm_end}）

   兩個區塊原樣搬過來，一行沒改 —— 它們是全專案封裝得最乾淨的地方：
   零個 `G.`、零個 `document.`，只有 AudioContext。不依賴遊戲狀態也不依賴 DOM，
   所以兩人版換四人版完全不用動。

   **沒有任何音檔。** 八個場景 + 七國專屬曲全是 Web Audio 即時合成，
   搬過來一個位元組的資產都不用帶。

   ── 瀏覽器的自動播放限制 ──
   AudioContext 必須在使用者手勢之後才能啟動。呼叫端要在第一次點擊／按鍵時
   叫一次 `resume()`，否則靜悄悄什麼都不會響（不會報錯，很難查）。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {{
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {{ root.MJAudio = api; root.SFX = api.SFX; root.BGM = api.BGM; }}
}})(typeof globalThis !== 'undefined' ? globalThis : this, function () {{
'use strict';

'''

FOOTER = '''

/* 讓呼叫端在第一次使用者手勢時喚醒 AudioContext。
   瀏覽器的自動播放限制：手勢之前 AudioContext 會停在 suspended，
   所有聲音都不會響，而且**不會報任何錯**。 */
function resume() {
  const ctxs = [];
  try { if (typeof _actx !== 'undefined' && _actx) ctxs.push(_actx); } catch (e) {}
  try { if (typeof actx !== 'undefined' && actx) ctxs.push(actx); } catch (e) {}
  ctxs.forEach(c => { if (c.state === 'suspended' && c.resume) c.resume().catch(() => {}); });
  return ctxs.length;
}

return { SFX, BGM, resume };
});
'''


def block_end(lines, start_idx):
    """從 start_idx（0-based）起，用花括號平衡找出這個區塊的最後一行。"""
    depth = 0
    started = False
    for i in range(start_idx, len(lines)):
        for ch in lines[i]:
            if ch == '{':
                depth += 1
                started = True
            elif ch == '}':
                depth -= 1
        if started and depth == 0:
            return i
    return None


def main():
    if not os.path.exists(SRC):
        print(f'找不到來源：{SRC}', file=sys.stderr)
        return 1

    # 濾掉 base64 長行（跟 CLAUDE.md 講的一樣，不要把 12 MB 讀進記憶體處理）
    lines = []
    with io.open(SRC, encoding='utf-8') as f:
        for line in f:
            lines.append('' if len(line) > 4000 else line.rstrip('\n'))

    blocks = {}
    for name in ('SFX', 'BGM'):
        pat = re.compile(r'^\s*const\s+' + name + r'\s*=\s*\(')
        start = next((i for i, l in enumerate(lines) if pat.match(l)), None)
        if start is None:
            print(f'找不到 {name} 的起點', file=sys.stderr)
            return 1
        end = block_end(lines, start)
        if end is None:
            print(f'{name} 的花括號不平衡，來源可能改過', file=sys.stderr)
            return 1
        body = '\n'.join(lines[start:end + 1])
        if '/9j/' in body or 'base64' in body:
            print(f'{name} 區段內出現 base64，抽取範圍可能不對', file=sys.stderr)
            return 1
        blocks[name] = (start + 1, end + 1, body)

    hdr = HEADER.format(
        sfx_start=blocks['SFX'][0], sfx_end=blocks['SFX'][1],
        bgm_start=blocks['BGM'][0], bgm_end=blocks['BGM'][1],
        sfx_lines=blocks['SFX'][1] - blocks['SFX'][0] + 1,
        bgm_lines=blocks['BGM'][1] - blocks['BGM'][0] + 1,
    )
    out = hdr + blocks['SFX'][2] + '\n\n' + blocks['BGM'][2] + FOOTER

    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write(out)

    n = out.count('\n') + 1
    print(f'產生 src/audio.js（{n} 行）')
    print(f"  SFX  來源 L{blocks['SFX'][0]}–{blocks['SFX'][1]}")
    print(f"  BGM  來源 L{blocks['BGM'][0]}–{blocks['BGM'][1]}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
