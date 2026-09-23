#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""戰役長度模擬 —— 一場四局的土地分配，要多久才統一天下。

   為什麼需要這支：四人局每人只有 25% 拿第一。「只有第一名前進」聽起來公道，
   但前進速度就等於拿第一的機率 —— 而那正是弱玩家最缺的東西。
   實測墊底 70% 的玩家要 1199 手牌（約 30 小時）才統一，等於永遠到不了。
   這種事用想的想不出來，要跑。

   執行：python3 tools/sim-campaign.py
"""
import random

UNIFY = 7          # 本國 + 征服六國 = 七國統一
TRIALS = 20000
CAP = 20000        # 防呆：期望值太低的方案會跑不完
NORMAL = [0.25] * 4

# 名次機率 [第一, 第二, 第三, 第四]。四人局實力相當時是均勻的，
# 弱玩家則往第四名傾斜 —— 這才是設計上真正要照顧的對象。
PROFILES = [
    ('高手  墊底15%', [.40, .30, .15, .15]),
    ('普通  墊底25%', [.25, .25, .25, .25]),
    ('弱    墊底40%', [.10, .20, .30, .40]),
    ('很弱  墊底55%', [.05, .15, .25, .55]),
    ('超弱  墊底70%', [.02, .08, .20, .70]),
]

PLANS = [
    ('★ 定案：+1 / +1 / +1 / 0', [1, 1, 1, 0]),
    ('  +2 / +1 / +1 / 0',       [2, 1, 1, 0]),
    ('  只有第一名 +1',           [1, 0, 0, 0]),
    ('  第一名+1、第四名-1',       [1, 0, 0, -1]),
]

def blend(p, lam):
    """追趕機制：連敗之後提高特殊牌型機率，名次分布往「普通」靠 lam 的比例。"""
    return [a * (1 - lam) + b * lam for a, b in zip(p, NORMAL)]

def pick(p):
    r, c = random.random(), 0
    for i, q in enumerate(p):
        c += q
        if r <= c:
            return i
    return 3

def run(gain, base, lam=0.0, need=2):
    """need 場連續墊底之後啟動追趕，不再墊底就關掉。
       土地不會少於一國（本國是技能來源）。"""
    boosted = blend(base, lam)
    total = 0
    for _ in range(TRIALS):
        land, matches, streak = 1, 0, 0
        while land < UNIFY and matches < CAP:
            matches += 1
            i = pick(boosted if streak >= need else base)
            streak = streak + 1 if i == 3 else 0
            land = max(1, land + gain[i])
        total += matches
    return total / TRIALS

if __name__ == '__main__':
    for name, g in PLANS:
        print(f'\n■ {name}')
        print(f"  {'玩家程度':14}{'統一需幾場':>11}{'≈手牌':>8}{'＋追趕機制':>12}{'≈手牌':>8}")
        for pn, pr in PROFILES:
            a, b = run(g, pr, 0.0), run(g, pr, 0.5)
            print(f'  {pn:14}{a:11.1f}{a * 4:8.0f}{b:12.1f}{b * 4:8.0f}')
    print('\n定案理由見 docs/campaign.md 第三節')
