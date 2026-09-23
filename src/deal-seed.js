/* ═══════════════════════════════════════════════════════════════
   deal-seed.js — 偏置發牌：讓起手牌**偏向某個特殊牌型**
   ───────────────────────────────────────────────────────────────
   規格見 `docs/biased-deal.md` 第五節（2026-09-16 定案）。

   ── 為什麼要這個 ──
   「這個遊戲就是要大家都有機會拿到特殊牌，讓不會打麻將的人也可以玩得很開心」。
   公平發牌下，國士無雙之類的牌型幾百局都不會出現一次 —— 那個玩法等於不存在。

   ── 怎麼做（照舊版）──
   1. 每家各 40% 機率要拿種子（連敗的人提高，見 RATE_BOOST）
   2. 依權重挑一個牌型，**組出一副完整的 14 張胡牌**
   3. 從中拿掉 1 張 → 13 張（正好是聽牌）
   4. 再留 2 個位置給原本隨機發到的牌 → 實際只塞 11 張

   第 3、4 步就是舊版的「抽掉幾張隨機補」。為什麼是 2 張：
   整組胡牌是 14 張，但發牌後玩家手上是 13 張，所以只要換掉 2 張
   就會落在 1～2 向聽。約 6% 的機率兩張隨機牌剛好接得上 → 一發牌就聽牌，
   那是刻意保留的小確幸（規格第五節）。

   ── 為什麼用「交換」而不是「指定」 ──
   直接把想要的牌寫進牌山會**把牌變不見**（同一張牌出現兩次、另一張消失）。
   這裡一律從牌山未發的區段（index ≥ 52）換進來，
   所以整副牌永遠還是合法的 136 張，只是順序不同。

   ── 決定論 ──
   全部吃傳進來的 rng，沒有 Math.random()。
   線上版四台機器各自發牌要發出同一副。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./rules-core.js') : root.MJRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJDealSeed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
'use strict';

const SEATS = 4;
const HAND = 13;          // 起手張數
const DEALT = SEATS * HAND;   // 前 52 張是四家的起手牌

/* 觸發機率（docs/biased-deal.md 第五節定案）。
   單機與線上相同 —— 種子不是給某一個人的特權，是給所有人的玩法。 */
const RATE = 0.40;
/* 追趕機制：連敗到門檻的人這一場提高（campaign.js 的 player.boost）。
   規格第三節說得很清楚，這是**手感**機制 —— 它救不了戰役長度，
   只是讓連敗的人下一場有東西可以期待。 */
const RATE_BOOST = 0.75;
/* 打散幾張：從完整的 14 張胡牌拿掉 1 張（→ 13 張正好聽牌）之後，
   再留幾個位置給原本隨機發到的牌。

   ⚠️ 固定 2 張的話實測是「平均 1.59 向聽、只有 1.6% 一到手就聽牌」，
   比舊版基準（1.36 / 6%）難。而那 6% 是玩家明講要保留的小確幸。
   固定 1 張又太寬鬆（0.92 向聽，九成以上直接 1 向聽）。

   所以**混著用**：LIGHT_RATE 的機率只打散 1 張，其餘打散 2 張。

   ── 60% 是怎麼來的（每格 4000 局實測）──
     打散1 的比例    一到手聽牌   1向聽   2向聽   平均
        0%             1.6%     36.9%  61.4%   1.60
       35%             4.4%     55.2%  40.4%   1.36  ← 對準舊版平均
       60%             6.4%     68.2%  25.4%   1.19  ← 定案
       80%             7.8%     79.5%  12.7%   1.05
   玩家要的是「小確幸比舊版的 6% 再高一點」，60% 是第一個越過 6% 的設定。
   要改就改這一個數字，上表可以直接查。 */
const DISRUPT_HEAVY = 2;
const DISRUPT_LIGHT = 1;
const LIGHT_RATE = 0.60;

/* 配不出牌型就換一個再試，最多這麼多次；還是不行就退回公平發牌。
   不硬塞 —— 硬塞會發出「拿得到牌型但牌已經被別家占光、永遠胡不了」的手牌。 */
const MAX_RETRY = 3;

/* 牌型權重。番數越高越稀有 —— 九連寶燈跟混一色一樣常見會很怪。
   用 100/番 當基準，九連 1.1、混一色 12.5，正規化後約 2% vs 26%。
   ⚠️ 不可以讓任何一個變成 0：驗收條件是「十種牌型的出現率都不能是 0」，
   那正是第一版模擬踩到的坑（混一色 0%）。 */
const WEIGHTS = {
  jiulian: 1.2, dasixi: 1.2, lvyise: 1.2, guoshi: 1.6,
  ziyise: 2.0, xiaosanxi: 4.0, qingyise: 6.0, qidui: 7.0,
  duiyisi: 8.0, hungyise: 12.0,
};

const SUITS = ['萬', '筒', '條'];
const WINDS = ['東', '南', '西', '北'];
const DRAGONS = ['中', '發', '白'];
const HONORS = WINDS.concat(DRAGONS);

function pick(list, rng) { return list[Math.floor(rng() * list.length) % list.length]; }
const run = (s, n) => [n + s, (n + 1) + s, (n + 2) + s];
const trip = d => [d, d, d];

/* ── 牌型組裝 ────────────────────────────────────────────────
   每個都回傳**完整的 14 張胡牌**（四組面子 + 一個雀頭，或牌型自己的形狀）。

   ⚠️ 組出來的牌不能誤中**優先度更高**的牌型 —— SPECIAL_HANDS 是有序的，
   先中先算。例如字一色如果湊成四個風刻就會被判成大四喜，
   清一色如果排成 1112345678999 就會變九連寶燈。
   每個組裝式底下都註明它在閃哪一個。 */
const BUILDERS = {
  /* 1112345678999 + 任一張同花色 */
  jiulian(rng) {
    const s = pick(SUITS, rng);
    const base = [1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9].map(n => n + s);
    return base.concat([pick([1, 2, 3, 4, 5, 6, 7, 8, 9], rng) + s]);
  },

  /* 四個風刻 + 雀頭 */
  dasixi(rng) {
    const pair = pick(DRAGONS, rng);
    return WINDS.flatMap(trip).concat([pair, pair]);
  },

  /* 只用 2346 8條 與發 */
  lvyise() {
    return run('條', 2).concat(run('條', 2), trip('6條'), trip('8條'), ['發', '發']);
  },

  /* 十三么九 + 其中一張重複 */
  guoshi(rng) {
    const req = ['1萬', '9萬', '1筒', '9筒', '1條', '9條'].concat(HONORS);
    return req.concat([pick(req, rng)]);
  },

  /* 三元刻 + 一個風刻 + 風雀頭。
     ⚠️ 不能四個風都成刻，那會被判成大四喜（排在字一色前面）。 */
  ziyise(rng) {
    const w = WINDS.slice();
    // 洗一下，雀頭與刻子各取一種風
    for (let i = w.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      const t = w[i]; w[i] = w[j]; w[j] = t;
    }
    return trip('中').concat(trip('發'), trip('白'), trip(w[0]), [w[1], w[1]]);
  },

  /* 兩個三元刻 + 第三個當雀頭 + 兩組數牌面子。
     ⚠️ 一定要有數牌，否則會先中字一色。 */
  xiaosanxi(rng) {
    const d = DRAGONS.slice();
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      const t = d[i]; d[i] = d[j]; d[j] = t;
    }
    const s = pick(SUITS, rng);
    return trip(d[0]).concat(trip(d[1]), [d[2], d[2]], run(s, 1), run(s, 4));
  },

  /* 同一花色的四組面子 + 雀頭。
     ⚠️ 不能排成 1112345678999（九連），也不要全用條子的綠牌（綠一色）。 */
  qingyise(rng) {
    const s = pick(SUITS, rng);
    return run(s, 1).concat(run(s, 1), run(s, 4), run(s, 7), ['5' + s, '5' + s]);
  },

  /* 七個不同的對子 */
  qidui(rng) {
    const all = [];
    SUITS.forEach(s => { for (let n = 1; n <= 9; n++) all.push(n + s); });
    HONORS.forEach(h => all.push(h));
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      const t = all[i]; all[i] = all[j]; all[j] = t;
    }
    return all.slice(0, 7).flatMap(d => [d, d]);
  },

  /* 四個刻子 + 雀頭。
     ⚠️ 號碼一定要先洗成**互不相同**再用。
     一開始雀頭固定寫 '5'+s1，刻子抽到 5 的時候同一種牌就出現五張
     （3 + 2），超過四張上限 —— 實測 200 次有 39 次組出非法的牌。
     ⚠️ 也不能全是字牌（字一色），或湊到兩個三元刻（小三元）。 */
  duiyisi(rng) {
    const s1 = pick(SUITS, rng);
    const s2 = pick(SUITS.filter(x => x !== s1), rng);
    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      const t = nums[i]; nums[i] = nums[j]; nums[j] = t;
    }
    return trip(nums[0] + s1).concat(trip(nums[1] + s1),
                                     trip(nums[2] + s2), trip(pick(WINDS, rng)),
                                     [nums[3] + s1, nums[3] + s1]);
  },

  /* 同一花色數牌 + 字牌。
     ⚠️ 要有數牌（不然是字一色）、要有字牌（不然是清一色）、
        要有順子（不然是對對胡）、只能一個三元刻（不然是小三元）。 */
  hungyise(rng) {
    const s = pick(SUITS, rng);
    const h = pick(HONORS, rng);
    // ⚠️ 雀頭要**排除刻子那張**。同一張字牌當刻子又當雀頭是 3+2＝5 張，
    //    超過四張上限（實測 300 次有 47 次組出非法的牌）。
    const p = pick(DRAGONS.filter(x => x !== h), rng);
    return run(s, 1).concat(run(s, 4), run(s, 7), trip(h), [p, p]);
  },
};

const TYPES = Object.keys(WEIGHTS);

/* 依權重抽一個牌型，`skip` 裡的不抽（重試時把失敗的排除掉）。 */
function pickType(rng, skip) {
  const pool = TYPES.filter(t => !skip || skip.indexOf(t) < 0);
  if (!pool.length) return null;
  const total = pool.reduce((a, t) => a + WEIGHTS[t], 0);
  let r = rng() * total;
  for (const t of pool) { r -= WEIGHTS[t]; if (r <= 0) return t; }
  return pool[pool.length - 1];
}

/* ── 把一手牌塞進牌山 ────────────────────────────────────────
   第 i 張牌的位置是 i*4 + seat —— 因為 startHand 是
   `for round { for seat { hands[seat].push(wall[idx++]) } }` 發的。

   只從 index ≥ 52（還沒發出去的那段）換牌，所以：
     ‧ 整副牌還是合法的 136 張，只是順序不同
     ‧ 不會去偷另一家**已經配好**的種子牌

   換不到就回 false，由呼叫端換一個牌型重試。 */
function placeHand(wall, seat, wanted) {
  const pos = i => i * SEATS + seat;
  const need = wanted.slice();
  const keep = new Array(HAND).fill(false);

  // 原本就發到的、剛好是要的，先留著（換得越少，被別家卡住的機會越小）
  for (let i = 0; i < HAND; i++) {
    const j = need.indexOf(wall[pos(i)].display);
    if (j >= 0) { need.splice(j, 1); keep[i] = true; }
  }

  const swaps = [];
  for (let i = 0; i < HAND && need.length; i++) {
    if (keep[i]) continue;
    const want = need[0];
    let found = -1;
    for (let w = DEALT; w < wall.length; w++) {
      if (wall[w].display === want) { found = w; break; }
    }
    if (found < 0) {                      // 這張牌已經被別家或王牌占光了
      swaps.forEach(sw => {               // 把動過的換回去，不留半套
        const t = wall[sw.a]; wall[sw.a] = wall[sw.b]; wall[sw.b] = t;
      });
      return false;
    }
    const a = pos(i), b = found;
    const t = wall[a]; wall[a] = wall[b]; wall[b] = t;
    swaps.push({ a, b });
    need.shift();
  }
  return need.length === 0;
}

/* ── 一家的種子 ──────────────────────────────────────────────
   組 14 張 → 拿掉 1 張（剩 13 張，正好聽牌）→ 再留 2 個位置給隨機牌
   → 實際只塞 11 張。 */
function seedSeat(wall, seat, rng, opts) {
  const o = opts || {};
  const lightRate = o.lightRate != null ? o.lightRate : LIGHT_RATE;
  const drop = o.disrupt != null ? o.disrupt
             : (rng() < lightRate ? DISRUPT_LIGHT : DISRUPT_HEAVY);
  const tried = [];
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const type = pickType(rng, tried);
    if (!type) break;
    tried.push(type);

    const full = BUILDERS[type](rng);          // 14 張完整胡牌
    const bag = full.slice();
    // 洗牌之後砍掉 1 + disrupt 張 —— 砍哪幾張要隨機，
    // 固定砍最後幾張的話，每次缺的都是同一個位置，玩起來會有規律感
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    const wanted = bag.slice(0, Math.max(0, HAND - drop));

    if (placeHand(wall, seat, wanted)) return { seat, type, placed: wanted.length };
  }
  return null;                                  // 退回公平發牌
}

/* ── 進入點 ──────────────────────────────────────────────────
   wall 會被就地改寫（仍是同一批 136 張，只是順序不同）。
   回傳每一家的結果，沒配到的那家是 null。

   opts:
     rates    每家的觸發機率陣列，預設四家都是 RATE
     boost    哪幾家啟動了追趕機制（布林陣列）→ 改用 RATE_BOOST
     disrupt   打散幾張。不給就照 LIGHT_RATE 混著抽 1 或 2 張
     lightRate 改寫混合比例（測試與模擬用）                       */
function seedWall(wall, rng, opts) {
  const o = opts || {};
  const out = [null, null, null, null];
  for (let s = 0; s < SEATS; s++) {
    const rate = (o.rates && o.rates[s] != null) ? o.rates[s]
               : ((o.boost && o.boost[s]) ? RATE_BOOST : RATE);
    if (rng() >= rate) continue;
    out[s] = seedSeat(wall, s, rng, o);
  }
  return out;
}

/* 這一手是不是配得出這個牌型（測試與模擬用） */
function buildFull(type, rng) {
  return BUILDERS[type] ? BUILDERS[type](rng) : null;
}

return {
  RATE, RATE_BOOST, MAX_RETRY, WEIGHTS, TYPES,
  DISRUPT_HEAVY, DISRUPT_LIGHT, LIGHT_RATE,
  seedWall, seedSeat, placeHand, pickType, buildFull, BUILDERS,
};
});
