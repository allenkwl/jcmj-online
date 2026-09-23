/* ═══════════════════════════════════════════════════════════════
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

const SPECIAL_HANDS = [
  // ── 88 番（最高分，優先判斷）──
  {
    id:'jiulian', name:'九連寶燈', pts:88,
    desc:'手中持有 1112345678999 加任一萬子/筒子/條子（純一色）',
    check:(hand,melds)=>{
      if(melds.length>0)return false;
      for(const suit of SUITS){
        const s=hand.filter(t=>t.suit===suit&&!t.isHonor).map(t=>t.num).sort((a,b)=>a-b);
        if(s.length!==14)continue;
        // Must have at least 1112345678999
        const counts={};s.forEach(n=>counts[n]=(counts[n]||0)+1);
        const baseC={1:3,2:1,3:1,4:1,5:1,6:1,7:1,8:1,9:3};
        let ok=true;
        for(const [n,c] of Object.entries(baseC)){if((counts[n]||0)<c){ok=false;break;}}
        if(ok)return true;
      }
      return false;
    }
  },
  {
    id:'dasixi', name:'大四喜', pts:88,
    desc:'手中包含東南西北各一刻子，加任意雀頭',
    // 注意：大四喜手牌全為字牌(字一色)，且為全刻結構(對對胡)，必須排在兩者之前
    check:(hand,melds)=>{
      const all=[...hand,...melds.flatMap(m=>m.tiles)];
      const winds=['東','南','西','北'];
      return winds.every(w=>{
        const cnt=all.filter(t=>t.display===w).length;
        return cnt>=3;
      });
    }
  },
  {
    id:'lvyise', name:'綠一色', pts:88,
    desc:'手牌全為條子2346和8條，及發字牌',
    // 注意：不含発的綠一色同時符合清一色，必須排在清一色之前
    check:(hand,melds)=>{
      const greenTiles=['2條','3條','4條','6條','8條','發'];
      const all=[...hand,...melds.flatMap(m=>m.tiles)];
      return all.every(t=>greenTiles.includes(t.display));
    }
  },
  {
    id:'guoshi', name:'國士無雙', pts:88,
    desc:'手持么九牌：一萬九萬一筒九筒一條九條東南西北中發白，加其中一張重複',
    check:(hand,melds)=>{
      if(melds.length>0)return false;
      const req=['1萬','9萬','1筒','9筒','1條','9條','東','南','西','北','中','發','白'];
      const disp=hand.map(t=>t.display);
      const counts={};disp.forEach(d=>counts[d]=(counts[d]||0)+1);
      const hasAll=req.every(r=>counts[r]>=1);
      const hasPair=req.some(r=>counts[r]>=2);
      return hasAll&&hasPair&&disp.length===14;
    }
  },
  // ── 64 番 ──
  {
    id:'ziyise', name:'字一色', pts:64,
    desc:'手牌全為字牌（東南西北中發白），無數牌',
    check:(hand,melds)=>{
      const all=[...hand,...melds.flatMap(m=>m.tiles)];
      return all.every(t=>t.isHonor);
    }
  },
  // ── 32 番（小三元可同時符合對對胡，必須排在對對胡之前）──
  {
    id:'xiaosanxi', name:'小三元', pts:32,
    desc:'手中包含中發白中的兩個刻子，第三個為雀頭',
    check:(hand,melds)=>{
      const dragons=['中','發','白'];
      const all=[...hand,...melds.flatMap(m=>m.tiles)];
      const dCounts={};
      dragons.forEach(d=>{dCounts[d]=all.filter(t=>t.display===d).length;});
      const triples=dragons.filter(d=>dCounts[d]>=3).length;
      const pairs=dragons.filter(d=>dCounts[d]>=2&&dCounts[d]<3).length;
      return triples===2&&pairs===1;
    }
  },
  // ── 24 番 ──
  {
    id:'qingyise', name:'清一色', pts:24,
    desc:'手牌全為同一花色（萬/筒/條），不含字牌',
    check:(hand,melds)=>{
      const allTiles=[...hand,...melds.flatMap(m=>m.tiles)].filter(t=>!t.isHonor);
      const honors=[...hand,...melds.flatMap(m=>m.tiles)].filter(t=>t.isHonor);
      if(honors.length>0)return false;
      const suits=[...new Set(allTiles.map(t=>t.suit))];
      return suits.length===1;
    }
  },
  {
    id:'qidui', name:'七對子', pts:24,
    desc:'手牌由七個不同的對子組成',
    check:(hand,melds)=>{
      if(melds.length>0)return false;
      if(hand.length!==14)return false;
      const counts={};hand.forEach(t=>counts[t.display]=(counts[t.display]||0)+1);
      const vals=Object.values(counts);
      return vals.every(v=>v===2)&&Object.keys(counts).length===7;
    }
  },
  // ── 22 番 ──
  {
    id:'duiyisi', name:'對對胡', pts:22,
    desc:'全部手牌由刻子（三張相同）組成，加一個雀頭',
    check:(hand,melds)=>{
      // 所有副露必須是碰/槓
      const meldOk=melds.every(m=>m.type==='pong'||m.type.startsWith('kong'));
      if(!meldOk)return false;
      // 合併手牌+副露，統計每種牌的數量
      const allTiles=[...hand,...melds.flatMap(m=>m.tiles)];
      const counts={};allTiles.forEach(t=>counts[t.display]=(counts[t.display]||0)+1);
      const vals=Object.values(counts);
      // 必須全部是刻子（3或4張），只有一種是雀頭（2張）
      const pairs=vals.filter(v=>v===2).length;
      const triples=vals.filter(v=>v===3||v===4).length;
      const total=pairs+triples;
      return pairs===1 && triples>=1 && total===5;
    }
  },
  // ── 8 番 ──
  {
    id:'hungyise', name:'混一色', pts:8,
    desc:'手牌為同一花色數牌加字牌',
    check:(hand,melds)=>{
      const all=[...hand,...melds.flatMap(m=>m.tiles)];
      const numSuits=[...new Set(all.filter(t=>!t.isHonor).map(t=>t.suit))];
      const hasHonor=all.some(t=>t.isHonor);
      return numSuits.length===1&&hasHonor;
    }
  },
];

function sortTileKeys(keys){
  const SUIT_ORDER=['萬','筒','條'];
  return keys.sort((a,b)=>{
    const ma=a.match(/^(\d+)(.+)$/),mb=b.match(/^(\d+)(.+)$/);
    if(ma&&mb){
      const si=SUIT_ORDER.indexOf(ma[2])-SUIT_ORDER.indexOf(mb[2]);
      if(si!==0)return si; // sort by suit first
      return +ma[1]-+mb[1]; // then by number within same suit
    }
    if(ma)return -1; // numbers before honors
    if(mb)return 1;
    return a.localeCompare(b);
  });
}

// Check 國士無雙 directly on raw display array (no melds allowed)
function isGuoshi(disp){
  if(disp.length!==14)return false;
  const req=['1萬','9萬','1筒','9筒','1條','9條','東','南','西','北','中','發','白'];
  const counts={};disp.forEach(d=>counts[d]=(counts[d]||0)+1);
  const hasAll=req.every(r=>counts[r]>=1);
  const hasPair=req.some(r=>counts[r]>=2);
  return hasAll&&hasPair;
}


function _meldStats(melds){
  let mS=0, kongCount=0;
  melds.forEach(m=>{
    if(m.type.startsWith('kong')){ mS+=4; kongCount++; }
    else mS+=3;
  });
  return {mS, kongCount};
}

// 自摸判斷：hand（摸牌後的手牌）+ melds 副露
function canWinInHand(hand, melds){
  const {mS, kongCount} = _meldStats(melds);
  // 每次槓會補摸1張，讓手牌多1張
  // 正常 winSize = 14 - mS，但每個槓額外多1張
  const winSize = 14 - mS + kongCount;
  if(hand.length !== winSize) return false;
  const disp = hand.map(x=>x.display);
  if(melds.length === 0){
    if(isGuoshi(disp)) return true;
    return canWin14(disp);
  }
  return canFPair(disp, 4 - melds.length);
}

// 榮和判斷：hand（baseSize 張）+ melds 副露 + 對手棄的 tile
function canWinOnDiscard(hand, melds, tile){
  const test = [...hand.map(x=>x.display), tile.display];
  if(melds.length === 0){
    if(isGuoshi(test)) return true;
    return canWin14(test);
  }
  return canFPair(test, 4 - melds.length);
}

function canFPair(disp,sL){
  if(sL===0)return disp.length===2&&disp[0]===disp[1];
  const C={};disp.forEach(t=>C[t]=(C[t]||0)+1);
  const sortedKeys=sortTileKeys(Object.keys(C));
  for(const k of sortedKeys){if(C[k]>=2){const c={...C};c[k]-=2;if(!c[k])delete c[k];if(canFNS(c,sL))return true;}}
  return false;
}
function canFNS(C,n){
  if(n===0)return Object.keys(C).length===0;
  const keys=sortTileKeys(Object.keys(C));
  if(!keys.length)return false;
  const first=keys[0];
  // Try triplet
  if(C[first]>=3){const c={...C};c[first]-=3;if(!c[first])delete c[first];if(canFNS(c,n-1))return true;}
  // Try sequence (numbered tiles only)
  const m=first.match(/^(\d+)(.+)$/);
  if(m){const nv=+m[1],s=m[2],t2=(nv+1)+s,t3=(nv+2)+s;
    if(C[t2]>=1&&C[t3]>=1){const c={...C};c[first]--;if(!c[first])delete c[first];c[t2]--;if(!c[t2])delete c[t2];c[t3]--;if(!c[t3])delete c[t3];if(canFNS(c,n-1))return true;}}
  // If neither triplet nor sequence works for the lowest tile, this branch fails
  return false;
}
function canWin14(tiles){
  if(tiles.length!==14)return false;
  const C={};tiles.forEach(t=>C[t]=(C[t]||0)+1);
  // 七對子
  if(Object.values(C).every(v=>v===2)&&Object.keys(C).length===7)return true;
  // Standard: find a pair then 4 sets
  const sortedKeys=sortTileKeys(Object.keys(C));
  for(const k of sortedKeys){if(C[k]>=2){const c={...C};c[k]-=2;if(!c[k])delete c[k];if(canFNS(c,4))return true;}}
  return false;
}

function findChi(hand,tile){
  // Returns first valid combo (used by AI and legacy checks)
  const combos=findAllChi(hand,tile);
  return combos.length?combos[0]:null;
}
function findAllChi(hand,tile){
  // Returns ALL valid chi combinations as arrays of nums e.g. [[2,3,4],[3,4,5]]
  if(tile.isHonor)return[];
  const s=tile.suit,n=tile.num;
  const has=x=>hand.some(t=>t.suit===s&&t.num===x);
  const combos=[];
  if(has(n-2)&&has(n-1))combos.push([n-2,n-1,n]);
  if(has(n-1)&&has(n+1))combos.push([n-1,n,n+1]);
  if(has(n+1)&&has(n+2))combos.push([n,n+1,n+2]);
  return combos;
}

function checkSpecialHand(hand,melds){
  for(const sh of SPECIAL_HANDS){
    if(sh.check(hand,melds))return sh;
  }
  return null;
}

let _shantenBest;
function _shantenDFS(C, meld_count, mentsu, taatsu, jantou){
  const total = 4 - meld_count;
  const t_eff = Math.min(taatsu, total - mentsu);
  const s = 8 - 2*meld_count - 2*mentsu - t_eff - (jantou?1:0);
  if(s < _shantenBest) _shantenBest = s;
  if(_shantenBest <= -1) return;
  const keys = sortTileKeys(Object.keys(C));
  if(!keys.length) return;
  const t = keys[0];
  // 刻子
  if(C[t]>=3 && mentsu<total){const c={...C};c[t]-=3;if(!c[t])delete c[t];_shantenDFS(c,meld_count,mentsu+1,taatsu,jantou);}
  const m=t.match(/^(\d+)(.+)$/);
  if(m){
    const n=+m[1],s2=m[2],t2=(n+1)+s2,t3=(n+2)+s2;
    // 順子
    if(C[t2]&&C[t3]&&mentsu<total){const c={...C};c[t]--;if(!c[t])delete c[t];c[t2]--;if(!c[t2])delete c[t2];c[t3]--;if(!c[t3])delete c[t3];_shantenDFS(c,meld_count,mentsu+1,taatsu,jantou);}
    // 連張搭子
    if(C[t2]&&mentsu+taatsu<total){const c={...C};c[t]--;if(!c[t])delete c[t];c[t2]--;if(!c[t2])delete c[t2];_shantenDFS(c,meld_count,mentsu,taatsu+1,jantou);}
    // 嵌張搭子
    if(C[t3]&&mentsu+taatsu<total){const c={...C};c[t]--;if(!c[t])delete c[t];c[t3]--;if(!c[t3])delete c[t3];_shantenDFS(c,meld_count,mentsu,taatsu+1,jantou);}
  }
  // 雀頭
  if(C[t]>=2&&!jantou){const c={...C};c[t]-=2;if(!c[t])delete c[t];_shantenDFS(c,meld_count,mentsu,taatsu,true);}
  // 對子搭子（已有雀頭）
  if(C[t]>=2&&jantou&&mentsu+taatsu<total){const c={...C};c[t]-=2;if(!c[t])delete c[t];_shantenDFS(c,meld_count,mentsu,taatsu+1,jantou);}
  // 注意：孤立單張不算搭子（會造成假陽性聽牌判定）
  // 完全跳過（孤立廢牌）
  {const c={...C};c[t]--;if(!c[t])delete c[t];_shantenDFS(c,meld_count,mentsu,taatsu,jantou);}
}
function shantenStd(tiles, meld_count){
  const C={};tiles.forEach(t=>C[t]=(C[t]||0)+1);
  _shantenBest = 8 - 2*meld_count;
  _shantenDFS(C, meld_count, 0, 0, false);
  return _shantenBest;
}
function shantenQidui(disp){
  // 支援13張（聽牌判斷）和14張（和牌判斷）
  if(disp.length!==13&&disp.length!==14)return 6;
  const C={};disp.forEach(t=>C[t]=(C[t]||0)+1);
  const pairs=Object.values(C).filter(v=>v>=2).length;
  if(disp.length===14) return 6-pairs;   // 14張：7對=勝(-1), 6對=tenpai(0)
  return 6-pairs;                         // 13張：6對+1孤=tenpai(0), 5對=1-shanten(1)
}
function shantenGuoshi(disp){
  const req=['1萬','9萬','1筒','9筒','1條','9條','東','南','西','北','中','發','白'];
  const counts={};disp.forEach(d=>counts[d]=(counts[d]||0)+1);
  const have=req.filter(r=>counts[r]>=1).length;
  const hasPair=req.some(r=>counts[r]>=2);
  return 13 - have - (hasPair?1:0);  // 正確：13張全有+對=tenpai(0), 12張有+對=1-shanten(1)
}
function shantenNum(disp, meldCount){
  if(meldCount===0) return Math.min(shantenStd(disp,0), shantenQidui(disp), shantenGuoshi(disp));
  return shantenStd(disp, meldCount);
}

/* isTenpaiHand —— 由原始檔抽出後移除 console.log 除錯，語意不變 */
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
}


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
