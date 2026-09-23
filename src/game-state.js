/* ═══════════════════════════════════════════════════════════════
   game-state.js — 四人麻將的狀態模型
   ───────────────────────────────────────────────────────────────
   職責只有「資料結構 + 不含判斷的基本動作」：
     ‧ 座位、莊家、風位、牌山
     ‧ 摸牌、棄牌、把副露放進去

   刻意不做的事（留給後面的模組）：
     ‧ 誰可以吃碰槓胡的判定與優先權　→ claim-arbiter.js（第 3 步）
     ‧ 什麼時候該做什麼　　　　　　　→ flow.js（第 4 步）
     ‧ 規則判定（胡牌／向聽／振聽）　→ rules-core.js（已完成）

   ── 兩個硬性約束 ──
   1. 狀態必須是純 JSON（能直接丟進 Firebase）
      不可有 function／Set／Map／undefined。Firebase 的 set() 碰到 undefined
      會整份拒絕，而 JSON.stringify 是安靜忽略，症狀很難往回推。
   2. 空陣列存進 Firebase 再讀回來會變成缺欄位
      所以任何從網路收到的狀態都要先過 normalize()。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./rules-core.js') : root.MJRules,
    // ⚠️ 瀏覽器下 deal-seed.js 一定要排在這一支**前面**載 ——
    //    這裡在 factory 執行時就把參照抓走了，晚載的話永遠是 undefined。
    typeof require === 'function' ? require('./deal-seed.js') : root.MJDealSeed);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, DealSeed) {
'use strict';

const SEATS = 4;
const WINDS = ['東', '南', '西', '北'];

/* ── 亂數 ────────────────────────────────────────────────────
   刻意用可帶種子的 PRNG，不用 Math.random()：
   ‧ 測試要能重現同一副牌
   ‧ 線上版由一台發牌，種子留在狀態裡，事後可驗證這副牌沒有被動手腳
   mulberry32，32-bit 狀態，週期夠一局用。                        */
function makeRNG(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWith(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ── 牌山 ──────────────────────────────────────────────────── */
function makeDeck() {
  const d = [];
  let uid = 0;
  for (const s of R.SUITS)
    for (let n = 1; n <= 9; n++)
      for (let c = 0; c < 4; c++)
        d.push({ suit: s, num: n, display: `${n}${s}`, isHonor: false, uid: uid++ });
  for (const h of R.HONORS)
    for (let c = 0; c < 4; c++)
      d.push({ suit: h, num: 0, display: h, isHonor: true, uid: uid++ });
  return d;                                   // 136 張
}

const DEAD_WALL = 14;                          // 王牌（嶺上牌來源），標準留 14 張

/* ── 建立一場（四局）──────────────────────────────────────── */
function createMatch(opts) {
  const o = opts || {};
  const seats = [];
  for (let i = 0; i < SEATS; i++) {
    const cfg = (o.seats && o.seats[i]) || {};
    seats.push({
      seat: i,
      name: cfg.name || `玩家${i + 1}`,
      kingdom: cfg.kingdom || null,            // 'qi' | 'chu' | ...
      isAI: !!cfg.isAI,
      aiLevel: cfg.aiLevel || 2,
      clientId: cfg.clientId || null,          // 線上版的座位認領
      matchScore: 0,                           // 一場四局的累計
      /* 斷線代打（docs/net-turn-model.md「斷線代打」）
         sub     **現在**有武將在代打：{ general, since }，人回來就清成 null
         subbed  **這一場**電腦真的替他出過手 —— 一旦設了就不會清，
                 這一場的戰果不記給他（統一天下要靠自己）         */
      sub: null,
      subbed: false,
    });
  }
  return {
    version: 1,
    seed: (o.seed >>> 0) || 1,
    seats,
    handNo: 0,                                 // 0 = 還沒開始；1..4
    totalHands: o.totalHands || 4,             // 一場四局（東風戰）
    // 局數的硬上限。不連莊時就等於 totalHands；開連莊時由 flow 調高，
    // 因為續莊會讓局數超過四局。
    // 「這一場打完了沒」的判斷權在 scoring.nextDealer，這裡只是防跑飛的欄杆 ——
    // 兩邊都自己判會打架（連莊打不滿一圈就被腰斬）。
    handLimit: o.handLimit || o.totalHands || 4,
    dealerSeat: 0,                             // 目前的莊家（連莊時不輪轉）
    dealerRotations: 0,                        // 莊家換過幾次（連莊模式的結束條件）
    honba: 0,                                  // 本場數，連莊或流局累積
    hand: null,                                // 當前這一局，見 startHand
    finished: false,
  };
}

/* ── 開始一局 ──────────────────────────────────────────────
   deal 策略可抽換：預設公平發牌。舊版的偏置發牌（70% 機率把玩家的
   起手組成特殊牌型）之後要移植的話，做成另一個 strategy 即可，
   不必動這裡。                                                   */
function startHand(match, options) {
  const o = options || {};
  const handNo = match.handNo + 1;
  if (handNo > (match.handLimit || match.totalHands)) { match.finished = true; return match; }

  // 莊家：預設每局輪一位。連莊由 flow 算好之後用 options.dealer 指定進來 ——
  // 這裡不做判斷，因為「該不該連莊」要看上一局誰贏、流局時誰聽牌，
  // 那是計分層的知識（見 scoring.nextDealer）。
  const dealer = o.dealer != null ? o.dealer : (handNo - 1) % SEATS;

  const rng = makeRNG(o.seed != null ? o.seed : (match.seed + handNo * 7919));
  const wall = shuffleWith(rng, makeDeck());

  /* 偏置發牌（docs/biased-deal.md）。**預設不開** ——
     這一層是規則層，「誰該拿種子」是戰役層的知識（連敗加成看 campaign.boost），
     所以由控制層傳 o.seeding 進來決定。不傳就是公平發牌，
     既有測試與重放完全不受影響。 */
  let seeded = null;
  if (o.seeding && DealSeed) seeded = DealSeed.seedWall(wall, rng, o.seeding);

  const hands = [[], [], [], []];
  let idx = 0;
  // 依序各發 13 張（真實麻將是四張四張抓，但發完的結果等價，
  // 而且這樣寫比較好驗證；要做抓牌動畫時再在表現層鋪陳）
  for (let round = 0; round < 13; round++)
    for (let s = 0; s < SEATS; s++) hands[s].push(wall[idx++]);

  hands.forEach(sortTiles);                    // 起手就排好

  match.handNo = handNo;
  match.dealerSeat = dealer;
  match.hand = {
    handNo,
    dealer,
    seeded,                                    // 哪幾家配到了什麼牌型（除錯／統計用）
    honba: match.honba || 0,                   // 這一局開始時的本場數
    roundWind: '東',                           // 四局都是東場
    wall,
    drawIdx: idx,                              // 下一張要摸的位置
    deadWallStart: wall.length - DEAD_WALL,    // 這個位置（含）之後是王牌
    rinshanTaken: 0,                           // 已抽走幾張嶺上牌
    turn: dealer,                              // 莊家先摸
    phase: 'draw',                             // draw | discard | claim | over
    lastDiscard: null,                         // {seat, tile, seq}
    lastKongAdded: null,                       // 加槓的那張，搶槓視窗要用
    discardSeq: 0,                             // 每次棄牌遞增，宣告視窗用它對齊
    seats: hands.map((h, i) => ({
      seat: i,
      hand: h,
      melds: [],
      discards: [],
      riichiLike: false,                       // 保留欄位（目前無立直）
      furitenTemp: false,                      // 同巡振聽
      score: 0,                                // 本局得分
    })),
    result: null,                              // {type:'win'|'draw', ...}
  };
  return match;
}

/* ── Firebase 往返修復 ────────────────────────────────────────
   空陣列存進 Firebase 會整個消失（不是變成 []，是欄位不見），
   收到的狀態一律先過這裡，否則 hand.forEach 會炸。               */
function normalize(match) {
  if (!match) return match;
  match.seats = match.seats || [];
  if (match.honba == null) match.honba = 0;
  if (match.dealerSeat == null) match.dealerSeat = 0;
  if (match.dealerRotations == null) match.dealerRotations = 0;
  if (match.handLimit == null) match.handLimit = match.totalHands || 4;
  // Firebase 會把 null 吃掉、false 也可能不見 —— 代打的兩個欄位要補回來
  match.seats.forEach(st => {
    if (!st) return;
    if (st.sub === undefined) st.sub = null;
    st.subbed = !!st.subbed;
  });
  const h = match.hand;
  if (h) {
    h.wall = h.wall || [];
    h.seats = h.seats || [];
    for (let i = 0; i < SEATS; i++) {
      const s = h.seats[i] || (h.seats[i] = { seat: i });
      s.hand = s.hand || [];
      s.melds = s.melds || [];
      s.discards = s.discards || [];
      s.melds.forEach(m => { m.tiles = m.tiles || []; });
      if (s.score == null) s.score = 0;
      if (s.furitenTemp == null) s.furitenTemp = false;
    }
    if (h.lastDiscard === undefined) h.lastDiscard = null;
    if (h.lastKongAdded === undefined) h.lastKongAdded = null;
    if (h.result === undefined) h.result = null;
  }
  return match;
}

/* 寫出去之前清掉 undefined —— Firebase 的 set() 碰到會整份拒絕 */
function stripUndefined(v) {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach(k => { if (v[k] !== undefined) out[k] = stripUndefined(v[k]); });
    return out;
  }
  return v;
}

/* ── 排序 ──────────────────────────────────────────────────
   萬 → 筒 → 條 → 字，同花色依數字。與舊版 `sortH`（L2473）同一個順序。

   ⚠️ **剛摸進來的那張不排進去**，留在最右邊。
   這是麻將的慣例（摸切）：玩家要一眼看到自己摸到什麼，
   排進去的話每一巡都要重新找牌。所以 drawTile／drawRinshan 只 push、不排，
   等這一張被打掉或用掉（棄牌、副露）之後才併回去。                */
function sortTiles(tiles) {
  return tiles.sort((a, b) => {
    if (a.isHonor !== b.isHonor) return a.isHonor ? 1 : -1;
    if (!a.isHonor && !b.isHonor) {
      const si = R.SUITS.indexOf(a.suit) - R.SUITS.indexOf(b.suit);
      return si || a.num - b.num;
    }
    return R.HONORS.indexOf(a.suit) - R.HONORS.indexOf(b.suit);
  });
}
function sortSeatHand(hand, seat) {
  sortTiles(hand.seats[seat].hand);
  return hand;
}

/* ── 查詢 ──────────────────────────────────────────────────── */

/* 自風：莊家是東，之後逆時針南西北 */
function seatWind(hand, seat) {
  return WINDS[(seat - hand.dealer + SEATS) % SEATS];
}

/* 下一家（逆時針） */
function nextSeat(seat) { return (seat + 1) % SEATS; }

/* 某座位相對於打牌者是第幾家（1=下家, 2=對家, 3=上家） */
function seatOffset(fromSeat, toSeat) {
  return (toSeat - fromSeat + SEATS) % SEATS;
}

/* 畫面上的牌河：被鳴走的那張已經在別人的副露裡，不該重複畫。
   振聽判定不要用這個，要用完整的 seats[i].discards。              */
function visibleDiscards(hand, seat) {
  return hand.seats[seat].discards.filter(t => t.claimedBy == null);
}

/* 剩餘可摸張數，0 即流局 */
function liveWallCount(hand) {
  return Math.max(0, hand.deadWallStart - hand.drawIdx);
}
function isWallEmpty(hand) { return liveWallCount(hand) <= 0; }

/* 這個座位「棄牌後」應有的手牌張數（每個槓補摸 1 張所以會多） */
function baseHandSize(seatState) {
  const { mS, kongCount } = R.meldStats(seatState.melds);
  return 13 - mS + kongCount;
}

/* ── 動作 ──────────────────────────────────────────────────
   這些函式只做「照著指令改狀態」，不判斷合不合法 —— 合法性由
   claim-arbiter / flow 負責。回傳值用來讓呼叫端知道發生了什麼。 */

/* 摸牌。牌山空了回 null（由流程層判流局）。 */
function drawTile(hand, seat) {
  if (isWallEmpty(hand)) return null;
  const tile = hand.wall[hand.drawIdx++];
  hand.seats[seat].hand.push(tile);
  hand.seats[seat].furitenTemp = false;        // 摸到牌就解除同巡振聽
  return tile;
}

/* 嶺上牌（槓之後補摸）。從王牌尾端拿，並把王牌邊界往前推一張，
   讓王牌維持 14 張 —— 否則連續開槓會把可摸牌數算錯。

   兩道門檻，缺一不可：
   ‧ 活牌山空了就不能槓 —— 王牌邊界會跟著前移，光比對 pos 與
     deadWallStart 永遠差 13 張，那個條件是永遠成立的死碼，
     結果是流局之後還槓得下去。要擋的是「沒有牌可以補進王牌」。
   ‧ 四槓為上限（四槓散了的判定留給流程層，這裡只保證不超抽）。  */
const MAX_KONGS = 4;
function drawRinshan(hand, seat) {
  if (hand.rinshanTaken >= MAX_KONGS) return null;
  if (isWallEmpty(hand)) return null;
  const pos = hand.wall.length - 1 - hand.rinshanTaken;
  const tile = hand.wall[pos];
  hand.rinshanTaken++;
  hand.deadWallStart--;                        // 邊界前移，可摸牌少一張
  hand.seats[seat].hand.push(tile);
  hand.seats[seat].furitenTemp = false;
  return tile;
}

/* 棄牌。tileIndex 是手牌陣列的位置。
   opts.guarded：魏國「鐵騎」護送這張棄牌 —— 別家不能吃碰槓，但**仍然可以榮和**。
   旗標掛在 lastDiscard 上而不是 hand 上，因為它只對這一張牌有效，
   掛在 hand 上的話下一張棄牌會忘記清掉。                          */
function discardTile(hand, seat, tileIndex, opts) {
  const s = hand.seats[seat];
  const tile = s.hand.splice(tileIndex, 1)[0];
  if (!tile) return null;
  sortTiles(s.hand);                           // 剛摸的那張併回牌組裡
  s.discards.push(tile);
  hand.lastDiscard = {
    seat, tile, seq: ++hand.discardSeq,
    guarded: !!(opts && opts.guarded),
  };
  hand.lastKongAdded = null;
  hand.turn = seat;
  hand.phase = 'claim';                        // 進入宣告視窗
  return tile;
}

/* 把副露放進去。
   type: 'chi' | 'pong' | 'kong_light'（明槓）| 'kong_dark'（暗槓）| 'kong_added'（加槓）
   tiles: 組成這個副露的牌（含被鳴的那張）
   fromSeat: 從哪一家鳴來的；暗槓傳 null
   會從手牌移除除了「被鳴那張」以外的牌。                          */
function applyMeld(hand, seat, type, tiles, fromSeat) {
  const s = hand.seats[seat];

  // 加槓是「把手上第 4 張加到已經碰出來的那組」，不是新開一個副露。
  // 寫成新增的話會變成 5 個副露、手牌張數也對不上。
  if (type === 'kong_added') {
    const t4 = tiles[tiles.length - 1];
    const pong = s.melds.find(m =>
      m.type === 'pong' && m.tiles[0].display === t4.display);
    if (pong) {
      const i = s.hand.findIndex(x => x.uid === t4.uid);
      if (i >= 0) s.hand.splice(i, 1);
      pong.type = 'kong_added';
      pong.tiles.push(t4);
      sortTiles(s.hand);
      hand.turn = seat;
      hand.lastDiscard = null;
      // 加槓的牌要留個記錄 —— 搶槓是對「這張加上去的牌」榮和，
      // 它既不在牌河也不在手裡，不記下來宣告仲裁就無從判起。
      hand.lastKongAdded = { seat, tile: t4, seq: ++hand.discardSeq };
      hand.phase = 'draw';                     // 補嶺上牌
      return pong;
    }
    // 找不到對應的碰 —— 呼叫端傳錯了，退回當一般明槓處理
  }

  const claimed = fromSeat == null ? null : (hand.lastDiscard && hand.lastDiscard.tile);
  const takeFromHand = claimed ? tiles.filter(t => t.uid !== claimed.uid) : tiles;

  takeFromHand.forEach(t => {
    const i = s.hand.findIndex(x => x.uid === t.uid);
    if (i >= 0) s.hand.splice(i, 1);
  });

  // 被鳴走的那張標記起來，但**不從棄牌堆移除**。
  // 它確實不該再畫在河裡（畫面用 visibleDiscards 濾掉），可是振聽認的是
  // 「這張牌從我手上打出去過」—— 真的刪掉的話，打出去又被人碰走的那張
  // 就不再算振聽，等於送玩家一個免費的漏洞。
  if (claimed && fromSeat != null) {
    const d = hand.seats[fromSeat].discards;
    const i = d.findIndex(x => x.uid === claimed.uid);
    if (i >= 0) d[i] = Object.assign({}, d[i], { claimedBy: seat });
  }

  sortTiles(s.hand);
  s.melds.push({ type, tiles: tiles.slice(), from: fromSeat == null ? null : fromSeat });
  hand.turn = seat;
  hand.lastDiscard = null;
  hand.lastKongAdded = null;
  hand.phase = (type === 'chi' || type === 'pong') ? 'discard' : 'draw';
  return s.melds[s.melds.length - 1];
}

/* 韓「精兵」／趙「騎射」的換牌原語。

   把手上第 tileIndex 張與**活牌山的最末張**交換 —— 也就是流局前最後一個
   會被摸到的位置。選這一格的理由是它對其他三家的干擾最小：

     ‧ 牌山總張數不變（是交換，不是抽取）
     ‧ drawIdx ~ deadWallStart-2 完全不動 → 其他家的摸牌序列一張都不位移
     ‧ 王牌與嶺上牌不受影響，槓的次數不變
     ‧ 唯一會變的是流局前最後一張

   舊版兩人局的做法是「手牌直接丟掉 + 從牌山頂端補一張」，
   那會讓牌少一張、而且所有人的摸牌序列整個往前移一格 ——
   四人局等於從其他三家的未來摸牌裡抽走一張，與 PLAN 的公平性原則牴觸。

   牌山已空（沒有最末張可換）時回 null。

   ⚠️ 這是唯一一個會**改寫 wall 內容**的函式。wall 平常是「這副牌原本的
   順序」，配上 seed 就能事後核對發牌沒有被動手腳（見 createMatch）。
   換過牌之後那份核對就對不起來了 —— 線上版要驗證的話，
   必須連同換牌事件一起重放，不能只比對 seed 推出來的牌山。            */
function swapWithWallTail(hand, seat, tileIndex) {
  if (isWallEmpty(hand)) return null;
  const s = hand.seats[seat];
  const out = s.hand[tileIndex];
  if (!out) return null;
  const pos = hand.deadWallStart - 1;             // 活牌山最末張
  const got = hand.wall[pos];
  hand.wall[pos] = out;
  s.hand[tileIndex] = got;
  sortTiles(s.hand);
  return { out, got };
}

/* 同巡振聽：放過一張本來可以榮和的牌之後設起來，摸到下一張牌時自動解除 */
function setTemporaryFuriten(hand, seat, on) {
  hand.seats[seat].furitenTemp = !!on;
}

/* 這一家是不是振聽（把 rules-core 的判定接上狀態） */
function isSeatFuriten(hand, seat) {
  const s = hand.seats[seat];
  return R.isFuriten(s.hand, s.melds, s.discards, { temporary: s.furitenTemp });
}

return {
  SEATS, WINDS, DEAD_WALL,
  makeRNG, makeDeck, shuffleWith,
  createMatch, startHand, normalize, stripUndefined,
  seatWind, nextSeat, seatOffset, liveWallCount, isWallEmpty, baseHandSize,
  visibleDiscards,
  drawTile, drawRinshan, discardTile, applyMeld, swapWithWallTail,
  sortTiles, sortSeatHand,
  setTemporaryFuriten, isSeatFuriten,
};
});
