/* ═══════════════════════════════════════════════════════════════
   skills.js — 七國技能（主動的那四個）
   ───────────────────────────────────────────────────────────────
   規格：`docs/skill-conflicts.md` 第六節（2026-09-15 定案）。

   ── 為什麼需要這個檔 ──
   三個**被動**技能（齊善守／楚雄兵／秦虎狼）在 `scoring.js` 的係數裡，
   一直是有效的。四個**主動**技能（燕韓魏趙）的底層原語也早就寫好了
   （`game-state.swapWithWallTail`、`discardTile(…,{guarded})`、
   `claim-arbiter` 的擋吃碰槓判定），但**沒有任何呼叫者** ——
   選到那四國的玩家等於沒有技能，而選國畫面還寫著「選的國家決定你的技能」。
   這個檔就是把那四個接起來的地方。

   ── 設計原則（規格第六節的第一句）──
   **技能只作用在自己身上** —— 不動共用牌山、不讀別人的私有資訊。
   所以四人局與線上版都不需要特例處理：
     ‧ 燕看的是**自己**接下來要摸的牌（舊版是看對手手牌，那在線上是規則明文擋的）
     ‧ 韓／趙是跟牌山**交換**不是抽取，其他三家的摸牌序列一張都不位移
     ‧ 魏唯一作用在對手，但一次性、有界，所以留機制、只修次數

   ── 這裡只有規則，不碰畫面 ──
   次數、能不能用、看到什麼牌 —— 都是純函式。
   按鈕長什麼樣、怎麼選牌是 `mj4.html` 的事。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./game-state.js') : root.MJState,
    typeof require === 'function' ? require('./scoring.js') : root.MJScore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJSkills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S, SC) {
'use strict';

const SEATS = 4;

/* 四個主動技能。`uses` 是三個成長級距（征服 0–1 / 2–3 / 4+），
   對應 scoring.js 的 `growthTier`。

   ⚠️ `per` 是「幾次的單位」，兩種都有：
     ‧ hand  每一局重置（燕韓趙）
     ‧ match 整場只有這麼多次（魏）—— 規格第六節算過：
       沿用「一局一次」在四人局是 12 家次，是兩人版的 4 倍；
       改成一場一次才跟兩人版同級（3 家次）。 */
const SKILLS = {
  yan:  { id: 'yan',  name: '奇謀', icon: '👁', kind: 'peek',
          uses: [1, 2, 3], per: 'hand',
          desc: '看自己接下來要摸的 3 張', hint: '窺探天機' },
  han:  { id: 'han',  name: '精兵', icon: '🔄', kind: 'swap',
          uses: [1, 2, 3], per: 'hand', swap: 1,
          desc: '與牌山最末張交換 1 張手牌', hint: '換走一張廢牌' },
  wei:  { id: 'wei',  name: '鐵騎', icon: '⚡', kind: 'guard',
          uses: [1, 2, 3], per: 'match',
          desc: '下一張棄牌不被吃碰槓（榮和仍可）', hint: '護送這張棄牌' },
  zhao: { id: 'zhao', name: '騎射', icon: '🏇', kind: 'swap',
          uses: [2, 3, 4], per: 'hand', swap: 1,
          desc: '與牌山最末張交換手牌，可用次數較多', hint: '換走一張廢牌' },
};

const PEEK_COUNT = 3;

function skillOf(kingdom) { return SKILLS[kingdom] || null; }

/* 這一國、這個征服數，總共可以用幾次。 */
function maxUses(kingdom, conquered) {
  const sk = skillOf(kingdom);
  if (!sk) return 0;
  return sk.uses[SC.growthTier(conquered || 0)];
}

/* ── 使用次數的帳 ──────────────────────────────────────────
   純資料，可以直接丟進存檔或送上線。
     used   已經用掉幾次
     armed  魏的「下一張棄牌受保護」有沒有掛著 */
function createState(kingdom, conquered) {
  return {
    kingdom: kingdom || null,
    max: maxUses(kingdom, conquered),
    used: 0,
    armed: false,
  };
}

/* 換局時重置。`per: 'match'` 的（魏）不重置 —— 那是整場的額度。
   ⚠️ armed 一定要清掉：上一局沒用到的保護不該跨局帶過去。 */
function resetForHand(st) {
  if (!st) return st;
  const sk = skillOf(st.kingdom);
  if (sk && sk.per === 'hand') st.used = 0;
  st.armed = false;
  return st;
}

function left(st) {
  if (!st) return 0;
  return Math.max(0, st.max - st.used);
}

/* ── 現在能不能用 ──────────────────────────────────────────
   回傳 `{ ok, why }`。why 是給畫面顯示的理由，不要自己在畫面層重寫一遍。 */
function canUse(st, hand, seat) {
  if (!st || !st.kingdom) return { ok: false, why: '沒有主動技能' };
  const sk = skillOf(st.kingdom);
  if (!sk) return { ok: false, why: '沒有主動技能' };
  if (!hand || hand.phase === 'over') return { ok: false, why: '這一局結束了' };
  /* ⚠️ armed 要**先**判。魏的次數是 1 的時候，掛上之後兩個條件同時成立，
     先判次數會回「這一場的次數用完了」—— 玩家看了以為技能沒了，
     其實是已經掛好了、正等著那張棄牌。 */
  if (sk.kind === 'guard' && st.armed) return { ok: false, why: '已經掛上護送了' };
  if (left(st) <= 0) {
    return { ok: false, why: sk.per === 'match' ? '這一場的次數用完了' : '這一局的次數用完了' };
  }

  /* 換牌與護送都要在**自己的回合**：
     換牌動的是自己的手牌，別人回合時手牌張數不對；
     護送掛的是「下一張棄牌」，不是自己的回合就沒有下一張棄牌可掛。
     窺探沒有這個限制 —— 想什麼時候看都可以。 */
  if (sk.kind !== 'peek') {
    const turn = hand.turn;
    if (turn !== seat) return { ok: false, why: '輪到你的時候才能用' };
  }
  if (sk.kind === 'swap' && S.isWallEmpty(hand)) return { ok: false, why: '牌山沒牌了' };
  return { ok: true, why: '' };
}

/* ── 燕 奇謀：看自己接下來要摸的牌 ──────────────────────────
   ⚠️ 算的是「**沒有人鳴牌**的話」會摸到什麼。
   有人吃碰槓就會跳過座位、摸牌序列整個變，那時這三張就不準了。
   畫面上要照實說，不要讓玩家以為是保證。

   為什麼不做成保證：要保證就得攔住別人的宣告權，那違反
   「技能只作用在自己身上」—— 而那正是這一版重新設計的前提。 */
function peek(hand, seat, n) {
  if (!hand || !hand.wall) return [];
  const want = n || PEEK_COUNT;
  const wait = ((seat - hand.turn) % SEATS + SEATS) % SEATS;   // 還要等幾家才輪到我
  const out = [];
  for (let k = 0; k < want; k++) {
    const idx = hand.drawIdx + wait + k * SEATS;
    if (idx >= hand.deadWallStart) break;        // 王牌不能看
    out.push(hand.wall[idx]);
  }
  return out;
}

/* ── 套用 ──────────────────────────────────────────────────
   回傳 `{ ok, kind, … }`；失敗時帶 why。會就地改 st（扣次數）。

   opts.tileIndex：換牌要換掉哪一張（韓／趙）                  */
function use(st, hand, seat, opts) {
  const chk = canUse(st, hand, seat);
  if (!chk.ok) return { ok: false, why: chk.why };
  const sk = skillOf(st.kingdom);
  const o = opts || {};

  if (sk.kind === 'peek') {
    const tiles = peek(hand, seat, PEEK_COUNT);
    st.used++;
    return { ok: true, kind: 'peek', tiles, note: '若無人鳴牌' };
  }

  if (sk.kind === 'swap') {
    const r = S.swapWithWallTail(hand, seat, o.tileIndex);
    if (!r) return { ok: false, why: '這張換不了' };
    st.used++;
    return { ok: true, kind: 'swap', out: r.out, got: r.got };
  }

  if (sk.kind === 'guard') {
    st.armed = true;
    st.used++;
    return { ok: true, kind: 'guard' };
  }
  return { ok: false, why: '不認得的技能' };
}

/* 掛著的護送要用掉了（棄牌送出去的那一刻）。
   回傳這一張要不要標 guarded，並把旗標放掉。 */
function consumeGuard(st) {
  if (!st || !st.armed) return false;
  st.armed = false;
  return true;
}

return {
  SKILLS, PEEK_COUNT,
  skillOf, maxUses, createState, resetForHand, left, canUse, peek, use, consumeGuard,
};
});
