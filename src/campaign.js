/* ═══════════════════════════════════════════════════════════════
   campaign.js — 戰役：一場四局之上的那一層
   ───────────────────────────────────────────────────────────────
   規格見 `docs/campaign.md`。這裡只放那份規格的**純函式版本**。

   ── 為什麼另開一個模組 ──
   一場（match）不該擁有戰役狀態。一場打完人就散了，
   戰役卻要跨場、跨裝置、跨好幾天活著 ——
   線上版每個人的戰役進度是各自存的（階段三放 Firebase），
   跟牌局狀態的生命週期完全不同。混在 `game-state.js` 裡，
   之後同步的時候會連牌山一起送上雲端。

   ── 核心模型：土地是「個人收藏」，不是共用地圖 ──
   四個玩家手上的國**本來就會重複**，那不是 bug 是常態：
   可能兩人都擁有六國，最後一戰決定誰統一天下。
   舊版的 `G.conquered` 就是這個東西，四人版只是每人各帶一份進來。

   所以這裡**沒有**「世界地圖」這種共用結構，只有一人一份 player。

   ── 決定論 ──
   抽哪一國要靠傳進來的 rng，不可以用 Math.random()。
   線上版四台機器各自算結算，算出不同答案就對不起來了。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./kingdoms.js') : root.MJKingdoms);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJCampaign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (K) {
'use strict';

/* 統一天下＝本國 + 征服六國。七國裡扣掉自己的本國就是 6。 */
const UNIFY = 6;

/* 追趕機制／重整旗鼓的觸發門檻（docs/campaign.md 第三節）。
   還沒征服過任何國的人**墊底一次**就觸發，已經有地的人要連續兩場 ——
   越沒有進度的人，保護來得越快。 */
const RALLY_NEED_NEW = 1;
const RALLY_NEED_OLD = 2;

/* ── 一個玩家的戰役進度 ────────────────────────────────────
   這就是要存檔／上傳的全部內容。刻意保持成純 JSON，
   不放函式也不放 DOM 參照 —— 階段三要原樣丟進 Firebase。 */
function createPlayer(cfg) {
  const c = cfg || {};
  return {
    seat: c.seat != null ? c.seat : 0,
    name: c.name || '',
    isAI: !!c.isAI,
    kingdom: c.kingdom || null,   // 本國：身分與技能來源，不會被搶走
    conquered: [],                // 征服地，只增不減
    lastStreak: 0,                // 連續墊底幾場
    boost: false,                 // 下一場要不要提高特殊牌型機率（追趕機制）
    matches: 0,                   // 打過幾場（存檔用）
    unified: false,
  };
}

/* 重整旗鼓：換一國重新開始。

   ⚠️ **不是**整份砍掉重建。`boost` 要留著 —— 它是上一場結算時許下的承諾
   （「下一場更容易做成特殊牌型」），玩家按了換國就把承諾收回去，
   那個按鈕就變成懲罰了，而整個設計的前提是它是**免費的機會**。
   `matches` 也留著，那是這個人總共打了幾場，不屬於某一個國。 */
function repick(player, kingdomId) {
  return Object.assign(createPlayer({
    seat: player.seat, name: player.name, isAI: player.isAI, kingdom: kingdomId,
  }), {
    boost: player.boost,
    matches: player.matches,
  });
}

/* 技能成長吃的是征服數。AI 永遠回 0 ——
   電腦對手是陪玩家打牌的，不用成長（docs/campaign.md 第五節）。
   難度只調 AI 的打法（aiLevel），不調技能，
   否則難度會同時往打法和技能兩個方向加壓，對弱玩家雙重不利。 */
function conqueredCount(player) {
  if (!player || player.isAI) return 0;
  return player.conquered.length;
}

function isUnified(player) {
  return !!player && player.conquered.length >= UNIFY;
}

/* 這一國我能不能拿：不是我的本國、而且我還沒征服過。 */
function canTake(player, kingdomId) {
  return !!kingdomId
    && kingdomId !== player.kingdom
    && player.conquered.indexOf(kingdomId) < 0;
}

/* 我還沒征服的國（不含本國）。 */
function remaining(player) {
  return (K ? K.KINGDOMS : []).map(k => k.id).filter(id => canTake(player, id));
}

function pickOne(list, rng) {
  if (!list.length) return null;
  return list[Math.floor(rng() * list.length) % list.length];
}

/* ── 一場結束：誰征服了誰 ──────────────────────────────────
   規則（docs/campaign.md 第二節）：
   **你征服的是「排在你後面的人」當中的一國。**

     第一名 → 從二三四名裡取一國
     第二名 → 從三四名裡取
     第三名 → 第四名那一國
     第四名 → 後面沒有人，所以什麼都拿不到

   這讓 +1/+1/+1/0 從一條數值規則變成一句話講得通的規則：
   「打敗誰就拿誰的地，墊底的人沒打敗任何人」——
   第四名拿不到地不需要另外解釋。

   ⚠️ 只進不退。沒有任何名次會被扣地，這是刻意的：
   試算過「第四名 −1」，期望淨增長歸零，戰役變成隨機漫步，
   從 1 國走到 7 國中途不歸零的機率只有 1/7 —— 實測要 335 手牌、
   平均亡國六次。問題不在有沒有退，在於獎勵沒有攤開給名次。

   `ranks` 直接吃 `scoring.standings()` 的輸出（已排好序）。
   回傳與 ranks 同序的報告，不會改到 players —— 要生效請呼叫 applyResult。 */
function awardConquests(players, ranks, rng) {
  const bySeat = {};
  players.forEach(p => { bySeat[p.seat] = p; });
  const last = ranks.length - 1;

  return ranks.map((r, i) => {
    const me = bySeat[r.seat];
    const base = { seat: r.seat, rank: i + 1, gained: null, from: null, fallback: false };
    if (!me || i >= last) return base;              // 墊底：後面沒有人

    // 優先：排在我後面、我還沒征服的那些人的本國
    const below = ranks.slice(i + 1)
      .map(x => bySeat[x.seat])
      .filter(p => p && canTake(me, p.kingdom));
    if (below.length) {
      const target = pickOne(below.map(p => p.seat), rng);
      return Object.assign(base, { gained: bySeat[target].kingdom, from: target });
    }

    // 退路：排我後面的國我都征服過了 —— 從所有還沒征服的國隨機取。
    // 單機因為對手優先抽未征服國，這條很少走到；線上則常走，
    // 因為對手的本國不由我決定（docs/campaign.md 第五節）。
    const rest = remaining(me);
    if (!rest.length) return base;                  // 已經征服六國，不該還在打
    return Object.assign(base, { gained: pickOne(rest, rng), fallback: true });
  });
}

/* ── 追趕機制與重整旗鼓 ────────────────────────────────────
   連續墊底到門檻 → 提高該玩家的特殊牌型機率（不再墊底就關掉）。
   征服數為 0 時**同時**提供「要不要換一國」。

   兩件事共用一個觸發，玩家只要記一件事：連敗，天命會幫你。
   而且把換國跟一個好處綁在一起，讀起來是「遊戲在幫你」而不是「你失敗了」——
   所以文案用「重整旗鼓」，不要用 Game over。這時候你手上只有本國，
   本來就沒有東西可以失去，它是免費換國的機會不是懲罰。 */
function rallyNeed(player) {
  return player.conquered.length === 0 ? RALLY_NEED_NEW : RALLY_NEED_OLD;
}

function rallyState(player) {
  const need = rallyNeed(player);
  const boost = player.lastStreak >= need;
  return {
    boost,                                          // 提高特殊牌型機率
    canRepick: boost && player.conquered.length === 0,  // 順便可以換國
    streak: player.lastStreak,
    need,
  };
}

/* ── 套用一場的結果 ────────────────────────────────────────
   回傳報告；players 會被就地更新。 */
/* 這一場的戰果記不記給這一家。
   規則（2026-09-23，取代先前的「AI 代打照算」）：電腦替他出過手就不記 ——
   統一天下要靠自己。聽牌後自己按的「交給系統打」不算代打，那是玩家自己的選擇、
   而且只是摸切；這裡看的是 flow 的 subbed，只有斷線接手會設它。       */
function creditable(match, seat) {
  const st = match && match.seats && match.seats[seat];
  return !(st && st.subbed);
}

function applyResult(players, ranks, rng) {
  const awards = awardConquests(players, ranks, rng);
  const bySeat = {};
  players.forEach(p => { bySeat[p.seat] = p; });
  const lastSeat = ranks.length ? ranks[ranks.length - 1].seat : null;

  const report = awards.map(a => {
    const me = bySeat[a.seat];
    if (!me) return a;
    me.matches++;
    // 連續墊底的計數要在發地之前後都對得上：墊底的人本來就沒拿到地
    me.lastStreak = (a.seat === lastSeat) ? me.lastStreak + 1 : 0;
    if (a.gained) me.conquered.push(a.gained);
    if (isUnified(me)) me.unified = true;
    // 存成欄位而不是只回報 —— 發牌那一層（階段三第 3 項偏置發牌）
    // 在下一場開局時要讀得到，那時這份報告早就不見了。
    me.boost = rallyState(me).boost;
    return Object.assign({}, a, {
      conquered: me.conquered.length,
      unified: me.unified,
      rally: rallyState(me),
    });
  });
  return report;
}

/* ── 單機：抽對手 ──────────────────────────────────────────
   **優先抽玩家還沒征服的國**，這樣「打敗誰就拿誰的地」幾乎總是成立，
   而且對手陣容會隨進度變化 —— 後期剩下的都是還沒拿下的硬骨頭。
   不夠三家時（快統一了）才從已征服的補上。 */
function drawOpponents(player, rng, n) {
  const want = n || 3;
  const shuffle = list => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  const fresh = shuffle(remaining(player));
  const used = shuffle((K ? K.KINGDOMS : []).map(k => k.id)
    .filter(id => id !== player.kingdom && fresh.indexOf(id) < 0));
  return fresh.concat(used).slice(0, want);
}

return {
  UNIFY, RALLY_NEED_NEW, RALLY_NEED_OLD,
  createPlayer, repick, conqueredCount, isUnified, canTake, remaining,
  awardConquests, applyResult, creditable, rallyNeed, rallyState, drawOpponents,
};
});
