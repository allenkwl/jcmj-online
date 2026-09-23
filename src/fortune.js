/* ═══════════════════════════════════════════════════════════════
   fortune.js — 發牌占卜（起手分析與下注）
   ───────────────────────────────────────────────────────────────
   舊版的 `analyzeHand`（L3445，111 行）沒有照搬，重寫的。三個理由
   （完整比對見 `docs/fortune-analysis.md`）：

   1. **九連寶燈的判定是錯的。** 舊版只檢查「有沒有一張 1 和一張 9」，
      但九連是 1112345678999 —— 三張 1、三張 9。
      實測 4,000 副清一色手牌，喊了 2,908 次，其中 2,846 次是誤判（97.9%）。
      占卜的提示是拿來下注的，被騙去押 ×3 很不好玩。
   2. 舊版那 80 行跟 `SPECIAL_HANDS` 重複。牌型定義已經在 rules-core，
      再維護一份平行的偵測邏輯，改一邊忘另一邊是遲早的事。
   3. 舊版的閾值是兩人局調的。四人局共用一副牌山、鳴牌機會多三倍。

   ── 作法 ──
   對每個 `SPECIAL_HANDS` 的牌型估「**還差幾張**」，取最近又分數高的來提示。
   由 SPECIAL_HANDS 驅動（用 id 對應），新增牌型只要補一個估計函式。

   ── 下注（已於 2026-09-16 定案）──
     ‧ **只有玩家下注，AI 不下注**
     ‧ **只影響自己的得分**，不影響別人的收付
       （所以不需要讓所有人看到彼此的注，設計簡單很多）
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./rules-core.js') : root.MJRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJFortune = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
'use strict';

const SUITS = ['萬', '筒', '條'];
const HONORS = ['東', '南', '西', '北', '中', '發', '白'];
const WINDS = ['東', '南', '西', '北'];
const DRAGONS = ['中', '發', '白'];
const GREEN = ['2條', '3條', '4條', '6條', '8條', '發'];
const TERMINALS = ['1萬', '9萬', '1筒', '9筒', '1條', '9條'].concat(HONORS);

/* 兩個門檻，用途不同：

   `MAX_AWAY`  列進清單的上限。**永遠列出最近的幾種**並標明「還差幾張」——
               玩家看到「七對子 還差 4 張」就知道不怎麼樣，
               比舊版那種只喊「七對子潛力！」不講距離有用得多。
   `CLOSE`     真的有機會的門檻。只有這麼近才會設 `best`、才會強調、
               才會建議押大的。

   為什麼不用單一門檻：距離的分布是斷崖式的（實測差 3 張以內 2.3%、
   差 4 張以內 17.8%），因為七對子的距離以「對」為單位跳。
   單一門檻不是幾乎沒提示、就是一半的牌都在提示。 */
const MAX_AWAY = 6;
const CLOSE = 2;
const MAX_HINTS = 3;

/* ── 下注 ──────────────────────────────────────────────────
   倍率沿用舊版。`rules-core` 的 `calcScore(special, bet, kingdomId)`
   本來就吃這個 bet 字串，所以計分那端不用改。 */
const BETS = [
  { id: 'normal',  name: '普通胡牌', sub: '穩扎穩打',   mult: 1 },
  { id: 'special', name: '押特殊牌型', sub: '成了加倍', mult: 2 },
  { id: 'dragon',  name: '孤注一擲', sub: '成了三倍',   mult: 3 },
];

/* ── 工具 ──────────────────────────────────────────────────── */
function countBy(tiles) {
  const c = Object.create(null);
  tiles.forEach(t => { c[t.display] = (c[t.display] || 0) + 1; });
  return c;
}

/* 手上這些牌裡，有幾張能用在目標牌組裡。
   目標用 {牌面: 需要幾張} 表示，每種最多算到它需要的張數。 */
function overlap(counts, need) {
  let n = 0;
  Object.keys(need).forEach(d => { n += Math.min(counts[d] || 0, need[d]); });
  return n;
}
/* 還差幾張 = 手牌張數 − 能用的張數。
   （換掉一張＝丟一張再摸一張，所以「用不上的張數」就是還要換幾次） */
function awayFrom(tiles, need) {
  return tiles.length - overlap(countBy(tiles), need);
}

function needOf(list) {
  const n = Object.create(null);
  list.forEach(d => { n[d] = (n[d] || 0) + 1; });
  return n;
}

function dominantSuit(tiles) {
  const c = { 萬: 0, 筒: 0, 條: 0 };
  tiles.forEach(t => { if (!t.isHonor) c[t.suit]++; });
  let best = null, n = -1;
  SUITS.forEach(s => { if (c[s] > n) { n = c[s]; best = s; } });
  return { suit: best, count: n };
}

/* ── 場上看得到的牌 ────────────────────────────────────────
   自己的手牌 + 所有人的副露 + 所有人的牌河。
   **只用公開資訊**（別家的手牌一張都不看）。

   ⚠️ **這不是拿來提醒玩家「你胡不了」的。** 那個功能被否決了 ——
   數牌河是麻將的技術，系統代勞等於把技術拿掉（見 analyze 裡的註解）。

   真正的用途是**發牌時配種子**：偏置發牌要同時給幾家不同的特殊牌型時，
   得先確認那幾種牌型的牌量加起來放得下（見 docs/biased-deal.md）。
   例如綠一色只有 24 張可用，兩家同時做就要 28 張 —— 配不出來。      */
function visibleCounts(hand, mySeat) {
  const c = Object.create(null);
  const add = t => { c[t.display] = (c[t.display] || 0) + 1; };
  if (!hand || !hand.seats) return c;
  hand.seats.forEach((s, i) => {
    if (i === mySeat) s.hand.forEach(add);
    s.melds.forEach(m => m.tiles.forEach(add));
    s.discards.forEach(add);
  });
  return c;
}

/* 這一疊目標牌還拿得到嗎。
   `need` 是 {牌面: 需要幾張}，`have` 是自己手上已經有的，
   `visible` 是場上（含自己手牌）已經看得到的。

   回傳還差幾張拿不到 —— 0 代表做得成，>0 代表**已經不可能**。   */
function unobtainable(need, counts, visible) {
  let dead = 0;
  Object.keys(need).forEach(d => {
    const want = need[d];
    const mine = Math.min(counts[d] || 0, want);
    const stillNeed = want - mine;
    if (stillNeed <= 0) return;
    const seenElsewhere = Math.max(0, (visible[d] || 0) - (counts[d] || 0));
    const left = 4 - (counts[d] || 0) - seenElsewhere;   // 還沒露面的張數
    if (left < stillNeed) dead += stillNeed - left;
  });
  return dead;
}

/* ── 各牌型「還差幾張」──────────────────────────────────────
   key 是 SPECIAL_HANDS 的 id。沒寫估計函式的牌型就不提示。 */
const ESTIMATORS = {
  /* 九連寶燈：某一花色的 1112345678999。
     ⚠️ 這就是舊版壞掉的地方 —— 它只看「有沒有 1 和 9」。
     真正要的是三張 1、三張 9，加上 2~8 各一張。 */
  jiulian(tiles) {
    let best = 99;
    SUITS.forEach(s => {
      const need = needOf([
        1 + s, 1 + s, 1 + s, 2 + s, 3 + s, 4 + s, 5 + s,
        6 + s, 7 + s, 8 + s, 9 + s, 9 + s, 9 + s,
      ]);
      best = Math.min(best, awayFrom(tiles, need));
    });
    return best;
  },

  /* 大四喜：四種風各三張（12 張）＋ 一對雀頭 */
  dasixi(tiles) {
    const need = needOf([].concat(...WINDS.map(w => [w, w, w])));
    // 十三張裡最多放得下 12 張風 + 1 張雜的
    return Math.max(0, awayFrom(tiles, need) - 1);
  },

  /* 綠一色：全部是 2/3/4/6/8 條 與 發 */
  lvyise(tiles) {
    return tiles.filter(t => GREEN.indexOf(t.display) < 0).length;
  },

  /* 國士無雙：十三種么九各一張 */
  guoshi(tiles) {
    const c = countBy(tiles);
    const have = TERMINALS.filter(d => c[d] > 0).length;
    return TERMINALS.length - have;
  },

  /* 字一色：全部是字牌 */
  ziyise(tiles) {
    return tiles.filter(t => !t.isHonor).length;
  },

  /* 小三元：三元牌兩刻一對（8 張） */
  xiaosanxi(tiles) {
    const c = countBy(tiles);
    const cnt = DRAGONS.map(d => c[d] || 0).sort((a, b) => b - a);
    const have = Math.min(cnt[0], 3) + Math.min(cnt[1], 3) + Math.min(cnt[2], 2);
    return 8 - have;
  },

  /* 清一色：全部同一花色、不含字牌 */
  qingyise(tiles) {
    const d = dominantSuit(tiles);
    return tiles.length - d.count;
  },

  /* 混一色：一種花色 + 字牌 */
  hunyise(tiles) {
    const d = dominantSuit(tiles);
    const honors = tiles.filter(t => t.isHonor).length;
    return tiles.length - d.count - honors;
  },

  /* 七對子：十三張聽牌時是六對 + 一張單騎。
     距離以**張**為單位（不是對）—— 其他牌型都是算張，混在一起沒法比。 */
  qidui(tiles) {
    const c = countBy(tiles);
    let pairs = 0;
    Object.keys(c).forEach(d => { pairs += Math.floor(c[d] / 2); });
    return Math.max(0, 6 - Math.min(6, pairs));
  },

  /* 對對胡：四個刻子 + 一對 */
  duiduihu(tiles) {
    const c = countBy(tiles);
    const counts = Object.keys(c).map(d => c[d]).sort((a, b) => b - a);
    let trips = 0, pairs = 0;
    counts.forEach(n => {
      if (n >= 3 && trips < 4) trips++;
      else if (n >= 2 && pairs < 1) pairs++;
    });
    return Math.max(0, (4 - trips) * 2 + (1 - pairs));
  },
};

/* 每個牌型「需要哪些牌」的固定牌組。
   只有目標固定的牌型才有 —— 七對子／對對胡／清一色這種是**形狀**不是固定牌組，
   任何牌都能湊，不會有「拿不到」的問題，所以不列。 */
const FIXED_NEEDS = {
  jiulian: () => SUITS.map(s => needOf([
    1 + s, 1 + s, 1 + s, 2 + s, 3 + s, 4 + s, 5 + s,
    6 + s, 7 + s, 8 + s, 9 + s, 9 + s, 9 + s,
  ])),
  dasixi: () => [needOf([].concat(...WINDS.map(w => [w, w, w])))],
  guoshi: () => [needOf(TERMINALS)],
  xiaosanxi: () => [
    needOf([DRAGONS[0], DRAGONS[0], DRAGONS[0], DRAGONS[1], DRAGONS[1], DRAGONS[1], DRAGONS[2], DRAGONS[2]]),
    needOf([DRAGONS[0], DRAGONS[0], DRAGONS[0], DRAGONS[2], DRAGONS[2], DRAGONS[2], DRAGONS[1], DRAGONS[1]]),
    needOf([DRAGONS[1], DRAGONS[1], DRAGONS[1], DRAGONS[2], DRAGONS[2], DRAGONS[2], DRAGONS[0], DRAGONS[0]]),
  ],
};

/* 這個牌型還做不做得成。回 0 代表做得成。 */
function deadness(id, tiles, visible) {
  const mk = FIXED_NEEDS[id];
  if (!mk || !visible) return 0;
  const counts = countBy(tiles);
  // 有多種湊法（例如小三元的三種組合）就取最寬鬆的那一種
  return Math.min.apply(null, mk().map(need => unobtainable(need, counts, visible)));
}

/* ── 分析 ────────────────────────────────────────────────────
   opts.visible：場上看得到的牌（用 visibleCounts 算）。
   有給的話會判「這個牌型還做不做得成」—— 需要的牌被碰光、
   或躺在牌河裡就是做不成了，那種牌型不該再提示、更不該建議押注。 */
/* 聽哪幾張。

   `winningTiles` 吃的是**打完之後**的 13 張；輪到自己的時候手上是 14 張，
   直接丟進去會回空陣列 —— 畫面上就變成「🎯 聽牌」卻不說等什麼，
   偏偏那正是玩家最想知道的時候。

   多一張的時候先試摸切（打掉剛摸的那張，最常見也最不動牌型），
   摸切之後不聽才往前找第一張「打掉還聽」的。跟 ai.js 的代打同一套策略，
   所以畫面上看到的等牌，就是把手交給系統之後真的會等的那幾張。 */
function waitsOf(tiles, m) {
  const direct = R.winningTiles(tiles, m);
  if (direct.length || !tiles.length) return direct;
  const drop = i => tiles.filter((_, j) => j !== i);
  const last = R.winningTiles(drop(tiles.length - 1), m);
  if (last.length) return last;
  for (let i = 0; i < tiles.length - 1; i++) {
    const w = R.winningTiles(drop(i), m);
    if (w.length) return w;
  }
  return [];
}

function analyze(hand, melds, opts) {
  const tiles = hand || [];
  const m = melds || [];
  const c = countBy(tiles);
  const suits = SUITS.filter(s => tiles.some(t => !t.isHonor && t.suit === s));
  const pairs = Object.keys(c).filter(d => c[d] === 2).length;
  const trips = Object.keys(c).filter(d => c[d] >= 3).length;
  const honors = tiles.filter(t => t.isHonor).length;

  const o = opts || {};
  const visible = o.visible || null;

  const hints = [];
  R.SPECIAL_HANDS.forEach(sh => {
    const est = ESTIMATORS[sh.id];
    if (!est) return;
    const away = est(tiles);
    if (away > MAX_AWAY) return;
    const dead = deadness(sh.id, tiles, visible);
    hints.push({
      id: sh.id, name: sh.name, pts: sh.pts, away,
      dead,                    // 還差幾張是**拿不到**的
      feasible: dead === 0,
    });
  });
  /* 排序：做得成的優先，再來差得少的，最後分數高的。
     做不成的牌型排再前面也沒用 —— 玩家照著押注會輸得莫名其妙。 */
  hints.sort((a, b) =>
    (a.feasible === b.feasible ? 0 : a.feasible ? -1 : 1)
    || a.away - b.away || b.pts - a.pts);

  const top = hints.slice(0, MAX_HINTS);

  /* ⚠️ 這裡**刻意不判「死聽」**（聽的牌是不是已經全部出現）。

     一度做了，被打回來：
     「別人碰走就算了，玩家自己要等就等，系統不需要提醒胡不了，這樣不公平」

     數牌河、知道自己的聽張還剩幾張，本來就是麻將的技術。
     系統代勞等於把那份技術拿掉，而且「你沒救了」這種話會把局打死。
     要等就讓他等。                                                 */
  const waits = waitsOf(tiles, m);

  const first = top[0];
  return {
    suits, pairs, trips, honors,
    shanten: R.shantenNum(tiles.map(t => t.display), m.length),
    waits,
    hints: top,                                     // 永遠給幾個參考
    // 真的有機會：夠近**而且做得成**
    best: first && first.away <= CLOSE && first.feasible ? first : null,
  };
}

/* 給畫面用的一句話。不回 HTML —— 樣式歸畫面層，這裡只給資料與文字。 */
function summary(a) {
  const lines = [];
  lines.push(`花色：${a.suits.join('、') || '（純字牌）'}`);
  lines.push(`對子 ${a.pairs} 組　刻子 ${a.trips} 組　字牌 ${a.honors} 張`);
  lines.push(a.shanten <= 0 ? '已經聽牌！' : `距離聽牌約 ${a.shanten} 向聽`);
  return lines;
}

/* 建議的注。只在「差得夠近」時才敢建議大的 ——
   舊版沒有這一層，玩家只能自己猜。 */
function suggestBet(a) {
  if (!a.best) return 'normal';
  if (a.best.away <= 1 && a.best.pts >= 24) return 'dragon';
  if (a.best.away <= 3) return 'special';
  return 'normal';
}

return {
  BETS, MAX_AWAY, CLOSE, MAX_HINTS, ESTIMATORS, FIXED_NEEDS,
  analyze, summary, suggestBet,
  visibleCounts, unobtainable, deadness,
  countBy, awayFrom, needOf, dominantSuit,
};
});
