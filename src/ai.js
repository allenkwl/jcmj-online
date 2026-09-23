/* ═══════════════════════════════════════════════════════════════
   ai.js — 四人局的 AI（進攻、防守、宣告）
   ───────────────────────────────────────────────────────────────
   舊版的 AI 有三個必須修的問題：

   1. **會作弊。** `getPlayerWaitingTiles()` 直接 `canRon(G.pH, …)`
      翻玩家的手牌。作弊只用在防守，進攻邏輯本來就乾淨。
   2. **三家會共用狀態。** `aiD(hand)` 讀的是全域 `G.oM`，
      兩人局只有一個對手所以看不出來，四人局三家 AI 會互相污染。
   3. **一聽牌就全程龜縮。** expert 的 `dangerWeight=80` × `danger=100` = 8000，
      而一個向聽只值 1000 —— 防守項比進攻項大八倍。
      兩人局還能玩，四人局有三家輪流聽牌，AI 會從頭到尾不做牌。

   這裡全部重寫：

   ‧ 只吃**公開資訊** —— 自己的手牌、所有人的牌河與副露。
     別家的手牌一次都沒讀（有測試釘死這件事）。
   ‧ 難度用「資訊完整度」分級，不是用「能不能作弊」分級：
       1 初學　不防守
       2 普通　只看現物
       3 高手　現物 + 筋 + 副露推測
   ‧ 防守是**傾斜**不是**否決**：危險度最多值 1.5 個向聽（DANGER_MAX），
     所以 AI 會避開危險牌，但不會為了安全而完全不做牌。

   ── 一個硬性約束：不准用 Math.random ──
   線上版要能重放：同一份狀態，每台算出來的下一步都必須一樣。
   AI 一旦擲骰子，driver 與旁觀者就會分岔。
   初學的「隨手打」用的是牌河長度推出來的偽隨機，可重現。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./rules-core.js') : root.MJRules,
    typeof require === 'function' ? require('./game-state.js') : root.MJState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S) {
'use strict';

const SEATS = 4;

/* 一個向聽值多少分。危險度是 0～1，乘上 DANGER_MAX 之後最多值 1.5 個向聽 ——
   這就是舊版「8000 對 1000」那個比例的修正：防守可以讓 AI 繞路，
   但繞不到「整局不做牌」。                                          */
const SHANTEN_W  = 100;
const UKEIRE_W   = 1;     // 受入張數，同向聽時的主要排序依據（最多 ~40）
const DANGER_MAX = 150;

/* 受入計算的成本控制，理由見 chooseDiscard */
const UKEIRE_SHANTEN_GATE   = 2;
const UKEIRE_MAX_CANDIDATES = 5;

/* ── 向聽數快取 ────────────────────────────────────────────
   一次棄牌決策要算 14 次，加上受入評估會到好幾百次，
   而相鄰兩巡的手牌只差一張，重複率很高。
   鍵是「排序後的牌面 + 副露數」，所以不同座位、不同局都共用得到。   */
const _shCache = new Map();
const SH_CACHE_MAX = 20000;

function shanten(disp, meldCount) {
  const key = disp.slice().sort().join(',') + '|' + meldCount;
  const hit = _shCache.get(key);
  if (hit !== undefined) return hit;
  const v = R.shantenNum(disp, meldCount);
  if (_shCache.size >= SH_CACHE_MAX) _shCache.clear();
  _shCache.set(key, v);
  return v;
}
function clearCache() { _shCache.clear(); }

/* ── 公開資訊 ──────────────────────────────────────────────
   以下每一個函式都只看：自己的手牌、所有人的牌河、所有人的副露。
   別家的 hand 陣列一次都不碰。                                     */

/* 這張牌在場上已經看得到幾張（自己的手牌 + 所有副露 + 所有牌河） */
function visibleCount(hand, display, viewerSeat) {
  let n = 0;
  hand.seats.forEach((s, i) => {
    if (i === viewerSeat) s.hand.forEach(t => { if (t.display === display) n++; });
    s.melds.forEach(m => m.tiles.forEach(t => { if (t.display === display) n++; }));
    s.discards.forEach(t => { if (t.display === display) n++; });
  });
  return n;
}

/* 現物：這家自己打過的牌。他對這些牌振聽，100% 不會榮和。
   被鳴走的那張也算 —— game-state 用 claimedBy 標記而不刪除，就是為了這個。 */
function genbutsu(hand, targetSeat) {
  const set = Object.create(null);
  hand.seats[targetSeat].discards.forEach(t => { set[t.display] = true; });
  return set;
}

/* 筋：他打過 4萬，就不可能用兩面聽 1萬／7萬（2-3 聽 1-4，5-6 聽 4-7）。
   只擋得掉兩面，擋不掉單騎、嵌張、邊張，所以是「比較安全」不是「安全」。 */
function isSuji(display, gen) {
  const m = display.match(/^(\d+)(.+)$/);
  if (!m) return false;
  const n = +m[1], s = m[2];
  const has = k => !!gen[k + s];
  if (n <= 3) return has(n + 3);
  if (n >= 7) return has(n - 3);
  return has(n - 3) && has(n + 3);   // 中張要兩邊都有才是本筋
}

/* 牌面本身的危險度（還沒考慮這家的狀況）。
   中張最危險，么九次之，字牌最安全 —— 兩面聽吃不到字牌。          */
function baseDanger(display) {
  const m = display.match(/^(\d+)(.+)$/);
  if (!m) return 0.30;                       // 字牌
  const n = +m[1];
  if (n === 1 || n === 9) return 0.40;
  if (n === 2 || n === 8) return 0.60;
  if (n === 3 || n === 7) return 0.75;
  return 1.00;                               // 4 5 6
}

/* 這家看起來多接近和牌（0～1）。全部從公開資訊推：
   打了幾張牌（越後面越可能聽了）、副露幾組（鳴牌代表他在趕）、
   有沒有役牌副露（有役才敢鳴）。                                    */
function threatLevel(hand, seat) {
  const s = hand.seats[seat];
  const turns = s.discards.length;
  let t = Math.min(1, turns / 14);            // 約十四巡，該聽的都聽了

  const melds = s.melds.length;
  t += melds * 0.15;

  const yakuhai = ['中', '發', '白', hand.roundWind || '東', S.seatWind(hand, seat)];
  const hasYakuhaiMeld = s.melds.some(m =>
    m.tiles.length >= 3 && yakuhai.indexOf(m.tiles[0].display) >= 0);
  if (hasYakuhaiMeld) t += 0.10;

  return Math.max(0, Math.min(1, t));
}

/* 對某一家而言，打這張牌有多危險（0～1）。level 決定用得到哪些資訊。 */
function tileDangerAgainst(hand, display, targetSeat, viewerSeat, level) {
  if (level <= 1) return 0;                   // 初學不防守

  const gen = genbutsu(hand, targetSeat);
  if (gen[display]) return 0;                 // 現物，他振聽

  let d = baseDanger(display);
  if (level >= 3) {
    if (isSuji(display, gen)) d *= 0.5;       // 本筋擋掉兩面
    // 場上已經看得到三張以上 → 剩下的組合少，危險度打折
    const seen = visibleCount(hand, display, viewerSeat);
    if (seen >= 3) d *= 0.4;
    else if (seen === 2) d *= 0.75;
  }
  return Math.max(0, Math.min(1, d));
}

/* 打這張牌，對整桌而言最高的危險度（取三家的最大值，並乘上各自的威脅度） */
function tileDanger(hand, display, viewerSeat, level) {
  if (level <= 1) return 0;
  let worst = 0;
  for (let s = 0; s < SEATS; s++) {
    if (s === viewerSeat) continue;
    const d = tileDangerAgainst(hand, display, s, viewerSeat, level)
            * threatLevel(hand, s);
    if (d > worst) worst = d;
  }
  return worst;
}

/* ── 受入 ──────────────────────────────────────────────────
   打掉這張之後，還有幾張牌摸到能讓向聽數前進。
   只算「相關的牌」—— 跟手上某張同花色且相差 2 以內，或同一種字牌。
   全部 34 種都試一次會慢三倍，而不相關的牌本來就不可能讓向聽前進。 */
function relevantTiles(restDisp) {
  const set = Object.create(null);
  restDisp.forEach(d => {
    const m = d.match(/^(\d+)(.+)$/);
    if (!m) { set[d] = true; return; }
    const n = +m[1], s = m[2];
    for (let k = n - 2; k <= n + 2; k++) if (k >= 1 && k <= 9) set[k + s] = true;
  });
  return Object.keys(set);
}

function ukeire(hand, restDisp, meldCount, viewerSeat) {
  const cur = shanten(restDisp, meldCount);
  let total = 0;
  relevantTiles(restDisp).forEach(d => {
    if (shanten(restDisp.concat([d]), meldCount) < cur) {
      total += Math.max(0, 4 - visibleCount(hand, d, viewerSeat));
    }
  });
  return total;
}

/* ── 棄牌 ──────────────────────────────────────────────────
   評分越低越好：
     向聽數 × 100　－　受入 × 1　＋　危險度 × 危險權重

   危險權重 = DANGER_MAX × 自己的壓力 × 全桌最高威脅。
   自己越接近聽牌，越該推進而不是縮 —— 所以聽牌時權重只剩兩成。   */
function pressureOf(ownShanten) {
  if (ownShanten <= 0) return 0.20;           // 已聽牌：推
  if (ownShanten === 1) return 0.55;
  return 1.00;                                // 還遠：該收就收
}

function chooseDiscard(hand, seat, opts) {
  const o = opts || {};
  const level = o.level || 2;
  const me = hand.seats[seat];
  const mc = me.melds.length;
  const n = me.hand.length;
  if (!n) return 0;

  // 每張都先算「打掉之後的向聽數」
  const rows = [];
  let minSh = Infinity;
  for (let i = 0; i < n; i++) {
    const rest = [];
    for (let j = 0; j < n; j++) if (j !== i) rest.push(me.hand[j].display);
    const sh = shanten(rest, mc);
    if (sh < minSh) minSh = sh;
    rows.push({ i, sh, rest, display: me.hand[i].display });
  }

  // 初學：不防守，也不細算受入，在「還行」的選項裡隨手挑一張。
  // 用牌河長度推偽隨機而不是 Math.random —— 線上版要能重放。
  if (level <= 1) {
    const okay = rows.filter(r => r.sh <= minSh + 1);
    const pick = (me.discards.length * 7 + seat * 3 + n) % okay.length;
    return okay[pick].i;
  }

  const maxThreat = (() => {
    let t = 0;
    for (let s = 0; s < SEATS; s++) if (s !== seat) t = Math.max(t, threatLevel(hand, s));
    return t;
  })();
  const dangerWeight = DANGER_MAX * pressureOf(minSh) * maxThreat;

  // 受入是這裡最貴的一項（每張候選要試約 20 種進張，各算一次向聽數）。
  // 三個地方收斂，實測一場四局從 18.7 秒降到 3 秒出頭：
  //   ‧ 只有一張候選時根本不用算 —— 沒有東西要比
  //   ‧ 離聽牌還有三向聽以上時不算 —— 那個階段差一兩張受入無關痛癢，
  //     向聽數與危險度就足以決定要打哪張
  //   ‧ 候選超過 UKEIRE_MAX_CANDIDATES 張時只看前幾張
  const contenders = rows.filter(r => r.sh <= minSh);
  const uke = Object.create(null);
  if (contenders.length > 1 && minSh <= UKEIRE_SHANTEN_GATE) {
    contenders.slice(0, UKEIRE_MAX_CANDIDATES).forEach(r => {
      uke[r.i] = ukeire(hand, r.rest, mc, seat);
    });
  }

  let best = rows[0], bestScore = Infinity;
  rows.forEach(r => {
    const u = uke[r.i] || 0;
    const danger = tileDanger(hand, r.display, seat, level);
    const score = r.sh * SHANTEN_W - u * UKEIRE_W + danger * dangerWeight;
    if (score < bestScore) { bestScore = score; best = r; }
  });
  return best.i;
}

/* ── 宣告（吃碰槓）──────────────────────────────────────────
   取代舊版的 `aiShouldPong` / `aiShouldChi` —— 它們也是直接讀全域 `G.oH`。

     1 初學　不鳴（有得胡還是會胡）
     2 普通　向聽數真的前進才鳴
     3 高手　同上，但別家威脅高而自己還遠的時候不鳴
             （鳴牌會少一張手牌可用來防守，而且把自己綁死在這副牌型上）*/
function decideClaim(hand, seat, options, opts) {
  const o = opts || {};
  const level = o.level || 2;
  const opt = options || {};

  if (opt.ron) return { type: 'ron' };         // 有得胡一定胡，三級都一樣
  if (level <= 1) return { type: 'pass' };
  if (!opt.pong && !opt.kong && !(opt.chi && opt.chi.length)) return { type: 'pass' };

  const me = hand.seats[seat];
  const mc = me.melds.length;
  const disp = me.hand.map(t => t.display);
  const cur = shanten(disp, mc);
  const tile = hand.lastDiscard && hand.lastDiscard.tile;
  if (!tile) return { type: 'pass' };

  if (level >= 3) {
    let maxThreat = 0;
    for (let s = 0; s < SEATS; s++) if (s !== seat) maxThreat = Math.max(maxThreat, threatLevel(hand, s));
    // 自己還有兩向聽以上、別家又看起來快聽了 → 不要再把手牌鳴掉
    if (cur >= 2 && maxThreat >= 0.7) return { type: 'pass' };
  }

  const after = (take) => {
    let removed = 0;
    return me.hand.filter(t => {
      if (t.display === tile.display && removed < take) { removed++; return false; }
      return true;
    }).map(t => t.display);
  };

  if (opt.kong && shanten(after(3), mc + 1) < cur) return { type: 'kong' };
  if (opt.pong && shanten(after(2), mc + 1) < cur) return { type: 'pong' };

  // 已經聽牌就不吃 —— 吃下去會把聽口拆掉
  if (opt.chi && opt.chi.length && cur > 0) {
    for (const nums of opt.chi) {
      const need = nums.filter(x => x !== tile.num);
      const rest = [];
      me.hand.forEach(t => {
        const k = (t.suit === tile.suit) ? need.indexOf(t.num) : -1;
        if (k >= 0) { need.splice(k, 1); return; }
        rest.push(t.display);
      });
      if (shanten(rest, mc + 1) < cur) return { type: 'chi', nums };
    }
  }

  return { type: 'pass' };
}

/* ── 聽牌之後的代打 ────────────────────────────────────────
   玩家聽牌後可以把操作交給系統（舊版就有這個）。聽牌之後其實沒什麼要決定的：
   摸到不要的就打掉、能胡就胡 —— 對不會打麻將的人特別有用。

   策略照舊版 `oppTurn` 的聽牌分支：
     ‧ 優先「摸切」（打掉剛摸的那張）—— 不會動到聽牌的形狀
     ‧ 剛摸的那張如果反而讓牌型變好（摸切會拆聽），改打一張打掉後仍然聽牌的
     ‧ 都不保聽就摸切

   ⚠️ 這是**規則邏輯不是畫面邏輯**，所以放在這裡不放控制層 ——
   放 UI 裡就沒辦法寫測試，而「代打會不會把聽牌打掉」正是最需要測的事。 */
function tenpaiAutoDiscard(hand, seat) {
  const me = hand.seats[seat];
  const mc = me.melds.length;
  const n = me.hand.length;
  if (!n) return 0;
  const last = n - 1;                          // 剛摸的那張在最右邊（見 game-state 的排序）

  const keepsTenpai = i => {
    const rest = [];
    for (let j = 0; j < n; j++) if (j !== i) rest.push(me.hand[j].display);
    return shanten(rest, mc) <= 0;
  };

  if (keepsTenpai(last)) return last;
  for (let i = 0; i < n; i++) if (keepsTenpai(i)) return i;
  return last;
}

/* 綁好難度之後交給 flow 的掛載點用 */
function discardFor(level) {
  return (hand, seat) => chooseDiscard(hand, seat, { level });
}
function claimFor(level) {
  return (hand, seat, options) => decideClaim(hand, seat, options, { level });
}

/* 一次接好 flow 的兩個掛載點。難度由 flow 依座位傳進來，所以這裡不用綁死。
   用法：F.startMatch(match, Object.assign({seatInfo, …}, AI.flowHooks()))     */
function flowHooks() {
  return {
    chooseDiscard: (hand, seat, level) => chooseDiscard(hand, seat, { level }),
    decideClaim: (hand, seat, options, level) => decideClaim(hand, seat, options, { level }),
  };
}

return {
  SHANTEN_W, UKEIRE_W, DANGER_MAX,
  UKEIRE_SHANTEN_GATE, UKEIRE_MAX_CANDIDATES,
  shanten, clearCache,
  visibleCount, genbutsu, isSuji, baseDanger, threatLevel,
  tileDangerAgainst, tileDanger,
  relevantTiles, ukeire, pressureOf,
  chooseDiscard, decideClaim, tenpaiAutoDiscard, discardFor, claimFor, flowHooks,
};
});
