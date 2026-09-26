#!/usr/bin/env python3
"""Firebase 資料庫的垃圾比對與清除（戰國麻將連線版，專案 jcmj-4p）。

    python3 tools/db-janitor.py            # 只列出來，不刪（預設）
    python3 tools/db-janitor.py --apply    # 列出來並刪掉「確定是垃圾」的那些

用本機已登入的 firebase CLI（管理員權限，不受資料庫規則限制）讀整個資料庫比對。
2026-09-26 使用者：「有沒有機制可以比對清除這些垃圾？不知道之後會不會有遺漏的規則產生垃圾？」

── 什麼算垃圾（會刪）──
  1. 每一桌的附屬資料（states、hands、secret、cmds…），但那一桌（/groups/{桌}）已經不在了
     —— 麻將的存檔在各人手機裡，重開同名的桌會開新的一場，這些留著沒有用
  2. 過期的空桌：/groups/{桌} 沒有任何成員，而且超過時限（跟 net.js 的 isStale 同一套門檻）
  3. 戰役成員名單 /camps/{戰役} 裡每一位都退出了（或一個人都沒有）—— 照理 markQuit 會自己收掉，這裡是補漏

── 不刪、只列出來 ──
  4. **程式不認得的頂層路徑**：不在 net.js 的 GROUP_NODES、也不是 camps。
     之後多了一種資料卻忘了清，就會出現在這裡 —— 看到了再決定要不要把它加進清除的名單。

哪些是「每一桌的附屬資料」直接讀 src/net.js 的 GROUP_NODES（程式也是照那份清），
多一棵資料樹只要改那裡，這支工具會自己跟上。
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PROJECT = 'jcmj-4p'
STALE_WAITING_MS = 60 * 60 * 1000        # net.js：等人中的桌 1 小時
STALE_PLAYING_MS = 12 * 60 * 60 * 1000   # net.js：進行中的桌 12 小時
GLOBAL_NODES = {'groups', 'camps'}       # 不是「每一桌一份」的頂層資料


def group_nodes():
    src = open(os.path.join(ROOT, 'src', 'net.js'), encoding='utf-8').read()
    m = re.search(r'GROUP_NODES:\s*\[([^\]]*)\]', src)
    if not m:
        sys.exit('讀不到 src/net.js 的 GROUP_NODES')
    return [x for x in re.findall(r"'([^']+)'", m.group(1)) if x != 'groups']


def fb(*args):
    r = subprocess.run(['firebase', *args, '--project', PROJECT], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('firebase ' + ' '.join(args) + ' 失敗：\n' + (r.stderr or r.stdout))
    return r.stdout


def get(path, shallow=False):
    out = fb('database:get', path, *(['--shallow'] if shallow else []))
    return json.loads(out) if out.strip() else None


def main():
    apply = '--apply' in sys.argv
    per_group = group_nodes()
    top = get('/', shallow=True) or {}
    groups = get('/groups') or {}
    now = int(time.time() * 1000)

    trash = []          # (路徑, 理由)
    unknown = []

    # 2. 過期的空桌
    alive = set()
    for key, g in groups.items():
        g = g or {}
        members = g.get('members') or {}
        created = g.get('createdAt') or 0
        limit = STALE_PLAYING_MS if g.get('status') in ('playing', 'started') else STALE_WAITING_MS
        if not members and created and now - created > limit:
            trash.append(('groups/' + key, '過期的空桌（%d 小時前開的，沒有人在）' % ((now - created) // 3600000)))
        else:
            alive.add(key)

    # 1. 桌已經不在的附屬資料
    for node in sorted(top):
        if node in GLOBAL_NODES:
            continue
        if node not in per_group:
            unknown.append(node)
            continue
        keys = get('/' + node, shallow=True) or {}
        for k in sorted(keys):
            if k not in alive:
                trash.append((node + '/' + k, '這一桌已經不在了'))

    # 3. 全部人都退出的戰役成員名單
    camps = get('/camps') if 'camps' in top else {}
    for cid, c in (camps or {}).items():
        members = (c or {}).get('members') or {}
        if not members or all((m or {}).get('quit') for m in members.values()):
            trash.append(('camps/' + cid, '成員全部退出了（或一個人都沒有）'))

    # ── 報告 ──
    print('頂層：' + '、'.join(sorted(top)) if top else '資料庫是空的')
    print('還在的桌：' + ('、'.join(sorted(alive)) if alive else '（沒有）'))
    print()
    if trash:
        print('垃圾 %d 筆：' % len(trash))
        for p, why in trash:
            print('  ✗ %-40s %s' % (p, why))
    else:
        print('沒有垃圾 ✓')
    if unknown:
        print()
        print('⚠️ 程式不認得的頂層路徑（不會刪，請確認是不是漏清的新資料）：')
        for n in unknown:
            print('  ? ' + n)

    if not trash:
        return 0
    if not apply:
        print('\n（只列出來。確定要刪就加 --apply）')
        return 0

    # 一次多路徑更新（寫 null＝刪除），要嘛全部成功、要嘛全部不動
    up = {p: None for p, _ in trash}
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(up, f, ensure_ascii=False)
        tmp = f.name
    try:
        fb('database:update', '/', tmp, '--force')
    finally:
        os.unlink(tmp)
    print('\n已刪除 %d 筆 ✓' % len(trash))
    return 0


if __name__ == '__main__':
    sys.exit(main())
