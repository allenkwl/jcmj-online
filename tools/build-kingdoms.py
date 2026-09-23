#!/usr/bin/env python3
"""從舊版抽出七國資料，產生 `src/kingdoms.js`。

    python3 tools/build-kingdoms.py

**不要手改產出的 `src/kingdoms.js`**，要改請改這支產生器。

只抽 `KINGDOMS`（國家的基本資料）。技能不抽 —— 七國技能已經在
`docs/skill-conflicts.md` 第六節重新設計過，四人版的係數在 `src/scoring.js`，
把舊版那份抽過來只會變成兩份互相矛盾的真相。
"""
import io, os, re, sys

SRC = os.path.expanduser('~/Documents/DILA/麻將戰國列傳/戰國麻將列傳.html')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'kingdoms.js')

HEADER = '''/* ═══════════════════════════════════════════════════════════════
   kingdoms.js — 七國資料
   ───────────────────────────────────────────────────────────────
   ⚠️ 由 `tools/build-kingdoms.py` 從舊版抽出，**不要手改**。

   只有國家的基本資料（id／名稱／君主／顏色／戰力）。
   **技能不在這裡** —— 七國技能已在 `docs/skill-conflicts.md` 第六節
   重新設計過，四人版的係數在 `src/scoring.js` 的 QI_PAY / CHU_WIN / QIN_SPEC。
   舊版的 KINGDOM_SKILLS 若也抽過來，就會有兩份互相矛盾的真相。

   頭像：`assets/avatar/<id>.webp`（小）與 `<id>_big.webp`（大），
   由 `tools/build-avatars.py` 從舊版的 KING_AVATARS / KING_AVATARS_ACTION 壓出來。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJKingdoms = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const KINGDOMS = '''

FOOTER = ''';

const BY_ID = {};
const BY_CHAR = {};
KINGDOMS.forEach(k => { BY_ID[k.id] = k; BY_CHAR[k.char] = k; });

/* 吃得下 'qin' 也吃得下 '秦' —— 畫面層用漢字、狀態層用 id，兩邊都會傳進來 */
function get(idOrChar) {
  if (!idOrChar) return null;
  return BY_ID[idOrChar] || BY_CHAR[idOrChar] || null;
}
function avatarUrl(idOrChar, big) {
  const k = get(idOrChar);
  return k ? 'assets/avatar/' + k.id + (big ? '_big' : '') + '.webp' : null;
}

return { KINGDOMS, get, avatarUrl, BY_ID, BY_CHAR };
});
'''

def main():
    if not os.path.exists(SRC):
        print(f'找不到來源：{SRC}', file=sys.stderr); return 1
    lines = []
    with io.open(SRC, encoding='utf-8') as f:
        for line in f:
            lines.append('' if len(line) > 4000 else line.rstrip('\n'))
    start = next((i for i,l in enumerate(lines) if re.match(r'^\s*const\s+KINGDOMS\s*=\s*\[', l)), None)
    if start is None:
        print('找不到 KINGDOMS', file=sys.stderr); return 1
    end = next((i for i in range(start, len(lines)) if lines[i].rstrip().endswith('];')), None)
    if end is None:
        print('KINGDOMS 沒有結尾', file=sys.stderr); return 1
    body = '\n'.join(lines[start:end+1])
    body = re.sub(r'^\s*const\s+KINGDOMS\s*=\s*', '', body).rstrip()
    if body.endswith(';'): body = body[:-1]
    if 'base64' in body:
        print('KINGDOMS 區段內出現 base64，抽取範圍不對', file=sys.stderr); return 1
    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write(HEADER + body + FOOTER)
    print(f'產生 src/kingdoms.js（來源 L{start+1}–{end+1}）')
    return 0

if __name__ == '__main__':
    sys.exit(main())
