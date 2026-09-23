#!/usr/bin/env python3
"""
從單機兩人版抽出規則核心，產生 src/rules-core.js

用法：  python3 tools/build-rules-core.py

⚠️ 只讀取來源檔，絕不寫入。來源檔受自動部署 hook 監看，寫入會觸發線上部署。
"""
import re, sys, os

SRC = os.path.expanduser('~/Documents/DILA/麻將戰國列傳/戰國麻將列傳.html')
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'rules-core.js')

# 來源行號（1-indexed, inclusive）—— 來源檔若改動需重新確認
RANGES = {
    'SPECIAL_HANDS': (2223, 2355),   # 10 種特殊牌型，資料驅動
    'sortTileKeys':  (3684, 3697),
    'isGuoshi':      (3699, 3708),
    'meldStats':     (3714, 3721),
    'canWinInHand':  (3723, 3746),   # 含 canWinOnDiscard
    'canFPair_etc':  (3755, 3785),   # canFPair / canFNS / canWin14
    'findChi':       (3786, 3801),   # findChi / findAllChi
    'checkSpecial':  (3833, 3838),
    'shanten':       (4744, 4798),   # _shantenBest ~ shantenNum
}

def brace_balance(code):
    c = re.sub(r"'[^'\n]*'|\"[^\"\n]*\"|`[^`]*`", '', code)
    c = re.sub(r'//[^\n]*', '', c)
    return c.count('{') - c.count('}')

def main():
    lines = open(SRC, encoding='utf-8').read().split('\n')
    blocks = {}
    for name, (a, b) in RANGES.items():
        code = '\n'.join(lines[a-1:b])
        d = brace_balance(code)
        if d != 0:
            sys.exit(f'✗ {name} ({a}-{b}) 花括號不平衡：{d:+d}　來源檔行號可能已變動')
        blocks[name] = code
    print('所有區塊花括號平衡 ✓')

    header = HEADER
    body = '\n\n'.join(blocks[k] for k in
        ['SPECIAL_HANDS','sortTileKeys','isGuoshi','meldStats','canWinInHand',
         'canFPair_etc','findChi','checkSpecial','shanten'])
    out = header + body + '\n\n' + TENPAI + '\n' + NEW_CODE + EXPORTS

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(out)
    print(f'已寫入 {os.path.normpath(OUT)}：{len(out.splitlines())} 行')

# ───────────────────────────────────────────────────────────────
HEADER = '''/* ═══════════════════════════════════════════════════════════════
   rules-core.js — 戰國麻將列傳　規則核心
   ───────────────────────────────────────────────────────────────
   純函式：不碰 DOM、不讀全域狀態、不用亂數。
   可同時在瀏覽器（掛 window.MJRules）與 Node（require）執行。

   牌的資料結構： {suit, num, display, isHonor, uid}
     數牌 {suit:'萬', num:3, display:'3萬', isHonor:false}
     字牌 {suit:'東', num:0, display:'東',  isHonor:true}

   副露的資料結構： {type:'chi'|'pong'|'kong_light'|'kong_dark', tiles:[...]}

   ⚠️ 本檔由 tools/build-rules-core.py 從單機兩人版抽出，請勿手改。
      要改邏輯請改產生器，或把函式搬進「新增」區後從 RANGES 移除。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const SUITS  = ['萬','筒','條'];
const HONORS = ['東','南','西','北','中','發','白'];

/* 全部 34 種牌面，供聽牌／振聽列舉使用 */
const ALL_TILES = [
  ...SUITS.flatMap(s => Array.from({length:9}, (_, i) => `${i+1}${s}`)),
  ...HONORS,
];

/* ───────── 以下由原始檔抽出，邏輯未改 ───────── */

'''

TENPAI = '''/* isTenpaiHand —— 由原始檔抽出後移除 console.log 除錯，語意不變 */
function isTenpaiHand(hand, melds){
  if(!hand || !hand.length) return false;
  const {mS, kongCount} = _meldStats(melds);
  const baseSize = 13 - mS + kongCount;   // 棄牌後的張數
  const drawSize = 14 - mS + kongCount;   // 摸牌後的張數
  const getDisp = arr => arr.map(x => (typeof x === 'string' ? x : x.display));
  const mc = melds.length;

  if(hand.length === baseSize){
    return shantenNum(getDisp(hand), mc) <= 0;
  }
  if(hand.length === drawSize){
    // 摸牌後：只要存在一張可打出使其聽牌，即視為聽牌
    return hand.some((_, i) =>
      shantenNum(getDisp(hand.filter((_, j) => j !== i)), mc) <= 0);
  }
  // 張數異常時的保底判斷
  if(shantenNum(getDisp(hand), mc) <= 0) return true;
  return hand.some((_, i) =>
    shantenNum(getDisp(hand.filter((_, j) => j !== i)), mc) <= 0);
}'''

NEW_CODE = '''

/* ═══════════════════════════════════════════════════════════════
   以下為四人線上版新增
   ═══════════════════════════════════════════════════════════════ */

/* ── 和牌張列舉 ──────────────────────────────────────────────
   回傳這手牌所有可以和的牌面（display 字串陣列）。
   取代原始檔的 findNeeded13(hand)，把寫死的 G.pM 改成參數。

   與原版的差異：原版在「六對子」的情況下會 early-return 只給七對子聽張，
   略過標準型聽張。這裡改成兩者聯集（見 test/rules-core.test.js 的對照測試）。 */
function winningTiles(hand, melds){
  const meldCount = melds.length;
  const disp = hand.map(x => (typeof x === 'string' ? x : x.display));
  const waits = new Set();

  // 標準型 / 國士 / 七對子（canWin14 已涵蓋七對子）
  for(const td of ALL_TILES){
    const test = [...disp, td];
    if(meldCount === 0){
      if(isGuoshi(test) || canWin14(test)) waits.add(td);
    } else {
      if(canFPair(test, 4 - meldCount)) waits.add(td);
    }
  }

  // 七對子補強：六對＋一孤張時，孤張的第二張即為聽牌
  if(meldCount === 0){
    const C = {};
    disp.forEach(d => C[d] = (C[d] || 0) + 1);
    if(Object.values(C).filter(v => v >= 2).length === 6){
      ALL_TILES.forEach(td => { if((C[td] || 0) === 1) waits.add(td); });
    }
  }

  return [...waits];
}

/* ── 振聽（フリテン）────────────────────────────────────────
   原始的兩人版完全沒有這條規則，四人版必須補上，理由有二：

   1. 玩家端的規則漏洞 —— 沒有振聽的話，可以故意打掉自己的和牌張，
      之後再等別人打出來榮和。
   2. AI 的正當防守 —— 「現物」（某家自己打過的牌，那家不能榮和）
      是人類玩家最可靠的安全牌情報。沒有振聽，AI 就只能靠偷看手牌，
      而那正是四人版要拿掉的東西。

   實作兩種，兩者都不影響自摸：
   ‧ 捨牌振聽（永久）：自己的棄牌堆含有任一和牌張 → 整局不能榮和
   ‧ 同巡振聽（暫時）：本巡放過一次可以和的牌 → 到自己下次摸牌前不能榮和
     （由流程層在放過時設 options.temporary，摸牌時清除）            */
function isFuriten(hand, melds, ownDiscards, options){
  if(options && options.temporary) return true;
  const waits = new Set(winningTiles(hand, melds));
  if(!waits.size) return false;
  return (ownDiscards || []).some(t =>
    waits.has(typeof t === 'string' ? t : t.display));
}

/* ── 榮和判定（含振聽）──────────────────────────────────────
   取代原始檔中直接讀 G 的 canRon() / canOppWin() 兩個包裝。
   ownDiscards 傳空陣列即等同舊行為（不檢查振聽）。                */
function canRonWith(hand, melds, tile, ownDiscards, options){
  if(!canWinOnDiscard(hand, melds, tile)) return false;
  return !isFuriten(hand, melds, ownDiscards || [], options);
}

/* ── 計分 ─────────────────────────────────────────────────
   取代原始檔的 calcScore(special, bet)，把寫死的 G.playerK 改成參數。
   kingdomId：'chu' 雄兵（所有和牌 ×1.3）／'qin' 虎狼（特殊牌型再 ×1.5） */
function calcScore(special, bet, kingdomId){
  let base = special ? special.pts : 8;
  if(bet === 'special') base *= 2;
  if(bet === 'dragon')  base *= 3;
  if(kingdomId === 'chu') base = Math.ceil(base * 1.3);
  if(kingdomId === 'qin' && special) base = Math.ceil(base * 1.5);
  return base;
}

/* ── 吃牌座位限制（四人版新增）──────────────────────────────
   兩人版沒有這條：對家永遠是上家，任何人打的牌都能吃。
   四人版只有下家（打牌者座位 +1）可以吃。                        */
function canChiSeat(discarderSeat, mySeat, seatCount){
  const n = seatCount || 4;
  return (discarderSeat + 1) % n === mySeat;
}

'''

EXPORTS = '''
return {
  // 常數
  SUITS, HONORS, ALL_TILES, SPECIAL_HANDS,
  // 基本工具
  sortTileKeys, isGuoshi, meldStats: _meldStats,
  // 和牌判定
  canWinInHand, canWinOnDiscard, canFPair, canFNS, canWin14,
  // 吃牌
  findChi, findAllChi, canChiSeat,
  // 聽牌與向聽
  isTenpaiHand, winningTiles,
  shantenNum, shantenStd, shantenQidui, shantenGuoshi,
  // 振聽（新增）
  isFuriten, canRonWith,
  // 牌型與計分
  checkSpecialHand, calcScore,
};
});
'''

if __name__ == '__main__':
    main()
